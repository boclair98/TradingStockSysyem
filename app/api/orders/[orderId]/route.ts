import { cancelPaperOrder, checkOrderRateLimit, getHydratedPaperRuntime, paperEngineWritesAvailable, replacePaperOrder, withPaperEngineMutationLock } from "../../../../engine/apiRuntime";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { addAudit, ensurePaperUser, ownerForOrder, preTradeReplaceRiskCheck, saveExecution, savePaperOrder } from "../../../../db/trading";

export async function DELETE(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  if (!paperEngineWritesAvailable()) return Response.json({ error: "paper matching writes require the serialized PostgreSQL runtime" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const rateLimit = checkOrderRateLimit(user.userId);
  if (!rateLimit.allowed) return Response.json({ error: "order rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } });
  const { participantId } = await ensurePaperUser(user);
  const { orderId } = await params;
  return withPaperEngineMutationLock(async () => {
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
  if (!paperEngineWritesAvailable()) return Response.json({ error: "paper matching writes require the serialized PostgreSQL runtime" }, { status: 503, headers: { "Cache-Control": "no-store" } });
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
  return withPaperEngineMutationLock(async () => {
    const runtime = await getHydratedPaperRuntime();
    if (runtime.venueControl?.haltMode !== "OPEN") return Response.json({ error: "venue does not accept order replacements while halted" }, { status: 423 });
    const current = runtime.engine.getOrder(orderId);
    const owner = await ownerForOrder(orderId);
    if (!current || !owner || owner.userId !== user.userId || current.participantId !== participantId) {
      return Response.json({ error: "order not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    const preview = runtime.engine.previewReplace(orderId, quantity, payload.price, participantId);
    if (!preview.replaceable) {
      await addAudit(user.userId, "ORDER_REPLACE_REJECTED", orderId, { desiredQuantity: quantity, reason: preview.reason ?? null });
      return Response.json({ error: preview.reason ?? "order is not replaceable" }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }
    const riskError = await preTradeReplaceRiskCheck(user.userId, current, quantity, preview.referencePrice);
    if (riskError) {
      await addAudit(user.userId, "ORDER_REPLACE_REJECTED", orderId, { desiredQuantity: quantity, replacementQuantity: preview.replacementQuantity, referencePrice: preview.referencePrice, reason: riskError });
      return Response.json({ error: riskError }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }
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
    await addAudit(user.userId, result.accepted ? "ORDER_REPLACED" : "ORDER_REPLACE_REJECTED", orderId, { desiredQuantity: quantity, replacementQuantity: preview.replacementQuantity, price: payload.price ?? null, referencePrice: preview.referencePrice, reason: result.reason ?? null });
    return Response.json({ venue: "NEXTRADE", environment: "member_certification", ...result }, {
      status: result.accepted ? 200 : 422,
      headers: { "Cache-Control": "no-store" },
    });
  });
}
