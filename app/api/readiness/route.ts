import { getBrokerReadiness, redactBrokerConfig } from "../../../engine/brokerGateway";
import { getHydratedPaperRuntime } from "../../../engine/apiRuntime";
import { getPersistenceHealth } from "../../../db/trading";

export const dynamic = "force-dynamic";

export async function GET() {
  const broker = getBrokerReadiness();
  const [persistence, runtime] = await Promise.all([getPersistenceHealth(), getHydratedPaperRuntime()]);
  const ready = persistence.ok && broker.status !== "blocked";
  return Response.json({
    ok: ready,
    service: "TradingStockSysyem",
    targetVenue: "NEXTRADE",
    integrationModel: "securities_broker_api",
    paperTrading: broker.mode === "paper",
    broker,
    persistence,
    engine: {
      status: "ready",
      sequence: runtime.engine.sequenceNumber,
      market: runtime.engine.getMarketState(),
      recoveredOrders: runtime.orders.size,
    },
    safeguards: {
      mutationSerialization: true,
      durableOrderJournal: true,
      authenticatedOwnership: true,
      selfTradePolicy: "CANCEL_TAKER",
    },
    configuredConnection: redactBrokerConfig(),
  }, {
    status: ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
