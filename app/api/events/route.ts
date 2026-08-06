import { getPaperRuntime } from "../../../engine/apiRuntime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const rawSequence = new URL(request.url).searchParams.get("afterSequence") ?? "0";
  const afterSequence = Number(rawSequence);
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
    return Response.json({ error: "afterSequence must be a non-negative integer" }, { status: 400 });
  }
  const runtime = getPaperRuntime();
  return Response.json({
    venue: "NEXTRADE",
    mode: "paper",
    afterSequence,
    nextSequence: runtime.engine.sequenceNumber,
    events: runtime.engine.getEvents(afterSequence),
  }, { headers: { "Cache-Control": "no-store" } });
}
