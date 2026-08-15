import { getChatGPTUser } from "../../chatgpt-auth";
import { ensurePaperUser, listBrokerConnections } from "../../../db/trading";
import { connectKiwoom, connectKoreaInvestment, connectTossInvestment, disconnectLiveBroker } from "../../../engine/liveTradingService";
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
  let body: { provider?: "toss_investment" | "korea_investment" | "kiwoom"; mode?: KisMode; accountLabel?: string; clientId?: string; clientSecret?: string; accountSeq?: number; appKey?: string; appSecret?: string; accountNumber?: string; productCode?: string; htsId?: string };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "request body must be valid JSON" }, { status: 400 }); }
  try {
    if (body.provider === "toss_investment") {
      const result = await connectTossInvestment(user.userId, { accountLabel: body.accountLabel ?? "토스증권", clientId: body.clientId ?? "", clientSecret: body.clientSecret ?? "", accountSeq: body.accountSeq });
      return Response.json({ connected: true, ...result }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    if (body.mode !== "sandbox" && body.mode !== "production") return Response.json({ error: "mode must be sandbox or production" }, { status: 400 });
    if (body.provider === "kiwoom") {
      const result = await connectKiwoom(user.userId, { mode: body.mode, accountLabel: body.accountLabel ?? "키움증권", appKey: body.appKey ?? "", secretKey: body.appSecret ?? "" });
      return Response.json({ connected: true, ...result }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    if (body.provider !== "korea_investment") return Response.json({ error: "지원하지 않는 증권사입니다." }, { status: 400 });
    const credentials: KisCredentials = { appKey: body.appKey?.trim() ?? "", appSecret: body.appSecret?.trim() ?? "", accountNumber: body.accountNumber?.replaceAll("-", "").trim() ?? "", productCode: body.productCode?.trim() ?? "", htsId: body.htsId?.trim() ?? "" };
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
