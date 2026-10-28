import { getChatGPTUser } from "../../../chatgpt-auth";
import { getLiveRiskPolicy, getLiveRiskUsage } from "../../../../db/liveTrading";
import { commitLiveRiskPolicyChange, ensurePaperUser } from "../../../../db/trading";
import { withDistributedEngineLock } from "../../../../engine/distributedLock";

export const dynamic = "force-dynamic";
const ACK = "실거래 위험을 이해했습니다";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  await ensurePaperUser(user);
  const [policy, usage] = await Promise.all([getLiveRiskPolicy(user.userId), getLiveRiskUsage(user.userId)]);
  return Response.json({ policy, usage, acknowledgementText: ACK }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  await ensurePaperUser(user);
  let raw: unknown;
  try { raw = await request.json(); } catch { return Response.json({ error: "request body must be valid JSON" }, { status: 400 }); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return Response.json({ error: "request body must be a JSON object" }, { status: 400 });
  const body = raw as Record<string, unknown>;
  const booleanFields = ["liveEnabled", "automationEnabled", "killSwitch"] as const;
  for (const field of booleanFields) {
    if (body[field] !== undefined && typeof body[field] !== "boolean") return Response.json({ error: `${field} must be a boolean` }, { status: 422 });
  }
  const ranges = {
    maxOrderQuantity: [1, 100_000],
    maxOrderNotional: [10_000, 1_000_000_000],
    maxDailyNotional: [10_000, 2_000_000_000],
    maxOpenOrders: [1, 1_000],
  } as const;
  for (const [field, [min, max]] of Object.entries(ranges)) {
    const value = body[field];
    if (value !== undefined && (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)) return Response.json({ error: `${field} must be an integer between ${min} and ${max}` }, { status: 422 });
  }
  if (body.acknowledgement !== undefined && typeof body.acknowledgement !== "string") return Response.json({ error: "acknowledgement must be a string" }, { status: 422 });
  if (typeof body.expectedVersion !== "number" || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1) return Response.json({ error: "expectedVersion must be a positive integer" }, { status: 409 });
  let allowedSymbols: string[] | undefined;
  if (body.allowedSymbols !== undefined) {
    if (!Array.isArray(body.allowedSymbols) || body.allowedSymbols.length > 500 || body.allowedSymbols.some((symbol) => typeof symbol !== "string" || !/^\d{6}$/.test(symbol))) return Response.json({ error: "allowedSymbols must contain at most 500 six-digit stock codes" }, { status: 422 });
    allowedSymbols = [...new Set(body.allowedSymbols as string[])];
  }
  return withDistributedEngineLock(async () => {
  const current = await getLiveRiskPolicy(user.userId);
  const nextLiveEnabled = (body.liveEnabled as boolean | undefined) ?? current.liveEnabled;
  const nextKillSwitch = nextLiveEnabled ? ((body.killSwitch as boolean | undefined) ?? current.killSwitch) : true;
  if (body.automationEnabled === true) return Response.json({ error: "상시 자동주문 실행기는 아직 활성화할 수 없습니다." }, { status: 422 });
  const opensLiveGate = nextLiveEnabled && (!current.liveEnabled || (current.killSwitch && !nextKillSwitch));
  if (opensLiveGate && String(body.acknowledgement ?? "").trim() !== ACK) return Response.json({ error: `확인 문구 '${ACK}'을 정확히 입력하세요.` }, { status: 422 });
  const nextPolicy = {
    liveEnabled: nextLiveEnabled,
    automationEnabled: false,
    killSwitch: nextKillSwitch,
    maxOrderQuantity: (body.maxOrderQuantity as number | undefined) ?? current.maxOrderQuantity,
    maxOrderNotional: (body.maxOrderNotional as number | undefined) ?? current.maxOrderNotional,
    maxDailyNotional: (body.maxDailyNotional as number | undefined) ?? current.maxDailyNotional,
    maxOpenOrders: (body.maxOpenOrders as number | undefined) ?? current.maxOpenOrders,
    allowedSymbols: allowedSymbols ?? current.allowedSymbols,
    acknowledgedAt: opensLiveGate ? new Date().toISOString() : current.acknowledgedAt,
  };
  const committed = await commitLiveRiskPolicyChange({ userId: user.userId, expectedVersion: Number(body.expectedVersion), policy: nextPolicy, auditPayload: { liveEnabled: nextPolicy.liveEnabled, automationEnabled: false, killSwitch: nextPolicy.killSwitch, maxOrderQuantity: nextPolicy.maxOrderQuantity, maxOrderNotional: nextPolicy.maxOrderNotional, maxDailyNotional: nextPolicy.maxDailyNotional, maxOpenOrders: nextPolicy.maxOpenOrders } });
  if (!committed.committed) return Response.json({ error: committed.reason === "conflict" ? "위험정책이 동시에 변경되었습니다. 최신 상태를 불러온 뒤 다시 시도하세요." : "위험정책 저장 요청이 겹쳤습니다. 잠시 후 다시 시도하세요." }, { status: committed.reason === "conflict" ? 409 : 503, headers: { "Cache-Control": "no-store", ...(committed.reason === "contention" ? { "Retry-After": "1" } : {}) } });
  const policy = await getLiveRiskPolicy(user.userId);
  return Response.json({ policy }, { headers: { "Cache-Control": "no-store" } });
  });
}
