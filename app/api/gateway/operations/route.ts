import { getGatewayOperations, getPersistenceHealth } from "../../../../db/trading";
import { getHydratedPaperRuntime } from "../../../../engine/apiRuntime";
import { getChatGPTUser } from "../../../chatgpt-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  const [gateway, persistence, runtime] = await Promise.all([getGatewayOperations(), getPersistenceHealth(), getHydratedPaperRuntime()]);
  return Response.json({
    environment: "MEMBER_CERTIFICATION",
    gateway,
    components: [
      { id: "OE-A", name: "Order Entry A", status: "ACTIVE", protocol: "NATIVE_JSON_1 / HMAC-SHA256" },
      { id: "OE-B", name: "Order Entry B", status: "STANDBY", protocol: "NATIVE_JSON_1 / HMAC-SHA256" },
      { id: "ME-1", name: "Matching Core", status: runtime.venueControl?.haltMode === "OPEN" ? "ACTIVE" : "HALTED", protocol: "DETERMINISTIC SINGLE WRITER" },
      { id: "MD-A", name: "Market Data A", status: "ACTIVE", protocol: "SSE SNAPSHOT + INCREMENTAL" },
      { id: "DC-A", name: "Drop Copy", status: "ACTIVE", protocol: "EXECUTION REPORT" },
      { id: "WAL", name: "Order Journal", status: persistence.ok ? "ACTIVE" : "DEGRADED", protocol: persistence.provider.toUpperCase() },
    ],
    marketSequence: runtime.engine.sequenceNumber,
    recoveredOrders: runtime.orders.size,
    concurrency: process.env.DATABASE_URL ? "POSTGRES ADVISORY LEADER LOCK" : "SINGLE PROCESS MUTATION LOCK",
  }, { headers: { "Cache-Control": "no-store" } });
}
