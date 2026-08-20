import { getChatGPTUser } from "../../../chatgpt-auth";
import { getLiveRiskPolicy, getLiveRiskUsage, saveLiveRiskPolicy } from "../../../../db/liveTrading";
import { addAudit, ensurePaperUser } from "../../../../db/trading";

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
  let body: Partial<{ liveEnabled: boolean; automationEnabled: boolean; killSwitch: boolean; maxOrderQuantity: number; maxOrderNotional: number; maxDailyNotional: number; maxOpenOrders: number; allowedSymbols: string[]; acknowledgement: string }>;
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "request body must be valid JSON" }, { status: 400 }); }
  const current = await getLiveRiskPolicy(user.userId);
  if (body.liveEnabled === true && !current.liveEnabled && body.acknowledgement?.trim() !== ACK) return Response.json({ error: `확인 문구 '${ACK}'을 정확히 입력하세요.` }, { status: 422 });
  const bounded = (value: number | undefined, fallback: number, min: number, max: number) => Number.isSafeInteger(value) ? Math.min(max, Math.max(min, value as number)) : fallback;
  const policy = await saveLiveRiskPolicy(user.userId, {
    liveEnabled: body.liveEnabled ?? current.liveEnabled,
    automationEnabled: body.automationEnabled ?? current.automationEnabled,
    killSwitch: body.killSwitch ?? current.killSwitch,
    maxOrderQuantity: bounded(body.maxOrderQuantity, current.maxOrderQuantity, 1, 100_000),
    maxOrderNotional: bounded(body.maxOrderNotional, current.maxOrderNotional, 10_000, 1_000_000_000),
    maxDailyNotional: bounded(body.maxDailyNotional, current.maxDailyNotional, 10_000, 10_000_000_000),
    maxOpenOrders: bounded(body.maxOpenOrders, current.maxOpenOrders, 1, 1_000),
    allowedSymbols: Array.isArray(body.allowedSymbols) ? [...new Set(body.allowedSymbols.filter((symbol) => /^\d{6,7}$/.test(symbol)))].slice(0, 500) : current.allowedSymbols,
    acknowledgedAt: body.liveEnabled === true && !current.liveEnabled ? new Date().toISOString() : current.acknowledgedAt,
  });
  await addAudit(user.userId, "LIVE_RISK_POLICY_UPDATED", null, { liveEnabled: policy.liveEnabled, automationEnabled: policy.automationEnabled, killSwitch: policy.killSwitch, maxOrderQuantity: policy.maxOrderQuantity, maxOrderNotional: policy.maxOrderNotional, maxDailyNotional: policy.maxDailyNotional, maxOpenOrders: policy.maxOpenOrders });
  return Response.json({ policy }, { headers: { "Cache-Control": "no-store" } });
}
