import { NEXTRADE_INSTRUMENTS } from "./instrumentMaster";

export type PriceCrossStrategy = {
  id: string;
  name: string;
  symbol: string;
  side: "BUY" | "SELL";
  strategyType: "PRICE_CROSS";
  triggerOperator: "GTE" | "LTE";
  triggerPrice: number;
  orderType: "LIMIT" | "MARKET";
  limitPrice: number | null;
  quantity: number;
  intervalSeconds: number;
  maxOrdersPerDay: number;
  maxDailyNotional: number;
  connectionId: null;
  status: "draft";
  executionMode: "paper";
};

export type StrategyIssue = {
  field: string;
  code: string;
  message: string;
};

export type PaperEvaluation = {
  decision: "WOULD_SUBMIT" | "CONDITION_WAITING" | "RISK_BLOCKED";
  triggered: boolean;
  simulated: true;
  orderSubmitted: false;
  observedPrice: number;
  priceSource: "USER_SCENARIO";
  projectedOrder: {
    symbol: string;
    side: "BUY" | "SELL";
    orderType: "LIMIT" | "MARKET";
    price: number | null;
    quantity: number;
  };
  estimatedNotional: number;
  checks: Array<{ key: string; passed: boolean; message: string }>;
  summary: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown) => Number.isSafeInteger(value) ? Number(value) : null;

export function normalizePriceCrossDraft(raw: unknown, id: string): { ok: true; strategy: PriceCrossStrategy; estimatedNotional: number } | { ok: false; issues: StrategyIssue[] } {
  const input = isRecord(raw) ? raw : {};
  const issues: StrategyIssue[] = [];
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const symbol = typeof input.symbol === "string" ? input.symbol.trim() : "";
  const instrument = NEXTRADE_INSTRUMENTS.find((item) => item.symbol === symbol);
  const side = input.side === "SELL" ? "SELL" : input.side === "BUY" ? "BUY" : null;
  const triggerOperator = input.triggerOperator === "GTE" ? "GTE" : input.triggerOperator === "LTE" ? "LTE" : null;
  const orderType = input.orderType === "MARKET" ? "MARKET" : input.orderType === "LIMIT" ? "LIMIT" : null;
  const triggerPrice = integer(input.triggerPrice);
  const requestedLimitPrice = integer(input.limitPrice);
  const quantity = integer(input.quantity);
  const maxOrdersPerDay = integer(input.maxOrdersPerDay);
  const maxDailyNotional = integer(input.maxDailyNotional);

  if (name.length < 2 || name.length > 60) issues.push({ field: "name", code: "INVALID_NAME", message: "전략 이름은 2~60자로 입력하세요." });
  if (!instrument) issues.push({ field: "symbol", code: "UNSUPPORTED_SYMBOL", message: "지원 종목 목록에서 종목을 선택하세요." });
  if (!side) issues.push({ field: "side", code: "INVALID_SIDE", message: "매수 또는 매도를 선택하세요." });
  if (!triggerOperator) issues.push({ field: "triggerOperator", code: "INVALID_TRIGGER_OPERATOR", message: "가격 이상 또는 이하 조건을 선택하세요." });
  if (!orderType) issues.push({ field: "orderType", code: "INVALID_ORDER_TYPE", message: "지정가 또는 시장가를 선택하세요." });
  if (!Number.isSafeInteger(triggerPrice) || (triggerPrice ?? 0) <= 0) issues.push({ field: "triggerPrice", code: "INVALID_TRIGGER_PRICE", message: "기준 가격은 0보다 큰 정수여야 합니다." });
  if (!Number.isSafeInteger(quantity) || (quantity ?? 0) < 1 || (quantity ?? 0) > 100_000) issues.push({ field: "quantity", code: "INVALID_QUANTITY", message: "수량은 1~100,000주 범위의 정수여야 합니다." });
  if (!Number.isSafeInteger(maxOrdersPerDay) || (maxOrdersPerDay ?? 0) < 1 || (maxOrdersPerDay ?? 0) > 100) issues.push({ field: "maxOrdersPerDay", code: "INVALID_DAILY_COUNT", message: "일일 최대 횟수는 1~100회여야 합니다." });
  if (!Number.isSafeInteger(maxDailyNotional) || (maxDailyNotional ?? 0) < 10_000 || (maxDailyNotional ?? 0) > 2_000_000_000) issues.push({ field: "maxDailyNotional", code: "INVALID_DAILY_BUDGET", message: "일일 예산은 1만원~20억원 범위여야 합니다." });

  if (instrument && triggerPrice != null) {
    if (triggerPrice < instrument.minPrice || triggerPrice > instrument.maxPrice) issues.push({ field: "triggerPrice", code: "TRIGGER_OUT_OF_RANGE", message: "기준 가격이 종목 가격 범위를 벗어났습니다." });
    if (triggerPrice % instrument.tickSize !== 0) issues.push({ field: "triggerPrice", code: "INVALID_TRIGGER_TICK", message: `기준 가격은 ${instrument.tickSize.toLocaleString("ko-KR")}원 단위로 입력하세요.` });
    if (triggerOperator === "GTE" && triggerPrice === instrument.minPrice) issues.push({ field: "triggerPrice", code: "NO_WAITING_SCENARIO", message: "최저가보다 한 호가 높은 가격을 입력해야 조건 대기 상황도 검증할 수 있습니다." });
    if (triggerOperator === "LTE" && triggerPrice === instrument.maxPrice) issues.push({ field: "triggerPrice", code: "NO_WAITING_SCENARIO", message: "최고가보다 한 호가 낮은 가격을 입력해야 조건 대기 상황도 검증할 수 있습니다." });
  }

  if (orderType === "LIMIT") {
    if (!Number.isSafeInteger(requestedLimitPrice) || (requestedLimitPrice ?? 0) <= 0) issues.push({ field: "limitPrice", code: "LIMIT_PRICE_REQUIRED", message: "지정가 주문에는 주문 가격이 필요합니다." });
    if (instrument && requestedLimitPrice != null) {
      if (requestedLimitPrice < instrument.minPrice || requestedLimitPrice > instrument.maxPrice) issues.push({ field: "limitPrice", code: "LIMIT_OUT_OF_RANGE", message: "주문 가격이 종목 가격 범위를 벗어났습니다." });
      if (requestedLimitPrice % instrument.tickSize !== 0) issues.push({ field: "limitPrice", code: "INVALID_LIMIT_TICK", message: `주문 가격은 ${instrument.tickSize.toLocaleString("ko-KR")}원 단위로 입력하세요.` });
    }
  }

  const referencePrice = orderType === "LIMIT" ? requestedLimitPrice : triggerPrice;
  const estimatedNotional = referencePrice != null && quantity != null ? referencePrice * quantity : 0;
  if (maxDailyNotional != null && estimatedNotional > maxDailyNotional) issues.push({ field: "maxDailyNotional", code: "ORDER_EXCEEDS_DAILY_BUDGET", message: "한 번의 예상 주문금액이 일일 예산보다 큽니다." });

  if (issues.length || !instrument || !side || !triggerOperator || !orderType || triggerPrice == null || quantity == null || maxOrdersPerDay == null || maxDailyNotional == null) return { ok: false, issues };

  return {
    ok: true,
    estimatedNotional,
    strategy: {
      id,
      name,
      symbol,
      side,
      strategyType: "PRICE_CROSS",
      triggerOperator,
      triggerPrice,
      orderType,
      limitPrice: orderType === "LIMIT" ? requestedLimitPrice : null,
      quantity,
      intervalSeconds: 60,
      maxOrdersPerDay,
      maxDailyNotional,
      connectionId: null,
      status: "draft",
      executionMode: "paper",
    },
  };
}

function canonicalStrategy(strategy: Omit<PriceCrossStrategy, "status"> | PriceCrossStrategy) {
  return {
    id: strategy.id,
    name: strategy.name,
    symbol: strategy.symbol,
    side: strategy.side,
    strategyType: strategy.strategyType,
    triggerOperator: strategy.triggerOperator,
    triggerPrice: strategy.triggerPrice,
    orderType: strategy.orderType,
    limitPrice: strategy.orderType === "LIMIT" ? strategy.limitPrice : null,
    quantity: strategy.quantity,
    intervalSeconds: strategy.intervalSeconds,
    maxOrdersPerDay: strategy.maxOrdersPerDay,
    maxDailyNotional: strategy.maxDailyNotional,
    executionMode: "paper",
  };
}

export async function hashAutomationStrategy(strategy: Omit<PriceCrossStrategy, "status"> | PriceCrossStrategy) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonicalStrategy(strategy)))));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function evaluatePriceCross(strategy: Omit<PriceCrossStrategy, "status"> | PriceCrossStrategy, observedPrice: number): PaperEvaluation {
  const instrument = NEXTRADE_INSTRUMENTS.find((item) => item.symbol === strategy.symbol);
  const checks = [
    { key: "SUPPORTED_SYMBOL", passed: Boolean(instrument), message: instrument ? `${instrument.displayName} 종목 규칙 확인` : "지원하지 않는 종목" },
    { key: "VALID_SCENARIO_PRICE", passed: Boolean(instrument && Number.isSafeInteger(observedPrice) && observedPrice >= instrument.minPrice && observedPrice <= instrument.maxPrice && observedPrice % instrument.tickSize === 0), message: "사용자 시나리오 가격의 범위와 호가단위 확인" },
  ];
  const projectedPrice = strategy.orderType === "LIMIT" ? strategy.limitPrice ?? 0 : observedPrice;
  const estimatedNotional = projectedPrice * strategy.quantity;
  checks.push({ key: "ORDER_BUDGET", passed: estimatedNotional <= strategy.maxDailyNotional, message: `예상 주문금액 ${estimatedNotional.toLocaleString("ko-KR")}원 / 일일 예산 ${strategy.maxDailyNotional.toLocaleString("ko-KR")}원` });
  checks.push({ key: "PAPER_ONLY", passed: strategy.executionMode === "paper", message: "실제 증권사 주문 경로와 분리된 Paper 판정" });

  const triggered = strategy.triggerOperator === "GTE" ? observedPrice >= strategy.triggerPrice : observedPrice <= strategy.triggerPrice;
  const blocked = checks.some((check) => !check.passed);
  const decision = blocked ? "RISK_BLOCKED" : triggered ? "WOULD_SUBMIT" : "CONDITION_WAITING";
  const summary = blocked
    ? "가격 또는 예산 검사를 통과하지 못해 가상 주문도 만들지 않았습니다."
    : triggered
      ? "조건이 충족되었습니다. 실제 주문은 보내지 않고 예상 주문만 기록했습니다."
      : "조건이 아직 충족되지 않았습니다. 실제 주문은 보내지 않았습니다.";

  return {
    decision,
    triggered: !blocked && triggered,
    simulated: true,
    orderSubmitted: false,
    observedPrice,
    priceSource: "USER_SCENARIO",
    projectedOrder: { symbol: strategy.symbol, side: strategy.side, orderType: strategy.orderType, price: strategy.orderType === "LIMIT" ? strategy.limitPrice : null, quantity: strategy.quantity },
    estimatedNotional,
    checks,
    summary,
  };
}

export type StrategyRunSummary = { status: string; detail: Record<string, unknown>; createdAt: string };

export function buildStrategyProgressFromCounts(validationCount: number, triggerCount: number, waitingCount: number) {
  const triggerScenarioPassed = triggerCount > 0;
  const waitingScenarioPassed = waitingCount > 0;
  return {
    validationCount,
    triggerScenarioPassed,
    waitingScenarioPassed,
    readyToMark: triggerScenarioPassed && waitingScenarioPassed,
    liveExecutionAvailable: false,
    completedSteps: Number(triggerScenarioPassed) + Number(waitingScenarioPassed),
    totalSteps: 2,
  };
}

export function buildStrategyProgress(strategyFingerprint: string, runs: StrategyRunSummary[]) {
  const currentRuns = runs.filter((run) => run.detail.strategyFingerprint === strategyFingerprint);
  return buildStrategyProgressFromCounts(currentRuns.length, currentRuns.filter((run) => run.status === "WOULD_SUBMIT").length, currentRuns.filter((run) => run.status === "CONDITION_WAITING").length);
}
