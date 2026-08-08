import { getBrokerReadiness } from "../../../../engine/brokerGateway";
import { getPaperRuntime } from "../../../../engine/apiRuntime";
import { instrumentFor } from "../../../../engine/instrumentMaster";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim() ?? "";
  if (instrumentFor(symbol).symbol !== symbol) return Response.json({ error: "unsupported symbol" }, { status: 400 });
  const broker = getBrokerReadiness();
  if (broker.provider !== "paper") {
    return Response.json({ error: "broker market-data adapter is not connected", broker }, { status: 503 });
  }
  const snapshot = getPaperRuntime().engine.snapshot(symbol);
  return Response.json({
    mode: "paper",
    provider: broker.provider,
    quote: {
      symbol,
      lastPrice: null,
      bestBid: snapshot.bidLevels[0]?.price ?? null,
      bestAsk: snapshot.askLevels[0]?.price ?? null,
      bidQuantity: snapshot.bidLevels[0]?.quantity ?? 0,
      askQuantity: snapshot.askLevels[0]?.quantity ?? 0,
      sequence: snapshot.sequence,
      receivedAt: new Date().toISOString(),
      delayed: false,
      source: "paper",
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
