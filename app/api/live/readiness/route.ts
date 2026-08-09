import { getChatGPTUser } from "../../../chatgpt-auth";
import { listBrokerConnections } from "../../../../db/trading";
import { getLiveRiskPolicy, getLiveRiskUsage } from "../../../../db/liveTrading";
import { getLiveServiceReadiness } from "../../../../engine/liveTradingService";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  const [connections, policy, usage] = await Promise.all([listBrokerConnections(user.userId), getLiveRiskPolicy(user.userId), getLiveRiskUsage(user.userId)]);
  const productionConnection = connections.find((item) => item.mode === "production" && item.status === "connected");
  const service = getLiveServiceReadiness();
  return Response.json({ ready: Boolean(service.globalLiveEnabled && productionConnection && policy.liveEnabled && !policy.killSwitch), service, productionConnection: productionConnection ?? null, policy, usage }, { headers: { "Cache-Control": "no-store" } });
}
