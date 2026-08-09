import { getChatGPTUser } from "../../../chatgpt-auth";
import { listLiveOrders, submitPreviewedLiveOrder } from "../../../../engine/liveTradingService";
import { withDistributedEngineLock } from "../../../../engine/distributedLock";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  return Response.json({ orders: await listLiveOrders(user.userId) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  let body: { previewId?: string; confirmationText?: string };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "request body must be valid JSON" }, { status: 400 }); }
  if (!body.previewId) return Response.json({ error: "previewId is required" }, { status: 400 });
  try {
    const order = await withDistributedEngineLock(() => submitPreviewedLiveOrder(user.userId, body.previewId as string, body.confirmationText ?? ""));
    return Response.json({ submitted: true, order }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "실전 주문 실패" }, { status: 422, headers: { "Cache-Control": "no-store" } }); }
}
