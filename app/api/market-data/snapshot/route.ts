import { getHydratedPaperRuntime } from "../../../../engine/apiRuntime";
import { instrumentFor } from "../../../../engine/instrumentMaster";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim() ?? "";
  if (instrumentFor(symbol).symbol !== symbol) return Response.json({ error: "instrument is not admitted" }, { status: 404 });
  const runtime = await getHydratedPaperRuntime();
  const book = runtime.engine.snapshot(symbol);
  return Response.json({ messageType: "W", venue: "NEXTRADE", channel: "MD-A", symbol, marketSequence: book.sequence, phase: runtime.engine.getMarketState().phase, bids: book.bidLevels, asks: book.askLevels, generatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store", "X-Market-Sequence": String(book.sequence) } });
}
