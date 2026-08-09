import { getChatGPTUser } from "../../../chatgpt-auth";
import { reconcileLiveOrders } from "../../../../engine/liveTradingService";
import { withDistributedEngineLock } from "../../../../engine/distributedLock";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  let body: { connectionId?: string };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "request body must be valid JSON" }, { status: 400 }); }
  if (!body.connectionId) return Response.json({ error: "connectionId is required" }, { status: 400 });
  try { return Response.json({ reconciliation: await withDistributedEngineLock(() => reconcileLiveOrders(user.userId, body.connectionId as string)) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "체결대사 실패" }, { status: 422 }); }
}
