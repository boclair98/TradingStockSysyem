import assert from "node:assert/strict";
import test from "node:test";
import { buildStrategyProgress, evaluatePriceCross, hashAutomationStrategy, normalizePriceCrossDraft } from "../engine/automationStrategy";

const validInput = {
  name: "삼성전자 가격 도달 매수",
  symbol: "005930",
  side: "BUY",
  triggerOperator: "LTE",
  triggerPrice: 70_000,
  orderType: "LIMIT",
  limitPrice: 69_900,
  quantity: 2,
  maxOrdersPerDay: 2,
  maxDailyNotional: 500_000,
};

test("normalizes every new or edited strategy to a paper draft", () => {
  const result = normalizePriceCrossDraft({ ...validInput, status: "armed", executionMode: "production", strategyType: "BROKER_CONDITIONAL" }, "AUTO-test-normalization");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.strategy.status, "draft");
  assert.equal(result.strategy.executionMode, "paper");
  assert.equal(result.strategy.strategyType, "PRICE_CROSS");
  assert.equal(result.strategy.connectionId, null);
  assert.equal(result.estimatedNotional, 139_800);
});

test("rejects unsupported symbols, invalid ticks and an order larger than its daily budget", () => {
  const unsupported = normalizePriceCrossDraft({ ...validInput, symbol: "999999" }, "AUTO-unsupported-symbol");
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.ok(unsupported.issues.some((issue) => issue.code === "UNSUPPORTED_SYMBOL"));

  const badTick = normalizePriceCrossDraft({ ...validInput, triggerPrice: 70_050 }, "AUTO-invalid-tick");
  assert.equal(badTick.ok, false);
  if (!badTick.ok) assert.ok(badTick.issues.some((issue) => issue.code === "INVALID_TRIGGER_TICK"));

  const overBudget = normalizePriceCrossDraft({ ...validInput, maxDailyNotional: 100_000 }, "AUTO-over-budget");
  assert.equal(overBudget.ok, false);
  if (!overBudget.ok) assert.ok(overBudget.issues.some((issue) => issue.code === "ORDER_EXCEEDS_DAILY_BUDGET"));
  const databaseOverflow = normalizePriceCrossDraft({ ...validInput, maxDailyNotional: 3_000_000_000 }, "AUTO-database-overflow");
  assert.equal(databaseOverflow.ok, false);
  if (!databaseOverflow.ok) assert.ok(databaseOverflow.issues.some((issue) => issue.code === "INVALID_DAILY_BUDGET"));
});

test("rejects trigger boundaries that make a waiting scenario impossible", () => {
  const gteAtFloor = normalizePriceCrossDraft({ ...validInput, triggerOperator: "GTE", triggerPrice: 100 }, "AUTO-gte-floor");
  assert.equal(gteAtFloor.ok, false);
  if (!gteAtFloor.ok) assert.ok(gteAtFloor.issues.some((issue) => issue.code === "NO_WAITING_SCENARIO"));

  const lteAtCeiling = normalizePriceCrossDraft({ ...validInput, triggerOperator: "LTE", triggerPrice: 10_000_000 }, "AUTO-lte-ceiling");
  assert.equal(lteAtCeiling.ok, false);
  if (!lteAtCeiling.ok) assert.ok(lteAtCeiling.issues.some((issue) => issue.code === "NO_WAITING_SCENARIO"));
});

test("evaluates LTE and GTE at the exact boundary without submitting an order", () => {
  const lte = normalizePriceCrossDraft(validInput, "AUTO-lte-boundary");
  assert.equal(lte.ok, true);
  if (!lte.ok) return;
  const lteEvaluation = evaluatePriceCross(lte.strategy, 70_000);
  assert.equal(lteEvaluation.decision, "WOULD_SUBMIT");
  assert.equal(lteEvaluation.triggered, true);
  assert.equal(lteEvaluation.orderSubmitted, false);
  assert.equal(lteEvaluation.priceSource, "USER_SCENARIO");

  const gte = normalizePriceCrossDraft({ ...validInput, triggerOperator: "GTE" }, "AUTO-gte-boundary");
  assert.equal(gte.ok, true);
  if (!gte.ok) return;
  assert.equal(evaluatePriceCross(gte.strategy, 69_900).decision, "CONDITION_WAITING");
  assert.equal(evaluatePriceCross(gte.strategy, 70_000).decision, "WOULD_SUBMIT");
});

test("changes the strategy fingerprint after an execution field changes", async () => {
  const original = normalizePriceCrossDraft(validInput, "AUTO-fingerprint");
  const changed = normalizePriceCrossDraft({ ...validInput, quantity: 3 }, "AUTO-fingerprint");
  assert.equal(original.ok, true);
  assert.equal(changed.ok, true);
  if (!original.ok || !changed.ok) return;
  assert.notEqual(await hashAutomationStrategy(original.strategy), await hashAutomationStrategy(changed.strategy));
});

test("requires both trigger and waiting scenarios for readiness", () => {
  const fingerprint = "abc123";
  const oneSide = buildStrategyProgress(fingerprint, [{ status: "WOULD_SUBMIT", detail: { strategyFingerprint: fingerprint }, createdAt: new Date().toISOString() }]);
  assert.equal(oneSide.readyToMark, false);
  const bothSides = buildStrategyProgress(fingerprint, [
    { status: "WOULD_SUBMIT", detail: { strategyFingerprint: fingerprint }, createdAt: new Date().toISOString() },
    { status: "CONDITION_WAITING", detail: { strategyFingerprint: fingerprint }, createdAt: new Date().toISOString() },
  ]);
  assert.equal(bothSides.readyToMark, true);
  assert.equal(bothSides.liveExecutionAvailable, false);
});
