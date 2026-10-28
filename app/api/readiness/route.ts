import { getHydratedPaperRuntime, paperEngineWritesAvailable } from "../../../engine/apiRuntime";
import { getGatewayOperations, getPersistenceHealth } from "../../../db/trading";
import { getLiveServiceReadiness } from "../../../engine/liveTradingService";

export const dynamic = "force-dynamic";

export async function GET() {
  const [persistence, runtime, gateway] = await Promise.all([getPersistenceHealth(), getHydratedPaperRuntime(), getGatewayOperations()]);
  const liveService = getLiveServiceReadiness();
  const ready = persistence.ok;
  return Response.json({
    ok: ready,
    service: "TradingStockSysyem",
    targetVenue: "NEXTRADE",
    integrationModel: "institutional_member_gateway",
    environment: liveService.environment,
    liveMarket: liveService.liveMarket,
    gateway,
    persistence,
    paperSimulation: {
      enabled: persistence.ok,
      schemaVersion: 1,
      priceSource: "USER_REPLAY",
      continuousMarketFeed: false,
      realOrdersSubmitted: false,
      concurrency: "per-user database version CAS and atomic command journal",
    },
    paperMatchingWrites: {
      enabled: paperEngineWritesAvailable(),
      mode: paperEngineWritesAvailable() ? "postgresql-rehydrate-under-advisory-lock" : "read-only",
      reason: paperEngineWritesAvailable() ? null : "shared LAB requires PostgreSQL and an approved single-writer runtime; isolated paper simulation remains available",
    },
    engine: {
      status: runtime.venueControl?.haltMode === "OPEN" ? "ready" : "halted",
      sequence: runtime.engine.sequenceNumber,
      market: runtime.engine.getMarketState(),
      recoveredOrders: runtime.orders.size,
      venueControl: runtime.venueControl,
    },
    safeguards: {
      mutationSerialization: true,
      distributedLeaderLock: Boolean(process.env.DATABASE_URL),
      durableOrderJournal: true,
      authenticatedOwnership: true,
      selfTradePolicy: "CANCEL_TAKER",
      idempotencyRequired: true,
      orderRateLimit: "1,000 messages / second / member session",
      realtimeStream: "SSE",
      chainedAudit: true,
      memberAuthentication: "HMAC-SHA256 certification gateway",
      contiguousSessionSequence: true,
      dropCopy: true,
    },
  }, {
    status: ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
