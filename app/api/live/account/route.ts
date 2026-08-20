import { getChatGPTUser } from "../../../chatgpt-auth";
import { getLiveAccount } from "../../../../engine/liveTradingService";
import { ensurePaperUser } from "../../../../db/trading";
import { checkLiveRequestRateLimit } from "../../../../engine/liveRateLimit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  const limit = checkLiveRequestRateLimit(user.userId, "account");
  if (!limit.allowed) return Response.json({ error: "계좌조회 요청이 너무 많습니다.", retryAfterSeconds: limit.retryAfterSeconds }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(limit.retryAfterSeconds) } });
  await ensurePaperUser(user);
  const connectionId = new URL(request.url).searchParams.get("connectionId")?.trim() ?? "";
  if (!connectionId) return Response.json({ error: "connectionId is required" }, { status: 400 });
  try { return Response.json({ account: await getLiveAccount(user.userId, connectionId) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "계좌조회 실패" }, { status: 422 }); }
}
