import { getChatGPTUser } from "../../../chatgpt-auth";
import { getLiveAccount } from "../../../../engine/liveTradingService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  const connectionId = new URL(request.url).searchParams.get("connectionId")?.trim() ?? "";
  if (!connectionId) return Response.json({ error: "connectionId is required" }, { status: 400 });
  try { return Response.json({ account: await getLiveAccount(user.userId, connectionId) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "계좌조회 실패" }, { status: 422 }); }
}
