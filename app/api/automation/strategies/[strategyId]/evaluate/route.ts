import { getChatGPTUser } from "../../../../../chatgpt-auth";
import { commitAutomationEvaluation, ensurePaperUser, getAutomationStrategy, getIdempotencyRecord } from "../../../../../../db/trading";
import { checkOrderRateLimit, withTradingMutationLock } from "../../../../../../engine/apiRuntime";
import { evaluatePriceCross, hashAutomationStrategy, normalizePriceCrossDraft } from "../../../../../../engine/automationStrategy";

export const dynamic = "force-dynamic";

async function requestHash(value: unknown) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request, { params }: { params: Promise<{ strategyId: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  await ensurePaperUser(user);
  const rateLimit = checkOrderRateLimit(`automation:${user.userId}`, Date.now(), 20, 60_000);
  if (!rateLimit.allowed) return Response.json({ error: "점검 요청이 너무 많습니다. 잠시 후 다시 시도하세요.", retryAfterSeconds: rateLimit.retryAfterSeconds }, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds), "Cache-Control": "no-store" } });

  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!idempotencyKey || idempotencyKey.length > 64) return Response.json({ error: "Idempotency-Key header is required and must be at most 64 characters" }, { status: 400 });
  const { strategyId } = await params;

  let body: { observedPrice?: number };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "request body must be valid JSON" }, { status: 400 }); }
  if (!Number.isSafeInteger(body.observedPrice) || (body.observedPrice ?? 0) <= 0) return Response.json({ error: "검증 가격은 0보다 큰 정수여야 합니다." }, { status: 422 });
  const observedPrice = body.observedPrice as number;
  const durableKey = `AUTOMATION:${strategyId}:${idempotencyKey}`;

  return withTradingMutationLock(async () => {
    const strategy = await getAutomationStrategy(user.userId, strategyId);
    if (!strategy) return Response.json({ error: "strategy not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    if (strategy.status === "stopped") return Response.json({ error: "중지된 전략은 점검할 수 없습니다." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    const normalized = normalizePriceCrossDraft(strategy, strategy.id);
    if (!normalized.ok) return Response.json({ error: "현재 전략 설정이 유효하지 않습니다.", issues: normalized.issues }, { status: 409, headers: { "Cache-Control": "no-store" } });
    const strategyFingerprint = await hashAutomationStrategy(normalized.strategy);
    const hash = await requestHash({ strategyId, strategyFingerprint, observedPrice, priceSource: "USER_SCENARIO" });
    const replay = await getIdempotencyRecord(user.userId, durableKey);
    if (replay) {
      if (replay.requestHash !== hash) return Response.json({ error: "같은 실행 키가 다른 점검 입력에 이미 사용되었습니다." }, { status: 409, headers: { "Cache-Control": "no-store" } });
      return Response.json(JSON.parse(replay.responseJson), { status: Number(replay.statusCode), headers: { "Cache-Control": "no-store", "X-Idempotent-Replay": "true" } });
    }

    const evaluation = evaluatePriceCross(normalized.strategy, observedPrice);
    const detail = { ...evaluation, strategyFingerprint, strategyName: strategy.name, evaluatedBy: "MANUAL_ONE_TIME_CHECK", liveExecutionAvailable: false };
    const run = { id: `RUN-${crypto.randomUUID()}`, strategyId, status: evaluation.decision, observedPrice, orderId: null, detail, createdAt: new Date().toISOString(), triggered: evaluation.triggered };
    const responseBody = { evaluation, run: { ...run, detail }, message: evaluation.summary, safety: { simulated: true, orderSubmitted: false, recurringRunnerActive: false } };
    const committed = await commitAutomationEvaluation({ userId: user.userId, strategyId, idempotencyKey: durableKey, requestHash: hash, statusCode: 201, response: responseBody, run, auditPayload: { runId: run.id, strategyFingerprint, decision: evaluation.decision, observedPrice, priceSource: "USER_SCENARIO", orderSubmitted: false } });
    if (!committed.created && committed.replay) {
      if (committed.replay.requestHash !== hash) return Response.json({ error: "같은 실행 키가 다른 점검 입력에 이미 사용되었습니다." }, { status: 409, headers: { "Cache-Control": "no-store" } });
      return Response.json(JSON.parse(committed.replay.responseJson), { status: Number(committed.replay.statusCode), headers: { "Cache-Control": "no-store", "X-Idempotent-Replay": "true" } });
    }
    return Response.json(responseBody, { status: 201, headers: { "Cache-Control": "no-store", "X-RateLimit-Remaining": String(rateLimit.remaining) } });
  });
}
