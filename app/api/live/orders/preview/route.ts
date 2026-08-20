import { getChatGPTUser } from "../../../../chatgpt-auth";
import { previewLiveOrder } from "../../../../../engine/liveTradingService";
import type { LiveOrderRequestRecord } from "../../../../../db/liveTrading";
import { ensurePaperUser } from "../../../../../db/trading";
import { checkLiveRequestRateLimit } from "../../../../../engine/liveRateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  const limit = checkLiveRequestRateLimit(user.userId, "preview");
  if (!limit.allowed) return Response.json({ error: "주문 사전확인 요청이 너무 많습니다.", retryAfterSeconds: limit.retryAfterSeconds }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(limit.retryAfterSeconds) } });
  await ensurePaperUser(user);
  let body: LiveOrderRequestRecord;
  try { body = await request.json() as LiveOrderRequestRecord; } catch { return Response.json({ error: "request body must be valid JSON" }, { status: 400 }); }
  try { return Response.json({ preview: await previewLiveOrder(user.userId, body) }, { status: 201, headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "주문 사전확인 실패" }, { status: 422, headers: { "Cache-Control": "no-store" } }); }
}
