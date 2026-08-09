import { getHydratedPaperRuntime } from "../../../engine/apiRuntime";
import { getChatGPTUser } from "../../chatgpt-auth";
import { ensurePaperUser, getPaperAccount } from "../../../db/trading";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  const { participantId } = await ensurePaperUser(user);
  const runtime = await getHydratedPaperRuntime();
  const account = await getPaperAccount(user.userId);
  const risk = runtime.engine.getParticipantRisk(participantId);
  const reservedCash = account.cashBalance - account.availableCash;
  return Response.json({
    venue: "NEXTRADE",
    environment: "member_certification",
    risk,
    exposure: {
      cashBalance: account.cashBalance,
      availableCash: account.availableCash,
      reservedCash,
      reservedCashPercent: account.cashBalance > 0 ? Math.round((reservedCash / account.cashBalance) * 10_000) / 100 : 0,
      openOrderUtilizationPercent: Math.round((risk.openOrders / risk.limits.maxOpenOrders) * 10_000) / 100,
    },
    controls: ["authenticated ownership", "cash and inventory", "participant limits", "self-trade prevention", "serialized mutations"],
    policy: "member_pre_trade_risk_v1",
  }, { headers: { "Cache-Control": "no-store" } });
}
