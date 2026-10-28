import { NEXTRADE_INSTRUMENTS } from "./instrumentMaster";
import { normalizePriceCrossDraft, type PriceCrossStrategy } from "./automationStrategy";

export type PaperTick = { price: number; quantity: number; observedAt: string };
export type SimulationOrder = {
  id: string; sessionId: string; symbol: string; side: "BUY" | "SELL"; type: "LIMIT" | "MARKET";
  price: number | null; quantity: number; remaining: number; filled: number; averagePrice: number;
  fees: number; reservedCash: number; status: "OPEN" | "PARTIAL" | "FILLED" | "CANCELLED" | "REJECTED";
  createdAt: string; updatedAt: string; reason: string | null;
};
export type SimulationEvent = { type: string; at: string; orderId?: string; price?: number; quantity?: number; message: string };
export type SimulationState = {
  schemaVersion: 1; initialCash: number; cash: number; realizedPnl: number; fees: number;
  positions: Record<string, { quantity: number; cost: number }>;
  marks: Record<string, number>; orders: SimulationOrder[]; sequence: number;
  session: null | { id: string; strategy: PriceCrossStrategy; status: "RUNNING" | "STOPPED"; startedAt: string; lastTickAt: string | null; ticks: number; day: string | null; dailyOrders: number; dailyNotional: number };
};
export type SimulationCommand =
  | { action: "start"; strategy: PriceCrossStrategy }
  | { action: "stop" }
  | { action: "cancel"; orderId: string }
  | { action: "replay"; ticks: PaperTick[] };

export const createSimulationState = (): SimulationState => ({ schemaVersion: 1, initialCash: 100_000_000, cash: 100_000_000, realizedPnl: 0, fees: 0, positions: {}, marks: {}, orders: [], sequence: 0, session: null });
export const simulationFee = (notional: number) => Math.ceil(notional * 15 / 100_000);
export const koreanTradingDay = (at: string | Date) => new Date(new Date(at).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const open = (order: SimulationOrder) => order.status === "OPEN" || order.status === "PARTIAL";
export const simulationAvailableCash = (state: SimulationState) => state.cash - state.orders.filter(open).reduce((sum, order) => sum + order.reservedCash, 0);
export const simulationEquity = (state: SimulationState) => state.cash + Object.entries(state.positions).reduce((sum, [symbol, position]) => sum + (state.marks[symbol] ?? (position.quantity ? position.cost / position.quantity : 0)) * position.quantity, 0);
const reservedShares = (state: SimulationState, symbol: string) => state.orders.filter((order) => open(order) && order.symbol === symbol && order.side === "SELL").reduce((sum, order) => sum + order.remaining, 0);

export function normalizeReplayTicks(raw: unknown): PaperTick[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 50) throw new Error("가격 기록은 한 번에 1~50개를 보내세요.");
  return raw.map((item) => {
    if (!item || typeof item !== "object") throw new Error("가격 기록 형식을 확인하세요.");
    const { price, quantity, observedAt } = item as Record<string, unknown>;
    if (!Number.isSafeInteger(price) || Number(price) < 1 || Number(price) > 10_000_000 || !Number.isSafeInteger(quantity) || Number(quantity) < 1 || Number(quantity) > 1_000_000) throw new Error("가격과 틱별 체결 가능 수량은 허용 범위의 양의 정수여야 합니다.");
    if (typeof observedAt !== "string" || !Number.isFinite(Date.parse(observedAt)) || !/(Z|[+-]\d{2}:\d{2})$/.test(observedAt)) throw new Error("시각은 시간대가 포함된 ISO 형식으로 입력하세요.");
    return { price: Number(price), quantity: Number(quantity), observedAt: new Date(observedAt).toISOString() };
  });
}

export function applySimulationCommand(previous: SimulationState, command: SimulationCommand, commandId: string, now = new Date().toISOString()) {
  const state = structuredClone(previous);
  const events: SimulationEvent[] = [];
  const cancel = (order: SimulationOrder, at: string) => {
    order.status = "CANCELLED"; order.reservedCash = 0; order.updatedAt = at;
    events.push({ type: "CANCELLED", at, orderId: order.id, message: "가상 미체결 잔량을 취소했습니다." });
  };
  if (command.action === "start") {
    if (state.session?.status === "RUNNING") throw new Error("현재 운용을 중지한 뒤 새 전략을 시작하세요.");
    const normalized = normalizePriceCrossDraft(command.strategy, command.strategy.id);
    if (!normalized.ok) throw new Error(normalized.issues[0].message);
    state.session = { id: commandId, strategy: normalized.strategy, status: "RUNNING", startedAt: now, lastTickAt: null, ticks: 0, day: null, dailyOrders: 0, dailyNotional: 0 };
    events.push({ type: "STARTED", at: now, message: "전략 설정을 복사해 가상 운용을 시작했습니다. 가격 기록을 기다립니다." });
  } else if (command.action === "stop") {
    if (!state.session || state.session.status !== "RUNNING") throw new Error("실행 중인 가상 운용이 없습니다.");
    state.session.status = "STOPPED";
    state.orders.filter(open).forEach((order) => cancel(order, now));
    events.push({ type: "STOPPED", at: now, message: "가상 운용을 중지했습니다. 보유종목과 원장은 보존됩니다." });
  } else if (command.action === "cancel") {
    const order = state.orders.find((item) => item.id === command.orderId && open(item));
    if (!order) throw new Error("취소 가능한 가상 주문이 없습니다.");
    cancel(order, now);
  } else {
    const session = state.session;
    if (!session || session.status !== "RUNNING") throw new Error("먼저 가상 운용을 시작하세요.");
    const ticks = normalizeReplayTicks(command.ticks);
    const strategy = session.strategy;
    const instrument = NEXTRADE_INSTRUMENTS.find((item) => item.symbol === strategy.symbol)!;
    let lastAt = session.lastTickAt;
    for (const tick of ticks) {
      if (lastAt && Date.parse(tick.observedAt) <= Date.parse(lastAt)) throw new Error("가격 기록은 이전 기록보다 늦은 시각부터 오름차순으로 입력하세요.");
      if (tick.price < instrument.minPrice || tick.price > instrument.maxPrice || tick.price % instrument.tickSize !== 0) throw new Error(`가격은 ${instrument.tickSize}원 호가단위와 종목 범위를 지켜야 합니다.`);
      lastAt = tick.observedAt;
    }
    for (const tick of ticks) {
      session.lastTickAt = tick.observedAt; session.ticks += 1; state.marks[strategy.symbol] = tick.price;
      const day = koreanTradingDay(tick.observedAt);
      if (session.day !== day) { session.day = day; session.dailyOrders = 0; session.dailyNotional = 0; }
      let liquidity = tick.quantity;
      const fill = (order: SimulationOrder) => {
        const crosses = order.type === "MARKET" || (order.side === "BUY" ? tick.price <= order.price! : tick.price >= order.price!);
        if (!crosses || liquidity === 0) return;
        const quantity = Math.min(order.remaining, liquidity);
        const notional = tick.price * quantity;
        const fee = simulationFee(notional);
        const position = state.positions[order.symbol] ?? { quantity: 0, cost: 0 };
        if (order.side === "BUY") {
          if (state.cash < notional + fee) throw new Error("가상 잔고 무결성 검사에 실패했습니다.");
          state.cash -= notional + fee; position.quantity += quantity; position.cost += notional + fee;
        } else {
          if (position.quantity < quantity) throw new Error("가상 보유수량 무결성 검사에 실패했습니다.");
          const consumedCost = quantity === position.quantity ? position.cost : Math.floor(position.cost * quantity / position.quantity);
          state.cash += notional - fee; state.realizedPnl += notional - fee - consumedCost;
          position.quantity -= quantity; position.cost -= consumedCost;
        }
        state.positions[order.symbol] = position; state.fees += fee;
        order.averagePrice = Math.round((order.averagePrice * order.filled + notional) / (order.filled + quantity));
        order.filled += quantity; order.remaining -= quantity; order.fees += fee;
        order.reservedCash = order.side === "BUY" && order.type === "LIMIT" && order.remaining ? order.price! * order.remaining + order.remaining * simulationFee(order.price!) : 0;
        order.status = order.remaining ? "PARTIAL" : "FILLED"; order.updatedAt = tick.observedAt; liquidity -= quantity;
        events.push({ type: "FILLED", at: tick.observedAt, orderId: order.id, price: tick.price, quantity, message: `입력 가격에서 ${quantity}주 가상 체결` });
      };
      state.orders.filter(open).forEach(fill);
      const triggered = strategy.triggerOperator === "LTE" ? tick.price <= strategy.triggerPrice : tick.price >= strategy.triggerPrice;
      if (!triggered) { events.push({ type: "WAITING", at: tick.observedAt, message: "가격 조건을 기다립니다." }); continue; }
      if (state.orders.some(open)) { events.push({ type: "PENDING", at: tick.observedAt, message: "기존 미체결 주문을 먼저 처리합니다." }); continue; }
      if (liquidity === 0) { events.push({ type: "LIQUIDITY_WAIT", at: tick.observedAt, message: "이 기록의 체결 가능 수량을 모두 사용했습니다." }); continue; }
      const reference = strategy.orderType === "MARKET" ? tick.price : strategy.limitPrice!;
      const notional = reference * strategy.quantity;
      const reservation = notional + strategy.quantity * simulationFee(reference);
      const availableShares = (state.positions[strategy.symbol]?.quantity ?? 0) - reservedShares(state, strategy.symbol);
      const reason = session.dailyOrders >= strategy.maxOrdersPerDay ? "하루 최대 주문 횟수" : session.dailyNotional + notional > strategy.maxDailyNotional ? "하루 최대 주문금액" : strategy.side === "BUY" && reservation > simulationAvailableCash(state) ? "가상 예수금 부족" : strategy.side === "SELL" && strategy.quantity > availableShares ? "가상 보유수량 부족" : null;
      if (reason) { events.push({ type: "RISK_BLOCKED", at: tick.observedAt, message: reason }); continue; }
      const order: SimulationOrder = { id: `SIM-${++state.sequence}`, sessionId: session.id, symbol: strategy.symbol, side: strategy.side, type: strategy.orderType, price: strategy.limitPrice, quantity: strategy.quantity, remaining: strategy.quantity, filled: 0, averagePrice: 0, fees: 0, reservedCash: strategy.side === "BUY" ? reservation : 0, status: "OPEN", createdAt: tick.observedAt, updatedAt: tick.observedAt, reason: null };
      state.orders.push(order); session.dailyOrders += 1; session.dailyNotional += notional;
      events.push({ type: "ACCEPTED", at: tick.observedAt, orderId: order.id, message: "가상 주문을 접수했습니다." });
      fill(order);
      if (order.type === "MARKET" && order.remaining) { cancel(order, tick.observedAt); order.reason = "MARKET_REMAINDER"; }
    }
  }
  // Complete command events remain in the durable command journal; bound only the UI snapshot.
  state.orders = [...state.orders.filter((order) => !open(order)).slice(-100), ...state.orders.filter(open)].sort((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4)));
  return { state, events, summary: { equity: simulationEquity(state), availableCash: simulationAvailableCash(state), priceSource: "USER_REPLAY" as const, feeModelBps: 1.5, realOrdersSubmitted: 0 } };
}
