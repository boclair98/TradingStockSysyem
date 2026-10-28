import { getChatGPTUser } from "../../../../chatgpt-auth";
import { commitAutomationStrategyStatus, ensurePaperUser, getAutomationRunStats, getAutomationStrategy } from "../../../../../db/trading";
import { buildStrategyProgressFromCounts, hashAutomationStrategy, normalizePriceCrossDraft } from "../../../../../engine/automationStrategy";
import { withTradingMutationLock } from "../../../../../engine/apiRuntime";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ strategyId: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  await ensurePaperUser(user);
  const { strategyId } = await params;

  let body: { status?: "draft" | "ready" | "paused"; expectedVersion?: number };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "request body must be valid JSON" }, { status: 400 }); }
  if (body.status !== "draft" && body.status !== "ready" && body.status !== "paused") return Response.json({ error: "status must be draft, ready or paused" }, { status: 400 });
  if (!Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion ?? 0) < 1) return Response.json({ error: "상태 변경에는 최신 정수 version이 필요합니다." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  const nextStatus = body.status;
  const expectedVersion = body.expectedVersion as number;

  return withTradingMutationLock(async () => {
    const strategy = await getAutomationStrategy(user.userId, strategyId);
    if (!strategy) return Response.json({ error: "strategy not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    const normalized = normalizePriceCrossDraft(strategy, strategy.id);
    if (!normalized.ok) return Response.json({ error: "현재 전략 설정이 유효하지 않습니다.", issues: normalized.issues }, { status: 409, headers: { "Cache-Control": "no-store" } });
    const strategyFingerprint = await hashAutomationStrategy(normalized.strategy);
    const stats = await getAutomationRunStats(user.userId, strategyId, strategyFingerprint);
    const progress = buildStrategyProgressFromCounts(stats.validationCount, stats.triggerCount, stats.waitingCount);
    if (nextStatus === "ready" && !progress.readyToMark) return Response.json({ error: "조건 충족과 조건 대기 시나리오를 각각 한 번 이상 점검해야 합니다.", progress }, { status: 422, headers: { "Cache-Control": "no-store" } });

    const committed = await commitAutomationStrategyStatus({ userId: user.userId, strategyId, status: nextStatus, expectedVersion, auditPayload: { status: nextStatus, strategyFingerprint } });
    if (!committed.strategy) {
      if (committed.reason === "contention") return Response.json({ error: "상태 변경 요청이 겹쳤습니다. 잠시 후 다시 시도하세요." }, { status: 503, headers: { "Retry-After": "1", "Cache-Control": "no-store" } });
      return Response.json({ error: "전략이 동시에 변경되었습니다. 최신 상태를 불러온 뒤 다시 시도하세요." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    const updated = committed.strategy;
    return Response.json({ strategy: { ...updated, strategyFingerprint, progress }, message: nextStatus === "ready" ? "검증 준비를 마쳤습니다. 상시 실행이나 실제 주문은 아직 시작되지 않습니다." : nextStatus === "paused" ? "전략을 일시정지했습니다." : "전략을 초안 상태로 되돌렸습니다." }, { headers: { "Cache-Control": "no-store" } });
  });
}
