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

test("opening auction queues orders and uncrosses at one clearing price", () => {
  const engine = new MatchingEngine("CANCEL_TAKER", [{ symbol: "005930", tickSize: 100, lotSize: 1, minPrice: 100, maxPrice: 10_000_000, maxOrderQuantity: 1_000 }], "NEXTRADE");
  engine.setMarketPhase("OPENING_AUCTION");
  const bid = engine.submit({ id: "B-AUC", symbol: "005930", participantId: "BUYER", side: "BUY", type: "LIMIT", price: 10100, quantity: 10 });
  const ask = engine.submit({ id: "S-AUC", symbol: "005930", participantId: "SELLER", side: "SELL", type: "LIMIT", price: 10000, quantity: 5 });
  assert.equal(bid.executions.length, 0);
  assert.equal(ask.executions.length, 0);
  const auction = engine.runAuction("005930");
  assert.equal(auction.price, 10100);
  assert.equal(auction.quantity, 5);
  assert.equal(engine.getOrder("B-AUC")?.status, "PARTIAL");
  assert.equal(engine.getOrder("S-AUC")?.status, "FILLED");
});

test("midpoint orders price from the current two-sided quote", () => {
  const engine = new MatchingEngine();
  engine.submit({ id: "B-MID-BOOK", symbol: "005930", participantId: "BUYER", side: "BUY", type: "LIMIT", price: 10000, quantity: 10 });
  engine.submit({ id: "S-MID-BOOK", symbol: "005930", participantId: "SELLER", side: "SELL", type: "LIMIT", price: 10200, quantity: 10 });
  const result = engine.submit({ id: "B-MID", symbol: "005930", participantId: "MIDPOINT", side: "BUY", type: "MIDPOINT", quantity: 5 });
  assert.equal(result.accepted, true);
  assert.equal(result.order?.price, 10100);
  assert.equal(result.order?.type, "MIDPOINT");
  assert.equal(engine.snapshot("005930").bidLevels[0]?.price, 10100);
});

test("stop-limit orders wait for a trigger execution and emit an audit event", () => {
  const engine = new MatchingEngine();
  const pending = engine.submit({ id: "B-STOP", symbol: "005930", participantId: "STOPPER", side: "BUY", type: "STOP_LIMIT", stopPrice: 10100, price: 10100, quantity: 5 });
  assert.equal(pending.order?.status, "PENDING_TRIGGER");
  engine.submit({ id: "S-TRIGGER", symbol: "005930", participantId: "SELLER", side: "SELL", type: "LIMIT", price: 10100, quantity: 5 });
  const trigger = engine.submit({ id: "B-TRIGGER", symbol: "005930", participantId: "BUYER", side: "BUY", type: "LIMIT", price: 10100, quantity: 5 });
  assert.equal(trigger.executions.length, 1);
  assert.equal(engine.getOrder("B-STOP")?.status, "OPEN");
  assert.equal(engine.getEvents().some((event) => event.type === "ORDER_TRIGGERED"), true);
});

test("participant risk limits reject oversized or halted orders", () => {
  const engine = new MatchingEngine();
  engine.setParticipantRiskLimit("BANK-1", { maxOrderQuantity: 10, maxOrderNotional: 100_000, maxOpenOrders: 2 });
  assert.match(engine.submit({ id: "RISK-QTY", symbol: "005930", participantId: "BANK-1", side: "BUY", type: "LIMIT", price: 10000, quantity: 11 }).reason ?? "", /quantity exceeds participant limit/);
  engine.setParticipantHalted("BANK-1", true);
  assert.equal(engine.submit({ id: "RISK-HALT", symbol: "005930", participantId: "BANK-1", side: "BUY", type: "LIMIT", price: 10000, quantity: 1 }).reason, "participant is halted by risk control");
});
