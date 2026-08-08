import { getBrokerReadiness, redactBrokerConfig } from "../../../engine/brokerGateway";

export const dynamic = "force-dynamic";

export async function GET() {
  const broker = getBrokerReadiness();
  return Response.json({
    ok: broker.status === "paper_only" || broker.status === "adapter_pending",
    service: "TradingStockSysyem",
    targetVenue: "NEXTRADE",
    integrationModel: "securities_broker_api",
    paperTrading: broker.mode === "paper",
    broker,
    configuredConnection: redactBrokerConfig(),
  }, {
    status: broker.status === "blocked" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
