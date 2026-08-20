import { getHydratedPaperRuntime } from "../../../engine/apiRuntime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const rawSequence = new URL(request.url).searchParams.get("afterSequence") ?? "0";
  const afterSequence = Number(rawSequence);
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
    return Response.json({ error: "afterSequence must be a non-negative integer" }, { status: 400 });
  }
  const runtime = await getHydratedPaperRuntime();
  const events = runtime.engine.getEvents(afterSequence).filter((event) => event.type === "EXECUTION" || event.type === "MARKET_STATE_CHANGED" || event.type === "AUCTION_EXECUTED");
  return Response.json({
    venue: "NEXTRADE",
    environment: "member_certification",
    afterSequence,
    nextSequence: runtime.engine.sequenceNumber,
    events,
  }, { headers: { "Cache-Control": "no-store" } });
}
