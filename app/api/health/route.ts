export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ok: true,
    service: "TradingStockSysyem",
    venue: "NEXTRADE",
    environment: "member_certification",
    timestamp: new Date().toISOString(),
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
