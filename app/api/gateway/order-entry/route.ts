import { consumeBrokerRateLimit, consumeGatewaySequence, ensureGatewayMember, ensureMemberGatewaySession, gatewayClientOrderExists, nextGatewayOutboundSequence, ownerForOrder, recordDropCopy, recordGatewayMessage, saveExecution, savePaperOrder } from "../../../../db/trading";
import { getHydratedPaperRuntime, submitPaperOrder, withTradingMutationLock } from "../../../../engine/apiRuntime";
import { instrumentFor } from "../../../../engine/instrumentMaster";
import { executionReport, validateMemberMessage, verifyGatewaySignature, type MemberOrderMessage } from "../../../../engine/memberGateway";

export const dynamic = "force-dynamic";

function gatewayKeys() {
  try { return JSON.parse(process.env.CERTIFICATION_GATEWAY_KEYS ?? "{}") as Record<string, string>; } catch { return {}; }
}

export async function POST(request: Request) {
  const receivedAt = new Date().toISOString();
  const started = performance.now();
  let message: Partial<MemberOrderMessage>;
  try { message = await request.json() as Partial<MemberOrderMessage>; } catch { return Response.json({ rejectCode: "MESSAGE_INVALID", message: "invalid JSON" }, { status: 400 }); }
  const memberId = message.memberId ?? "UNKNOWN";
  const sessionId = message.sessionId ?? "UNKNOWN";
  const secret = gatewayKeys()[memberId];
  if (!secret) return Response.json({ rejectCode: "AUTH_FAILED", message: "member is not enabled for certification" }, { status: 401 });
  const session = await ensureMemberGatewaySession(memberId, sessionId, request.headers.get("x-forwarded-for"));
  if (session.memberId !== memberId || session.status !== "ACTIVE") return Response.json({ rejectCode: "SESSION_INVALID", message: "gateway session is not active" }, { status: 409 });
  const validation = validateMemberMessage(message, session.expectedInboundSequence);
  if (!validation.ok) {
    await recordGatewayMessage({ memberId, sessionId, direction: "IN", messageType: String(message.messageType ?? "?"), sessionSequence: Number(message.sequence ?? 0), clientOrderId: message.clientOrderId, status: "REJECTED", rejectCode: validation.code, payload: message, receivedAt, latencyMicros: Math.round((performance.now() - started) * 1000) });
    return Response.json(validation, { status: validation.code === "SEQUENCE_GAP" ? 409 : 422 });
  }
  const signature = request.headers.get("x-member-signature")?.trim() ?? "";
  if (!signature || !(await verifyGatewaySignature(validation.normalized, signature, secret))) return Response.json({ rejectCode: "AUTH_FAILED", message: "invalid member message signature" }, { status: 401 });
  if (await gatewayClientOrderExists(memberId, validation.normalized.clientOrderId)) return Response.json({ rejectCode: "DUPLICATE_CLIENT_ORDER_ID", message: "client order id has already been accepted for this member" }, { status: 409 });
  if (!(await consumeGatewaySequence(sessionId, memberId, validation.normalized.sequence))) return Response.json({ rejectCode: "SEQUENCE_GAP", message: "sequence was consumed by another message" }, { status: 409 });
  const rate = await consumeBrokerRateLimit("ats_gateway", sessionId, "ORDER_ENTRY", 1000);
  if (!rate.allowed) return Response.json({ rejectCode: "RATE_LIMIT", retryAfterMs: rate.retryAfterMs }, { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } });
  const instrument = instrumentFor(validation.normalized.symbol);
  if (instrument.symbol !== validation.normalized.symbol) return Response.json({ rejectCode: "MESSAGE_INVALID", message: "instrument is not admitted to the venue" }, { status: 422 });
  const member = await ensureGatewayMember(memberId);

  return withTradingMutationLock(async () => {
    const runtime = await getHydratedPaperRuntime();
    if (runtime.venueControl?.haltMode !== "OPEN") return Response.json({ rejectCode: "VENUE_HALTED", venueControl: runtime.venueControl }, { status: 423 });
    const input = validation.normalized;
    const result = submitPaperOrder({ id: `NXT-${Date.now()}-${crypto.randomUUID().slice(0, 10)}`, participantId: member.participantId, symbol: input.symbol, side: input.side, type: input.orderType, timeInForce: input.timeInForce, price: input.orderType === "MARKET" || input.orderType === "MIDPOINT" ? null : input.price, stopPrice: input.orderType === "STOP_LIMIT" ? input.stopPrice ?? null : null, quantity: input.quantity });
    if (result.order) await savePaperOrder(member.userId, result.order);
    for (const fill of result.executions) {
      for (const orderId of [fill.buyOrderId, fill.sellOrderId]) {
        const order = runtime.engine.getOrder(orderId);
        const owner = await ownerForOrder(orderId);
        if (order && owner) await savePaperOrder(owner.userId, order);
      }
      await saveExecution(fill);
    }
    const outboundSequence = await nextGatewayOutboundSequence(sessionId, memberId);
    const report = executionReport({ memberId, sessionId, clientOrderId: input.clientOrderId, orderId: result.order?.id, status: result.accepted ? result.order?.status ?? "ACCEPTED" : "REJECTED", sequence: result.order?.sequence ?? runtime.engine.sequenceNumber, reason: result.reason, executions: result.executions });
    const latencyMicros = Math.round((performance.now() - started) * 1000);
    await recordGatewayMessage({ memberId, sessionId, direction: "IN", messageType: "D", sessionSequence: input.sequence, marketSequence: result.order?.sequence, clientOrderId: input.clientOrderId, venueOrderId: result.order?.id, status: result.accepted ? "ACCEPTED" : "REJECTED", rejectCode: result.accepted ? null : "MESSAGE_INVALID", payload: input, receivedAt, latencyMicros });
    await recordGatewayMessage({ memberId, sessionId, direction: "OUT", messageType: "8", sessionSequence: outboundSequence, marketSequence: result.order?.sequence, clientOrderId: input.clientOrderId, venueOrderId: result.order?.id, status: result.accepted ? "SENT" : "REJECTED", payload: report, latencyMicros });
    await recordDropCopy({ memberId, marketSequence: result.order?.sequence ?? runtime.engine.sequenceNumber, eventType: result.executions.length ? "EXECUTION" : result.accepted ? "ORDER_ACK" : "ORDER_REJECT", orderId: result.order?.id, executionId: result.executions.at(-1)?.id, payload: report });
    return Response.json(report, { status: result.accepted ? 201 : 422, headers: { "Cache-Control": "no-store", "X-Gateway-Latency-Micros": String(latencyMicros), "X-RateLimit-Remaining": String(rate.remaining) } });
  });
}
