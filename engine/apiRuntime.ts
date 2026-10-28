import { MatchingEngine, type Execution, type Order, type SubmitOrderInput } from "./matchingEngine";
import { NEXTRADE_INSTRUMENTS } from "./instrumentMaster";
import { getLastPaperEngineSequence, savePaperEngineSequence, getVenueControl, listOpenOrdersForHydration, type VenueControlState } from "../db/trading";
import { withDistributedEngineLock } from "./distributedLock";
import { bridgePaperEventSource } from "./paperEventBroadcaster";

export interface PaperRuntime {
  engine: MatchingEngine;
  orders: Map<string, Order>;
  executions: Execution[];
  venueControl: VenueControlState | null;
}

type TradingGlobal = typeof globalThis & {
  __tradingStockSysyemPaperRuntime?: PaperRuntime;
  __tradingStockSysyemMutationTail?: Promise<void>;
  __tradingStockSysyemRateLimits?: Map<string, { windowStartedAt: number; count: number }>;
};

const globalRuntime = globalThis as TradingGlobal;

export const getPaperRuntime = (): PaperRuntime => {
  if (!globalRuntime.__tradingStockSysyemPaperRuntime || typeof globalRuntime.__tradingStockSysyemPaperRuntime.engine.restoreSequence !== "function") {
    globalRuntime.__tradingStockSysyemPaperRuntime = {
      engine: new MatchingEngine("CANCEL_TAKER", NEXTRADE_INSTRUMENTS),
      orders: new Map<string, Order>(),
      executions: [],
      venueControl: null,
    };
  }
  bridgePaperEventSource(globalRuntime.__tradingStockSysyemPaperRuntime.engine);
  return globalRuntime.__tradingStockSysyemPaperRuntime;
};

let hydrationPromise: Promise<PaperRuntime> | null = null;

export async function getHydratedPaperRuntime(): Promise<PaperRuntime> {
  if (!hydrationPromise) {
    hydrationPromise = (async () => {
      const runtime = getPaperRuntime();
      if (runtime.orders.size > 0 || runtime.engine.sequenceNumber > 0) {
        if (!runtime.venueControl) applyVenueControl(await getVenueControl());
        return runtime;
      }
      const [openOrders, lastSequence, venueControl] = await Promise.all([listOpenOrdersForHydration(), getLastPaperEngineSequence(), getVenueControl()]);
      runtime.engine.restoreSequence(lastSequence);
      for (const order of openOrders) {
        runtime.engine.restoreOpenOrder(order);
        runtime.orders.set(order.id, order);
      }
      runtime.venueControl = venueControl;
      runtime.engine.setMarketPhase(runtime.venueControl.haltMode === "OPEN" ? runtime.venueControl.phase : "CLOSED");
      return runtime;
    })().catch((error) => {
      hydrationPromise = null;
      throw error;
    });
  }
  return hydrationPromise;
}

async function reloadHydratedPaperRuntime() {
  globalRuntime.__tradingStockSysyemPaperRuntime = undefined;
  hydrationPromise = null;
  return getHydratedPaperRuntime();
}

export function paperEngineWritesAvailable() {
  return Boolean(process.env.DATABASE_URL) && process.env.MATCHING_ENGINE_SINGLE_WRITER === "true";
}

export function applyVenueControl(state: VenueControlState) {
  const runtime = getPaperRuntime();
  runtime.venueControl = state;
  runtime.engine.setMarketPhase(state.haltMode === "OPEN" ? state.phase : "CLOSED");
}

export function checkOrderRateLimit(key: string, now = Date.now(), limit = 40, windowMs = 10_000) {
  const limits = globalRuntime.__tradingStockSysyemRateLimits ?? new Map<string, { windowStartedAt: number; count: number }>();
  globalRuntime.__tradingStockSysyemRateLimits = limits;
  const current = limits.get(key);
  if (!current || now - current.windowStartedAt >= windowMs) {
    limits.set(key, { windowStartedAt: now, count: 1 });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  if (current.count >= limit) return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - current.windowStartedAt)) / 1000)) };
  current.count += 1;
  return { allowed: true, remaining: limit - current.count, retryAfterSeconds: 0 };
}

export async function withTradingMutationLock<T>(task: () => Promise<T>): Promise<T> {
  const previous = globalRuntime.__tradingStockSysyemMutationTail ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = () => resolve(); });
  globalRuntime.__tradingStockSysyemMutationTail = previous.then(() => gate, () => gate);
  await previous.catch(() => undefined);
  try {
    return await withDistributedEngineLock(task);
  } finally {
    release();
  }
}

export async function withPaperEngineMutationLock<T>(task: () => Promise<T>): Promise<T> {
  if (!paperEngineWritesAvailable()) throw new Error("paper matching writes require PostgreSQL serialization");
  return withTradingMutationLock(async () => {
    const runtime = await reloadHydratedPaperRuntime();
    try { return await task(); }
    finally { await savePaperEngineSequence(runtime.engine.sequenceNumber); }
  });
}

export function submitPaperOrder(input: SubmitOrderInput) {
  const runtime = getPaperRuntime();
  const result = runtime.engine.submit(input);
  if (result.order) runtime.orders.set(result.order.id, result.order);
  if (result.executions.length) runtime.executions.unshift(...result.executions);
  return result;
}

export function cancelPaperOrder(orderId: string, participantId: string) {
  const runtime = getPaperRuntime();
  const result = runtime.engine.cancel(orderId, participantId);
  if (result.order) runtime.orders.set(result.order.id, result.order);
  return result;
}

export function replacePaperOrder(orderId: string, participantId: string, quantity: number, price?: number | null) {
  const runtime = getPaperRuntime();
  const current = runtime.engine.getOrder(orderId);
  const result = runtime.engine.replace(orderId, quantity, price, participantId);
  if (result.order) runtime.orders.set(result.order.id, result.order);
  if (current) runtime.orders.set(orderId, runtime.engine.getOrder(orderId) ?? current);
  if (result.executions.length) runtime.executions.unshift(...result.executions);
  return result;
}
