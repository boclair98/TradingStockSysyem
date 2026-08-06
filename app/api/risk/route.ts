import { getPaperRuntime } from "../../../engine/apiRuntime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const participantId = new URL(request.url).searchParams.get("participantId")?.trim() || "api-paper";
  const runtime = getPaperRuntime();
  return Response.json({
    venue: "NEXTRADE",
    mode: "paper",
    risk: runtime.engine.getParticipantRisk(participantId),
    policy: "paper_pre_trade_limits",
  }, { headers: { "Cache-Control": "no-store" } });
}
