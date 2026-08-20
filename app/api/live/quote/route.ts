import { getChatGPTUser } from "../../../chatgpt-auth";
import { getLiveQuote } from "../../../../engine/liveTradingService";
import { ensurePaperUser } from "../../../../db/trading";
import { checkLiveRequestRateLimit } from "../../../../engine/liveRateLimit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  const limit = checkLiveRequestRateLimit(user.userId, "quote");
  if (!limit.allowed) return Response.json({ error: "시세조회 요청이 너무 많습니다.", retryAfterSeconds: limit.retryAfterSeconds }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(limit.retryAfterSeconds) } });
  await ensurePaperUser(user);
  const search = new URL(request.url).searchParams;
  const connectionId = search.get("connectionId")?.trim() ?? "";
  const symbol = search.get("symbol")?.trim() ?? "";
  const venueValue = search.get("venue") ?? "SOR";
  const venue = venueValue === "KRX" || venueValue === "NXT" ? venueValue : "SOR";
  if (!connectionId || !/^\d{6,7}$/.test(symbol)) return Response.json({ error: "connectionId and valid symbol are required" }, { status: 400 });
  try { return Response.json({ quote: await getLiveQuote(user.userId, connectionId, symbol, venue) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "시세조회 실패" }, { status: 422 }); }
}
