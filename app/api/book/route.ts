import { getHydratedPaperRuntime } from "../../../engine/apiRuntime";
import { instrumentFor } from "../../../engine/instrumentMaster";

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim() ?? "";
  const instrument = instrumentFor(symbol);
  if (instrument.symbol !== symbol) {
    return Response.json({ error: "symbol is required or unsupported" }, { status: 400 });
  }

  const runtime = await getHydratedPaperRuntime();
  return Response.json({
    venue: "NEXTRADE",
    mode: "paper",
    instrument,
    market: runtime.engine.getMarketState(),
    book: runtime.engine.snapshot(symbol),
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
