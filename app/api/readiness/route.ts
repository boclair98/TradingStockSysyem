import { getNextradeReadiness } from "../../../engine/nextradeGateway";

export const dynamic = "force-dynamic";

export async function GET() {
  const nextrade = getNextradeReadiness();
  return Response.json({
    ok: nextrade.status === "paper_only" || nextrade.status === "adapter_pending",
    service: "TradingStockSysyem",
    venue: "NEXTRADE",
    paperTrading: true,
    nextrade,
  }, {
    status: nextrade.status === "blocked" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
