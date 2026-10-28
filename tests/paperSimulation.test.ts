import assert from "node:assert/strict";
import test from "node:test";
import { applySimulationCommand, createSimulationState, koreanTradingDay, normalizeReplayTicks, simulationAvailableCash, type SimulationState } from "../engine/paperSimulation";
import { normalizePriceCrossDraft, type PriceCrossStrategy } from "../engine/automationStrategy";

function strategy(overrides: Partial<PriceCrossStrategy> = {}) {
  const result = normalizePriceCrossDraft({ name: "가상 운용 테스트", symbol: "005930", side: "BUY", triggerOperator: "LTE", triggerPrice: 70_000, orderType: "LIMIT", limitPrice: 70_000, quantity: 3, maxOrdersPerDay: 2, maxDailyNotional: 1_000_000, ...overrides }, "AUTO-SIM-TEST");
  assert.ok(result.ok); return result.strategy;
}
const tick = (minute: number, price = 70_000, quantity = 1) => ({ observedAt: `2026-10-28T00:${String(minute).padStart(2, "0")}:00.000Z`, price, quantity });
function start(overrides: Partial<PriceCrossStrategy> = {}, account = createSimulationState()) { return applySimulationCommand(account, { action: "start", strategy: strategy(overrides) }, "session-1").state; }
const replay = (state: SimulationState, ticks: ReturnType<typeof tick>[]) => applySimulationCommand(state, { action: "replay", ticks }, "replay-1");

test("paper fills debit only virtual cash and preserve per-tick liquidity across partial fills", () => {
  const initial = start();
  const first = replay(initial, [tick(0)]);
  assert.equal(initial.orders.length, 0);
  assert.equal(first.state.orders[0].status, "PARTIAL");
  assert.equal(first.state.positions["005930"].quantity, 1);
  assert.equal(first.state.cash, 100_000_000 - 70_000 - 11);
  assert.equal(first.summary.availableCash, first.state.cash - 140_000 - 22);
  const final = replay(first.state, [tick(1, 69_900), tick(2, 69_800)]);
  assert.equal(final.state.orders.length, 1, "no extra order without remaining liquidity");
  assert.equal(final.state.orders[0].filled, 3);
  assert.equal(final.state.orders[0].remaining, 0);
  assert.equal(final.state.orders[0].status, "FILLED");
  assert.equal(final.state.positions["005930"].cost, 209_733);
  assert.equal(final.summary.realOrdersSubmitted, 0);
});

test("non-crossing limits reserve cash and cancel releases it without fabricating a fill", () => {
  const current = replay(start({ limitPrice: 69_900 }), [tick(0)]).state;
  assert.equal(current.orders[0].status, "OPEN");
  assert.equal(current.cash, 100_000_000);
  assert.ok(simulationAvailableCash(current) < current.cash);
  const cancelled = applySimulationCommand(current, { action: "cancel", orderId: current.orders[0].id }, "cancel-1").state;
  assert.equal(simulationAvailableCash(cancelled), cancelled.cash);
  assert.equal(cancelled.orders[0].filled, 0);
});

test("market remainder cancels and cannot rest or consume liquidity twice", () => {
  const current = replay(start({ orderType: "MARKET", limitPrice: null }), [tick(0, 70_000, 1)]).state;
  assert.equal(current.orders[0].status, "CANCELLED");
  assert.equal(current.orders[0].remaining, 2);
  assert.equal(current.orders[0].filled, 1);
  assert.equal(current.orders[0].reservedCash, 0);
});

test("paper sell needs owned shares and realizes net cost including assumed fees", () => {
  const blocked = replay(start({ side: "SELL" }), [tick(0)]);
  assert.equal(blocked.state.orders.length, 0);
  assert.equal(blocked.events.at(-1)?.type, "RISK_BLOCKED");
  const bought = replay(start({ quantity: 1 }), [tick(0)]).state;
  const stopped = applySimulationCommand(bought, { action: "stop" }, "stop-1").state;
  const selling = start({ side: "SELL", triggerOperator: "GTE", triggerPrice: 70_100, limitPrice: 70_100, quantity: 1 }, stopped);
  const sold = replay(selling, [tick(1, 70_100)]).state;
  assert.equal(sold.positions["005930"].quantity, 0);
  assert.equal(sold.realizedPnl, 78);
  assert.equal(sold.cash, 100_000_078);
});

test("daily order cap, budget and cash block before accepting a virtual order", () => {
  const capped = replay(start({ quantity: 1, maxOrdersPerDay: 1 }), [tick(0), tick(1)]);
  assert.equal(capped.state.orders.length, 1);
  assert.equal(capped.events.at(-1)?.message, "하루 최대 주문 횟수");
  const initial = createSimulationState(); initial.cash = 1;
  const noCash = replay(start({}, initial), [tick(0)]);
  assert.equal(noCash.state.orders.length, 0);
  assert.equal(noCash.state.cash, 1);
});

test("replay validates complete batch before changing state and rejects duplicate/reversed ticks", () => {
  const current = start();
  assert.throws(() => replay(current, [tick(1), tick(0)]), /오름차순/);
  assert.equal(current.session?.ticks, 0);
  assert.throws(() => replay(current, [tick(0, 70_001)]), /호가단위/);
  const processed = replay(current, [tick(0)]).state;
  assert.throws(() => replay(processed, [tick(0)]), /오름차순/);
  assert.throws(() => normalizeReplayTicks([{ observedAt: "2026-10-28T09:00:00", price: 70_000, quantity: 1 }]), /시간대/);
  assert.throws(() => normalizeReplayTicks(Array(51).fill(tick(0))), /1~50/);
});

test("stopping cancels reservations, keeps positions and prevents further replay", () => {
  const current = replay(start(), [tick(0)]).state;
  const stopped = applySimulationCommand(current, { action: "stop" }, "stop-1").state;
  assert.equal(stopped.positions["005930"].quantity, 1);
  assert.equal(stopped.orders[0].status, "CANCELLED");
  assert.equal(simulationAvailableCash(stopped), stopped.cash);
  assert.throws(() => replay(stopped, [tick(1)]), /먼저 가상 운용/);
});

test("daily boundary uses KST independently of server timezone", () => {
  assert.equal(koreanTradingDay("2026-10-28T14:59:59Z"), "2026-10-28");
  assert.equal(koreanTradingDay("2026-10-28T15:00:00Z"), "2026-10-29");
});
