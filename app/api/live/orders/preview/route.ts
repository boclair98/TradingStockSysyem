import { getChatGPTUser } from "../../../../chatgpt-auth";
import { previewLiveOrder } from "../../../../../engine/liveTradingService";
import type { LiveOrderRequestRecord } from "../../../../../db/liveTrading";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  let body: LiveOrderRequestRecord;
  try { body = await request.json() as LiveOrderRequestRecord; } catch { return Response.json({ error: "request body must be valid JSON" }, { status: 400 }); }
  try { return Response.json({ preview: await previewLiveOrder(user.userId, body) }, { status: 201, headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "주문 사전확인 실패" }, { status: 422, headers: { "Cache-Control": "no-store" } }); }
}
