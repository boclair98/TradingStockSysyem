import { getPaperRuntime } from "../../../../engine/apiRuntime";
import { getBrokerReadiness } from "../../../../engine/brokerGateway";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const participantId = new URL(request.url).searchParams.get("participantId")?.trim() || "api-paper";
  const broker = getBrokerReadiness();
  if (broker.provider !== "paper") {
    return Response.json({ error: "broker account adapter is not connected", broker }, { status: 503 });
  }
  return Response.json({
    mode: "paper",
    provider: broker.provider,
    account: {
      participantId,
      accountId: null,
      buyingPower: null,
      cashBalance: null,
      positions: [],
      risk: getPaperRuntime().engine.getParticipantRisk(participantId),
      source: "paper_limits_only",
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
