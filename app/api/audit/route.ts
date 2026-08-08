import { getChatGPTUser } from "../../chatgpt-auth";
import { ensurePaperUser, listUserAudit } from "../../../db/trading";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  await ensurePaperUser(user);
  const rawLimit = Number(new URL(request.url).searchParams.get("limit") ?? "50");
  const limit = Number.isSafeInteger(rawLimit) ? rawLimit : 50;
  const entries = await listUserAudit(user.userId, limit);
  return Response.json({ venue: "NEXTRADE", mode: "paper", entries }, { headers: { "Cache-Control": "no-store" } });
}
