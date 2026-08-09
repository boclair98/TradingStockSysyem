import { cancelPaperOrder, checkOrderRateLimit, getHydratedPaperRuntime, replacePaperOrder, withTradingMutationLock } from "../../../../engine/apiRuntime";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { addAudit, ensurePaperUser, ownerForOrder, saveExecution, savePaperOrder } from "../../../../db/trading";

export async function DELETE(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  const rateLimit = checkOrderRateLimit(user.userId);
  if (!rateLimit.allowed) return Response.json({ error: "order rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } });
  const { participantId } = await ensurePaperUser(user);
  const { orderId } = await params;
  return withTradingMutationLock(async () => {
    const runtime = await getHydratedPaperRuntime();
    if (runtime.venueControl?.haltMode === "FULL_STOP") return Response.json({ error: "venue is fully halted; cancellation is disabled" }, { status: 423 });
    const result = cancelPaperOrder(orderId, participantId);
    if (result.order) await savePaperOrder(user.userId, result.order);
    await addAudit(user.userId, result.cancelled ? "ORDER_CANCELLED" : "ORDER_CANCEL_REJECTED", orderId, { reason: result.reason ?? null });
    return Response.json({ venue: "NEXTRADE", environment: "member_certification", ...result }, {
      status: result.cancelled ? 200 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  const rateLimit = checkOrderRateLimit(user.userId);
  if (!rateLimit.allowed) return Response.json({ error: "order rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } });
  const { participantId } = await ensurePaperUser(user);
  const { orderId } = await params;
  let payload: { quantity?: number; price?: number | null };
  try {
    payload = await request.json() as { quantity?: number; price?: number | null };
  } catch {
    return Response.json({ error: "request body must be valid JSON" }, { status: 400 });
  }
  if (!Number.isSafeInteger(payload.quantity) || (payload.quantity ?? 0) <= 0) {
    return Response.json({ error: "quantity must be a positive integer" }, { status: 400 });
  }
  const quantity = payload.quantity as number;
  return withTradingMutationLock(async () => {
    const runtime = await getHydratedPaperRuntime();
    if (runtime.venueControl?.haltMode !== "OPEN") return Response.json({ error: "venue does not accept order replacements while halted" }, { status: 423 });
    const result = replacePaperOrder(orderId, participantId, quantity, payload.price);
    const oldOrder = runtime.engine.getOrder(orderId);
    if (oldOrder) await savePaperOrder(user.userId, oldOrder);
    if (result.order) await savePaperOrder(user.userId, result.order);
    for (const execution of result.executions) {
      for (const relatedOrderId of [execution.buyOrderId, execution.sellOrderId]) {
        const order = runtime.engine.getOrder(relatedOrderId);
        const owner = await ownerForOrder(relatedOrderId);
        if (order && owner) await savePaperOrder(owner.userId, order);
      }
      await saveExecution(execution);
    }
    await addAudit(user.userId, result.accepted ? "ORDER_REPLACED" : "ORDER_REPLACE_REJECTED", orderId, { quantity, price: payload.price ?? null, reason: result.reason ?? null });
    return Response.json({ venue: "NEXTRADE", environment: "member_certification", ...result }, {
      status: result.accepted ? 200 : 422,
      headers: { "Cache-Control": "no-store" },
    });
  });
}
