import { cancelPaperOrder, checkOrderRateLimit, getHydratedPaperRuntime, paperEngineWritesAvailable, submitPaperOrder, withPaperEngineMutationLock } from "../../../engine/apiRuntime";
import type { OrderType, Side, TimeInForce } from "../../../engine/matchingEngine";
import { instrumentFor } from "../../../engine/instrumentMaster";
import { hashPaperOrderIntent, paperOrderIdFor, type PaperOrderIntent } from "../../../engine/paperOrderIdentity";
import { getChatGPTUser } from "../../chatgpt-auth";
import { addAudit, ensurePaperUser, getIdempotencyRecord, getPaperAccount, listUserTradingState, ownerForOrder, preTradeRiskCheck, saveExecution, saveIdempotencyRecord, savePaperOrder } from "../../../db/trading";

export const dynamic = "force-dynamic";

type OrderPayload = {
  symbol?: string;
  side?: Side;
  type?: OrderType;
  timeInForce?: TimeInForce;
  price?: number | null;
  stopPrice?: number | null;
  quantity?: number;
};

const isSide = (value: unknown): value is Side => value === "BUY" || value === "SELL";
const isOrderType = (value: unknown): value is OrderType => value === "LIMIT" || value === "MARKET" || value === "MIDPOINT" || value === "STOP_LIMIT";
const isTif = (value: unknown): value is TimeInForce => value === "GTC" || value === "IOC" || value === "FOK";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  await ensurePaperUser(user);
  await getHydratedPaperRuntime();
  const state = await listUserTradingState(user.userId);
  const account = await getPaperAccount(user.userId);
  return Response.json({
    targetVenue: "NEXTRADE",
    integrationModel: "institutional_member_gateway",
    environment: "member_certification",
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
  if (!paperEngineWritesAvailable()) return Response.json({ error: "paper matching writes require the serialized PostgreSQL runtime" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const { participantId } = await ensurePaperUser(user);
  const rateLimit = checkOrderRateLimit(user.userId);
  if (!rateLimit.allowed) return Response.json({ error: "order rate limit exceeded", retryAfterSeconds: rateLimit.retryAfterSeconds }, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds), "Cache-Control": "no-store" } });
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!idempotencyKey || idempotencyKey.length > 128) return Response.json({ error: "Idempotency-Key header is required and must be at most 128 characters" }, { status: 400 });
  let payload: OrderPayload;
  try {
    payload = await request.json() as OrderPayload;
  } catch {
    return Response.json({ error: "request body must be valid JSON" }, { status: 400 });
  }

  const symbol = payload.symbol?.trim() ?? "";
  const instrument = instrumentFor(symbol);
  if (instrument.symbol !== symbol) return Response.json({ error: "unsupported symbol" }, { status: 400 });
  if (!isSide(payload.side)) return Response.json({ error: "side must be BUY or SELL" }, { status: 400 });
  if (!isOrderType(payload.type)) return Response.json({ error: "type must be LIMIT or MARKET" }, { status: 400 });
  if (payload.timeInForce !== undefined && !isTif(payload.timeInForce)) return Response.json({ error: "invalid timeInForce" }, { status: 400 });
  if (!Number.isSafeInteger(payload.quantity) || (payload.quantity ?? 0) <= 0) return Response.json({ error: "quantity must be a positive integer" }, { status: 400 });
  const quantity = payload.quantity as number;
  const intent: PaperOrderIntent = {
    symbol,
    side: payload.side,
    type: payload.type,
    timeInForce: payload.type === "MARKET" ? "IOC" : payload.timeInForce ?? "GTC",
    price: payload.type === "MARKET" || payload.type === "MIDPOINT" ? null : payload.price ?? null,
    stopPrice: payload.type === "STOP_LIMIT" ? payload.stopPrice ?? null : null,
    quantity,
  };
  const requestHash = await hashPaperOrderIntent(intent);
  const normalizedOrder = { id: await paperOrderIdFor(user.userId, idempotencyKey), participantId, ...intent } as const;

  return withPaperEngineMutationLock(async () => {
    const runtime = await getHydratedPaperRuntime();
    const replay = await getIdempotencyRecord(user.userId, idempotencyKey);
    if (replay) {
      if (replay.requestHash !== requestHash) return Response.json({ error: "idempotency key was already used with a different order" }, { status: 409 });
      return Response.json(JSON.parse(replay.responseJson), { status: Number(replay.statusCode), headers: { "Cache-Control": "no-store", "X-Idempotent-Replay": "true" } });
    }
    if (await ownerForOrder(normalizedOrder.id)) {
      const body = { error: "derived order id already exists without an idempotency record" };
      await saveIdempotencyRecord(user.userId, idempotencyKey, requestHash, 409, body);
      return Response.json(body, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if (runtime.venueControl?.haltMode !== "OPEN") {
      const body = { error: runtime.venueControl?.haltMode === "FULL_STOP" ? "venue is fully halted" : "venue accepts cancellations only", venueControl: runtime.venueControl };
      await saveIdempotencyRecord(user.userId, idempotencyKey, requestHash, 423, body);
      return Response.json(body, { status: 423, headers: { "Cache-Control": "no-store" } });
    }
    const referencePrice = payload.price ?? instrument.basePrice ?? 0;
    const riskError = await preTradeRiskCheck(user.userId, payload.side as Side, symbol, quantity, referencePrice);
    if (riskError) {
      await addAudit(user.userId, "ORDER_REJECTED", normalizedOrder.id, { reason: riskError, symbol, side: payload.side, quantity });
      const body = { error: riskError };
      await saveIdempotencyRecord(user.userId, idempotencyKey, requestHash, 422, body);
      return Response.json(body, { status: 422 });
    }
    const result = submitPaperOrder(normalizedOrder);
    if (result.order) await savePaperOrder(user.userId, result.order);
    for (const execution of result.executions) {
      for (const orderId of [execution.buyOrderId, execution.sellOrderId]) {
        const order = runtime.engine.getOrder(orderId);
        if (!order) continue;
        const owner = await ownerForOrder(orderId);
        if (!owner) throw new Error("paper order owner is missing during execution persistence");
        await savePaperOrder(owner.userId, order);
      }
      await saveExecution(execution);
    }
    await addAudit(user.userId, result.accepted ? "ORDER_ACCEPTED" : "ORDER_REJECTED", result.order?.id ?? normalizedOrder.id, { symbol, side: payload.side, quantity, executions: result.executions.length, reason: result.reason ?? null });
    const status = result.accepted ? 201 : 422;
    const body = { targetVenue: "NEXTRADE", integrationModel: "institutional_member_gateway", environment: "member_certification", ...result };
    await saveIdempotencyRecord(user.userId, idempotencyKey, requestHash, status, body);
    return Response.json(body, {
      status,
      headers: { "Cache-Control": "no-store", "X-RateLimit-Remaining": String(rateLimit.remaining) },
    });
  });
}

export async function DELETE() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  if (!paperEngineWritesAvailable()) return Response.json({ error: "paper matching writes require the serialized PostgreSQL runtime" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const rateLimit = checkOrderRateLimit(user.userId);
  if (!rateLimit.allowed) return Response.json({ error: "order rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } });
  const { participantId } = await ensurePaperUser(user);
  return withPaperEngineMutationLock(async () => {
    const runtime = await getHydratedPaperRuntime();
    if (runtime.venueControl?.haltMode === "FULL_STOP") return Response.json({ error: "venue is fully halted; cancellation is disabled" }, { status: 423 });
    const cancellable = [...runtime.orders.values()].filter((order) => order.participantId === participantId && (order.status === "OPEN" || order.status === "PARTIAL" || order.status === "PENDING_TRIGGER"));
    const cancelled = [];
    for (const order of cancellable) {
      const result = cancelPaperOrder(order.id, participantId);
      if (!result.cancelled || !result.order) continue;
      await savePaperOrder(user.userId, result.order);
      cancelled.push(result.order);
    }
    await addAudit(user.userId, "ORDERS_CANCELLED_ALL", null, { requested: cancellable.length, cancelled: cancelled.length });
    return Response.json({ venue: "NEXTRADE", environment: "member_certification", cancelledCount: cancelled.length, orders: cancelled }, { headers: { "Cache-Control": "no-store" } });
  });
}
