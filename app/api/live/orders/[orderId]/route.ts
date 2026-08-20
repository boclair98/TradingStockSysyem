import { getChatGPTUser } from "../../../../chatgpt-auth";
import { cancelLiveOrder } from "../../../../../engine/liveTradingService";
import { ensurePaperUser } from "../../../../../db/trading";
import { checkLiveRequestRateLimit } from "../../../../../engine/liveRateLimit";
import { withDistributedEngineLock } from "../../../../../engine/distributedLock";

export async function DELETE(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  const limit = checkLiveRequestRateLimit(user.userId, "cancel");
  if (!limit.allowed) return Response.json({ error: "취소 요청이 너무 많습니다.", retryAfterSeconds: limit.retryAfterSeconds }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(limit.retryAfterSeconds) } });
  await ensurePaperUser(user);
  const { orderId } = await params;
  try { return Response.json({ cancelled: true, order: await withDistributedEngineLock(() => cancelLiveOrder(user.userId, orderId)) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "실전 주문 취소 실패" }, { status: 422 }); }
}
