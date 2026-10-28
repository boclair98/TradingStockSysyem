import { getChatGPTUser } from "../../../chatgpt-auth";
import { ensurePaperUser, listAutomationRuns } from "../../../../db/trading";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  await ensurePaperUser(user);
  const search = new URL(request.url).searchParams;
  const strategyId = search.get("strategyId")?.trim() || null;
  const requestedLimit = Number(search.get("limit") ?? 100);
  const limit = Number.isSafeInteger(requestedLimit) ? Math.max(1, Math.min(250, requestedLimit)) : 100;
  return Response.json({ runs: await listAutomationRuns(user.userId, strategyId, limit) }, { headers: { "Cache-Control": "no-store" } });
}
