import { getChatGPTUser } from "../../../chatgpt-auth";
import { listLiveOrders, submitPreviewedLiveOrder } from "../../../../engine/liveTradingService";
import { withDistributedEngineLock } from "../../../../engine/distributedLock";
import { ensurePaperUser } from "../../../../db/trading";
import { checkLiveRequestRateLimit } from "../../../../engine/liveRateLimit";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  await ensurePaperUser(user);
  return Response.json({ orders: await listLiveOrders(user.userId) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  const limit = checkLiveRequestRateLimit(user.userId, "submit");
  if (!limit.allowed) return Response.json({ error: "주문 전송 요청이 너무 많습니다.", retryAfterSeconds: limit.retryAfterSeconds }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(limit.retryAfterSeconds) } });
  await ensurePaperUser(user);
  let body: { previewId?: string; confirmationText?: string };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "request body must be valid JSON" }, { status: 400 }); }
  if (!body.previewId) return Response.json({ error: "previewId is required" }, { status: 400 });
  try {
    const order = await withDistributedEngineLock(() => submitPreviewedLiveOrder(user.userId, body.previewId as string, body.confirmationText ?? ""));
    return Response.json({ submitted: true, order }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "실전 주문 실패" }, { status: 422, headers: { "Cache-Control": "no-store" } }); }
}
