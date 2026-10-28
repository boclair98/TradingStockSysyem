import { getChatGPTUser } from "../../../chatgpt-auth";
import { commitAutomationStrategyChange, countAutomationRuns, ensurePaperUser, getAutomationRunStats, listAutomationRuns, listAutomationRunStats, listAutomationStrategies } from "../../../../db/trading";
import { buildStrategyProgressFromCounts, hashAutomationStrategy, normalizePriceCrossDraft } from "../../../../engine/automationStrategy";
import { checkOrderRateLimit, withTradingMutationLock } from "../../../../engine/apiRuntime";

export const dynamic = "force-dynamic";

async function enrichStrategies(userId: string) {
  const [strategies, runs, evaluationCount, progressRows] = await Promise.all([listAutomationStrategies(userId), listAutomationRuns(userId, null, 250), countAutomationRuns(userId), listAutomationRunStats(userId)]);
  const progressByVersion = new Map(progressRows.map((row) => [`${row.strategyId}:${row.strategyFingerprint}`, row]));
  const enriched = await Promise.all(strategies.map(async (strategy) => {
    const normalized = normalizePriceCrossDraft(strategy, strategy.id);
    if (!normalized.ok) return { ...strategy, strategyFingerprint: null, estimatedNotional: null, issues: normalized.issues, progress: { validationCount: 0, triggerScenarioPassed: false, waitingScenarioPassed: false, readyToMark: false, liveExecutionAvailable: false, completedSteps: 0, totalSteps: 2 } };
    const strategyFingerprint = await hashAutomationStrategy(normalized.strategy);
    const stats = progressByVersion.get(`${strategy.id}:${strategyFingerprint}`) ?? await getAutomationRunStats(userId, strategy.id, strategyFingerprint);
    return { ...strategy, strategyFingerprint, estimatedNotional: normalized.estimatedNotional, issues: [], progress: buildStrategyProgressFromCounts(stats.validationCount, stats.triggerCount, stats.waitingCount) };
  }));
  const passedScenarios = enriched.reduce((sum, strategy) => sum + strategy.progress.completedSteps, 0);
  const possibleScenarios = Math.max(1, enriched.length * 2);
  return {
    strategies: enriched,
    runs,
    dashboard: {
      strategyCount: enriched.length,
      readyCount: enriched.filter((strategy) => strategy.status === "ready").length,
      evaluationCount,
      scenarioCoveragePercent: enriched.length ? Math.round((passedScenarios / possibleScenarios) * 100) : 0,
    },
  };
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  await ensurePaperUser(user);
  return Response.json(await enrichStrategies(user.userId), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  await ensurePaperUser(user);
  const rateLimit = checkOrderRateLimit(`automation-save:${user.userId}`, Date.now(), 10, 60_000);
  if (!rateLimit.allowed) return Response.json({ error: "전략 저장 요청이 너무 많습니다. 잠시 후 다시 시도하세요.", retryAfterSeconds: rateLimit.retryAfterSeconds }, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds), "Cache-Control": "no-store" } });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "request body must be valid JSON" }, { status: 400 }); }

  const suppliedId = typeof body.id === "string" ? body.id.trim() : "";
  if (suppliedId && !/^AUTO-[A-Za-z0-9-]{10,80}$/.test(suppliedId)) return Response.json({ error: "invalid strategy id" }, { status: 400 });
  const expectedVersion = Number(body.expectedVersion);
  if (suppliedId && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) return Response.json({ error: "전략 수정에는 최신 정수 version이 필요합니다." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  const strategyId = suppliedId || `AUTO-${crypto.randomUUID()}`;
  const normalized = normalizePriceCrossDraft(body, strategyId);
  if (!normalized.ok) return Response.json({ error: "전략 설정을 다시 확인하세요.", issues: normalized.issues }, { status: 422, headers: { "Cache-Control": "no-store" } });

  return withTradingMutationLock(async () => {
    const strategyFingerprint = await hashAutomationStrategy(normalized.strategy);
    const committed = await commitAutomationStrategyChange({
      userId: user.userId,
      strategy: {
        id: normalized.strategy.id,
        connectionId: normalized.strategy.connectionId,
        name: normalized.strategy.name,
        symbol: normalized.strategy.symbol,
        side: normalized.strategy.side,
        strategyType: normalized.strategy.strategyType,
        triggerOperator: normalized.strategy.triggerOperator,
        triggerPrice: normalized.strategy.triggerPrice,
        orderType: normalized.strategy.orderType,
        limitPrice: normalized.strategy.limitPrice,
        quantity: normalized.strategy.quantity,
        intervalSeconds: normalized.strategy.intervalSeconds,
        maxOrdersPerDay: normalized.strategy.maxOrdersPerDay,
        maxDailyNotional: normalized.strategy.maxDailyNotional,
      },
      expectedVersion: suppliedId ? expectedVersion : null,
      auditPayload: { strategyFingerprint, strategyType: "PRICE_CROSS", executionMode: "paper", symbol: normalized.strategy.symbol },
    });
    if (!committed.strategy) {
      if (committed.reason === "quota") return Response.json({ error: "사용자당 전략은 최대 50개까지 저장할 수 있습니다." }, { status: 422, headers: { "Cache-Control": "no-store" } });
      if (committed.reason === "contention") return Response.json({ error: "저장 요청이 겹쳤습니다. 잠시 후 다시 시도하세요." }, { status: 503, headers: { "Retry-After": "1", "Cache-Control": "no-store" } });
      return Response.json({ error: suppliedId ? "전략이 동시에 변경되었습니다. 최신 상태를 불러온 뒤 다시 시도하세요." : "전략을 저장하지 못했습니다." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    const strategy = committed.strategy;
    return Response.json({ strategy: { ...strategy, strategyFingerprint, estimatedNotional: normalized.estimatedNotional }, message: "초안을 저장했습니다. 아직 자동 실행되지 않습니다." }, { status: suppliedId ? 200 : 201, headers: { "Cache-Control": "no-store", "X-RateLimit-Remaining": String(rateLimit.remaining) } });
  });
}
