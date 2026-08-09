import { getChatGPTUser } from "../../../../chatgpt-auth";
import { cancelLiveOrder } from "../../../../../engine/liveTradingService";
import { withDistributedEngineLock } from "../../../../../engine/distributedLock";

export async function DELETE(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  const { orderId } = await params;
  try { return Response.json({ cancelled: true, order: await withDistributedEngineLock(() => cancelLiveOrder(user.userId, orderId)) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "실전 주문 취소 실패" }, { status: 422 }); }
}
