import { getChatGPTUser } from "../../chatgpt-auth";
import { ensurePaperUser, listBrokerConnections } from "../../../db/trading";
import { connectKoreaInvestment, disconnectLiveBroker } from "../../../engine/liveTradingService";
import type { KisCredentials, KisMode } from "../../../engine/koreaInvestmentClient";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  return Response.json({ error: error instanceof Error ? error.message : "증권계좌 연결에 실패했습니다." }, { status: 422, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  await ensurePaperUser(user);
  return Response.json({ connections: await listBrokerConnections(user.userId) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  await ensurePaperUser(user);
  let body: { mode?: KisMode; accountLabel?: string; appKey?: string; appSecret?: string; accountNumber?: string; productCode?: string; htsId?: string };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "request body must be valid JSON" }, { status: 400 }); }
  if (body.mode !== "sandbox" && body.mode !== "production") return Response.json({ error: "mode must be sandbox or production" }, { status: 400 });
  const credentials: KisCredentials = { appKey: body.appKey?.trim() ?? "", appSecret: body.appSecret?.trim() ?? "", accountNumber: body.accountNumber?.replaceAll("-", "").trim() ?? "", productCode: body.productCode?.trim() ?? "", htsId: body.htsId?.trim() ?? "" };
  try {
    const result = await connectKoreaInvestment(user.userId, { mode: body.mode, accountLabel: body.accountLabel ?? "한국투자증권", credentials });
    return Response.json({ connected: true, ...result }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  const connectionId = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!connectionId) return Response.json({ error: "connection id is required" }, { status: 400 });
  return Response.json({ disconnected: await disconnectLiveBroker(user.userId, connectionId) }, { headers: { "Cache-Control": "no-store" } });
}
