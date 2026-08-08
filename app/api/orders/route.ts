import { cancelPaperOrder, getHydratedPaperRuntime, submitPaperOrder, withTradingMutationLock } from "../../../engine/apiRuntime";
import { getBrokerReadiness, toBrokerOrderEnvelope, type VenuePreference } from "../../../engine/brokerGateway";
import type { OrderType, Side, TimeInForce } from "../../../engine/matchingEngine";
import { instrumentFor } from "../../../engine/instrumentMaster";
import { getChatGPTUser } from "../../chatgpt-auth";
import { addAudit, ensurePaperUser, getPaperAccount, listUserTradingState, ownerForOrder, preTradeRiskCheck, saveExecution, savePaperOrder } from "../../../db/trading";

export const dynamic = "force-dynamic";

type OrderPayload = {
  id?: string;
  symbol?: string;
  participantId?: string;
  side?: Side;
  type?: OrderType;
  timeInForce?: TimeInForce;
  price?: number | null;
  stopPrice?: number | null;
  quantity?: number;
  live?: boolean;
  accountId?: string;
  venuePreference?: VenuePreference;
};

const isSide = (value: unknown): value is Side => value === "BUY" || value === "SELL";
const isOrderType = (value: unknown): value is OrderType => value === "LIMIT" || value === "MARKET" || value === "MIDPOINT" || value === "STOP_LIMIT";
const isTif = (value: unknown): value is TimeInForce => value === "GTC" || value === "IOC" || value === "FOK";
const isVenuePreference = (value: unknown): value is VenuePreference => value === "AUTO" || value === "KRX" || value === "NEXTRADE";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  await ensurePaperUser(user);
  const runtime = await getHydratedPaperRuntime();
  const broker = getBrokerReadiness();
  const state = await listUserTradingState(user.userId);
  const account = await getPaperAccount(user.userId);
  return Response.json({
    targetVenue: "NEXTRADE",
    integrationModel: "securities_broker_api",
    broker: { provider: broker.provider, mode: broker.mode, status: broker.status },
    mode: "paper",
    participantId: account.participantId,
    account,
    orders: state.orders,
    executions: state.executions,
    events: [],
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  const { participantId } = await ensurePaperUser(user);
  let payload: OrderPayload;
  try {
    payload = await request.json() as OrderPayload;
  } catch {
    return Response.json({ error: "request body must be valid JSON" }, { status: 400 });
  }

  const broker = getBrokerReadiness();
  if (payload.live === true) {
    return Response.json({
      error: broker.configured
        ? "selected securities-company adapter is configured but its official transport is not implemented yet"
        : "live broker routing is disabled until a securities-company sandbox is configured",
      broker,
    }, { status: broker.configured ? 501 : 409 });
  }

  const symbol = payload.symbol?.trim() ?? "";
  const instrument = instrumentFor(symbol);
  if (instrument.symbol !== symbol) return Response.json({ error: "unsupported symbol" }, { status: 400 });
  if (!isSide(payload.side)) return Response.json({ error: "side must be BUY or SELL" }, { status: 400 });
  if (!isOrderType(payload.type)) return Response.json({ error: "type must be LIMIT or MARKET" }, { status: 400 });
  if (payload.timeInForce !== undefined && !isTif(payload.timeInForce)) return Response.json({ error: "invalid timeInForce" }, { status: 400 });
  if (payload.venuePreference !== undefined && !isVenuePreference(payload.venuePreference)) return Response.json({ error: "venuePreference must be AUTO, KRX, or NEXTRADE" }, { status: 400 });
  if (!Number.isSafeInteger(payload.quantity) || (payload.quantity ?? 0) <= 0) return Response.json({ error: "quantity must be a positive integer" }, { status: 400 });
  const quantity = payload.quantity as number;
  const normalizedOrder = {
    id: payload.id?.trim() || `API-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    symbol,
    participantId,
    side: payload.side,
    type: payload.type,
    timeInForce: payload.type === "MARKET" ? "IOC" : payload.timeInForce ?? "GTC",
    price: payload.type === "MARKET" || payload.type === "MIDPOINT" ? null : payload.price ?? null,
    stopPrice: payload.type === "STOP_LIMIT" ? payload.stopPrice ?? null : null,
    quantity,
    venuePreference: payload.venuePreference ?? broker.venuePreference,
    accountId: payload.accountId?.trim() || undefined,
  } as const;
  const brokerOrder = toBrokerOrderEnvelope(normalizedOrder);

  return withTradingMutationLock(async () => {
    const runtime = await getHydratedPaperRuntime();
    const referencePrice = payload.price ?? instrument.basePrice ?? 0;
    const riskError = await preTradeRiskCheck(user.userId, payload.side as Side, symbol, quantity, referencePrice);
    if (riskError) {
      await addAudit(user.userId, "ORDER_REJECTED", normalizedOrder.id, { reason: riskError, symbol, side: payload.side, quantity });
      return Response.json({ error: riskError }, { status: 422 });
    }
    const result = submitPaperOrder(normalizedOrder);
    if (result.order) await savePaperOrder(user.userId, result.order);
    for (const execution of result.executions) {
      for (const orderId of [execution.buyOrderId, execution.sellOrderId]) {
        const order = runtime.engine.getOrder(orderId);
        if (!order) continue;
        const owner = await ownerForOrder(orderId);
        await savePaperOrder(owner?.userId ?? user.userId, order);
      }
      await saveExecution(execution);
    }
    await addAudit(user.userId, result.accepted ? "ORDER_ACCEPTED" : "ORDER_REJECTED", result.order?.id ?? normalizedOrder.id, { symbol, side: payload.side, quantity, executions: result.executions.length, reason: result.reason ?? null });
    return Response.json({ targetVenue: brokerOrder.venuePreference, integrationModel: "securities_broker_api", broker: broker.provider, mode: "paper", brokerOrder, ...result }, {
      status: result.accepted ? 201 : 422,
      headers: { "Cache-Control": "no-store" },
    });
  });
}

export async function DELETE() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  const { participantId } = await ensurePaperUser(user);
  return withTradingMutationLock(async () => {
    const runtime = await getHydratedPaperRuntime();
    const cancellable = [...runtime.orders.values()].filter((order) => order.participantId === participantId && (order.status === "OPEN" || order.status === "PARTIAL" || order.status === "PENDING_TRIGGER"));
    const cancelled = [];
    for (const order of cancellable) {
      const result = cancelPaperOrder(order.id, participantId);
      if (!result.cancelled || !result.order) continue;
      await savePaperOrder(user.userId, result.order);
      cancelled.push(result.order);
    }
    await addAudit(user.userId, "ORDERS_CANCELLED_ALL", null, { requested: cancellable.length, cancelled: cancelled.length });
    return Response.json({ venue: "NEXTRADE", mode: "paper", cancelledCount: cancelled.length, orders: cancelled }, { headers: { "Cache-Control": "no-store" } });
  });
}
