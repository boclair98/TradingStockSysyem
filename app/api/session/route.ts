import { getChatGPTUser } from "../../chatgpt-auth";
import { ensurePaperUser, getPaperAccount } from "../../../db/trading";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) {
    return Response.json({ authenticated: false, signInPath: "/signin-with-chatgpt?return_to=%2F" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const { participantId } = await ensurePaperUser(user);
  const account = await getPaperAccount(user.userId);
  return Response.json({
    authenticated: true,
    user: { displayName: user.displayName, email: user.email, participantId, role: "participant" },
    account,
    signOutPath: "/signout-with-chatgpt?return_to=%2F",
  }, { headers: { "Cache-Control": "no-store" } });
}
