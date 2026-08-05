import assert from "node:assert/strict";
import test from "node:test";
import { MatchingEngine } from "../engine/matchingEngine.js";

test("matches by price then time and uses maker price", () => {
  const engine = new MatchingEngine();
  engine.submit({ id: "S1", symbol: "005930", participantId: "MM-A", side: "SELL", type: "LIMIT", price: 10100, quantity: 50 });
  engine.submit({ id: "S2", symbol: "005930", participantId: "MM-B", side: "SELL", type: "LIMIT", price: 10000, quantity: 20 });
  const result = engine.submit({ id: "B1", symbol: "005930", participantId: "TAKER", side: "BUY", type: "LIMIT", price: 10100, quantity: 60 });
  assert.equal(result.accepted, true);
  assert.deepEqual(result.executions.map((fill) => [fill.price, fill.quantity]), [[10000, 20], [10100, 40]]);
  assert.equal(result.order?.status, "FILLED");
  assert.equal(engine.snapshot("005930").asks[0]?.remaining, 10);
});

test("market orders never rest and partial fills are recorded", () => {
  const engine = new MatchingEngine();
  engine.submit({ id: "S1", symbol: "005930", participantId: "MM-A", side: "SELL", type: "LIMIT", price: 10000, quantity: 10 });
  const result = engine.submit({ id: "B1", symbol: "005930", participantId: "TAKER", side: "BUY", type: "MARKET", quantity: 25 });
  assert.equal(result.order?.status, "CANCELLED");
  assert.equal(result.order?.remaining, 15);
  assert.equal(result.executions[0]?.quantity, 10);
  assert.equal(engine.snapshot("005930").bids.length, 0);
});

test("self-trade prevention cancels the taker", () => {
  const engine = new MatchingEngine();
  engine.submit({ id: "S1", symbol: "005930", participantId: "P1", side: "SELL", type: "LIMIT", price: 10000, quantity: 10 });
  const result = engine.submit({ id: "B1", symbol: "005930", participantId: "P1", side: "BUY", type: "LIMIT", price: 10000, quantity: 10 });
  assert.equal(result.order?.status, "CANCELLED");
  assert.equal(result.executions.length, 0);
  assert.equal(engine.snapshot("005930").asks[0]?.remaining, 10);
});

test("cancel and replace remove the old queue position", () => {
  const engine = new MatchingEngine();
  engine.submit({ id: "B1", symbol: "005930", participantId: "P1", side: "BUY", type: "LIMIT", price: 10000, quantity: 10 });
  const replaced = engine.replace("B1", 20, 9900, "P1");
  assert.equal(replaced.accepted, true);
  assert.equal(replaced.order?.price, 9900);
  assert.equal(engine.snapshot("005930").bids[0]?.remaining, 20);
  assert.equal(engine.cancel(replaced.order?.id ?? "", "P1").cancelled, true);
  assert.equal(engine.snapshot("005930").bids.length, 0);
});

test("FOK cancels without changing the book when full liquidity is unavailable", () => {
  const engine = new MatchingEngine();
  engine.submit({ id: "S1", symbol: "005930", participantId: "MM-A", side: "SELL", type: "LIMIT", price: 10000, quantity: 5 });
  const result = engine.submit({ id: "B1", symbol: "005930", participantId: "TAKER", side: "BUY", type: "LIMIT", timeInForce: "FOK", price: 10000, quantity: 6 });
  assert.equal(result.accepted, true);
  assert.equal(result.order?.status, "CANCELLED");
  assert.equal(result.reason, "FOK_NOT_FILLED");
  assert.equal(result.executions.length, 0);
  assert.equal(engine.snapshot("005930").asks[0]?.remaining, 5);
});

test("IOC consumes executable liquidity and cancels the remainder", () => {
  const engine = new MatchingEngine();
  engine.submit({ id: "S1", symbol: "005930", participantId: "MM-A", side: "SELL", type: "LIMIT", price: 10000, quantity: 5 });
  const result = engine.submit({ id: "B1", symbol: "005930", participantId: "TAKER", side: "BUY", type: "LIMIT", timeInForce: "IOC", price: 10000, quantity: 8 });
  assert.equal(result.order?.status, "CANCELLED");
  assert.equal(result.order?.remaining, 3);
  assert.equal(result.executions[0]?.quantity, 5);
  assert.equal(engine.snapshot("005930").bids.length, 0);
});

test("instrument rules reject off-tick prices and emit an audit event", () => {
  const engine = new MatchingEngine("CANCEL_TAKER", [{ symbol: "005930", tickSize: 100, lotSize: 1, minPrice: 100, maxPrice: 1_000_000, maxOrderQuantity: 1_000 }]);
  const result = engine.submit({ id: "B1", symbol: "005930", participantId: "P1", side: "BUY", type: "LIMIT", price: 10050, quantity: 1 });
  assert.equal(result.accepted, false);
  assert.match(result.reason ?? "", /multiple of 100/);
  assert.equal(engine.getEvents()[0]?.type, "ORDER_REJECTED");
});

test("venue phase gate and daily band are enforced before matching", () => {
  const engine = new MatchingEngine("CANCEL_TAKER", [{ symbol: "005930", tickSize: 100, lotSize: 1, minPrice: 100, maxPrice: 10_000_000, maxOrderQuantity: 1_000, market: "KOSPI", venue: "NEXTRADE", basePrice: 70000 }], "NEXTRADE");
  engine.setMarketPhase("CLOSED");
  assert.equal(engine.submit({ id: "B-CLOSED", symbol: "005930", participantId: "P1", side: "BUY", type: "LIMIT", price: 70000, quantity: 1 }).reason, "market is closed");
  engine.setMarketPhase("CONTINUOUS");
  assert.match(engine.submit({ id: "B-BAND", symbol: "005930", participantId: "P1", side: "BUY", type: "LIMIT", price: 92000, quantity: 1 }).reason ?? "", /within 49000-91000/);
});
