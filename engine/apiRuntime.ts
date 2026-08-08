import { MatchingEngine, type Execution, type Order, type SubmitOrderInput } from "./matchingEngine";
import { NEXTRADE_INSTRUMENTS } from "./instrumentMaster";
import { listOpenOrdersForHydration } from "../db/trading";

export interface PaperRuntime {
  engine: MatchingEngine;
  orders: Map<string, Order>;
  executions: Execution[];
}

type TradingGlobal = typeof globalThis & { __tradingStockSysyemPaperRuntime?: PaperRuntime };

const globalRuntime = globalThis as TradingGlobal;

export const getPaperRuntime = (): PaperRuntime => {
  if (!globalRuntime.__tradingStockSysyemPaperRuntime) {
    globalRuntime.__tradingStockSysyemPaperRuntime = {
      engine: new MatchingEngine("CANCEL_TAKER", NEXTRADE_INSTRUMENTS),
      orders: new Map<string, Order>(),
      executions: [],
    };
  }
  return globalRuntime.__tradingStockSysyemPaperRuntime;
};

let hydrationPromise: Promise<PaperRuntime> | null = null;

export async function getHydratedPaperRuntime(): Promise<PaperRuntime> {
  if (!hydrationPromise) {
    hydrationPromise = (async () => {
      const runtime = getPaperRuntime();
      if (runtime.orders.size > 0 || runtime.engine.sequenceNumber > 0) return runtime;
      const openOrders = await listOpenOrdersForHydration();
      for (const order of openOrders) {
        const result = runtime.engine.submit({
          id: order.id,
          symbol: order.symbol,
          participantId: order.participantId,
          side: order.side,
          type: order.type,
          timeInForce: order.timeInForce,
          price: order.price,
          stopPrice: order.stopPrice,
          quantity: order.remaining,
        });
        if (result.order) runtime.orders.set(result.order.id, result.order);
      }
      return runtime;
    })().catch((error) => {
      hydrationPromise = null;
      throw error;
    });
  }
  return hydrationPromise;
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
