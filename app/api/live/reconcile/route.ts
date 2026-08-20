import { getChatGPTUser } from "../../../chatgpt-auth";
import { reconcileLiveOrders } from "../../../../engine/liveTradingService";
import { withDistributedEngineLock } from "../../../../engine/distributedLock";
import { ensurePaperUser } from "../../../../db/trading";
import { checkLiveRequestRateLimit } from "../../../../engine/liveRateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  const limit = checkLiveRequestRateLimit(user.userId, "reconcile");
  if (!limit.allowed) return Response.json({ error: "체결대사 요청은 잠시 후 다시 시도하세요.", retryAfterSeconds: limit.retryAfterSeconds }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(limit.retryAfterSeconds) } });
  await ensurePaperUser(user);
  let body: { connectionId?: string };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "request body must be valid JSON" }, { status: 400 }); }
  if (!body.connectionId) return Response.json({ error: "connectionId is required" }, { status: 400 });
  try { return Response.json({ reconciliation: await withDistributedEngineLock(() => reconcileLiveOrders(user.userId, body.connectionId as string)) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "체결대사 실패" }, { status: 422 }); }
}
