import { getChatGPTUser } from "../../chatgpt-auth";
import { ensurePaperUser, getPaperAccount } from "../../../db/trading";

export const dynamic = "force-dynamic";

const CODERS_SITE_URL = "https://tradingstocksysyem.coders.kr/";

function authPaths(request: Request) {
  const requestUrl = new URL(request.url);
  const isCoders = process.env.SITE_PROVIDER === "coders" || requestUrl.hostname.endsWith(".coders.kr");
  if (!isCoders) {
    return {
      signInPath: "/signin-with-chatgpt?return_to=%2F",
      signOutPath: "/signout-with-chatgpt?return_to=%2F",
    };
  }
  const returnTo = encodeURIComponent(process.env.SITE_URL || CODERS_SITE_URL);
  return {
    signInPath: `https://mcp.coders.kr/sso/login?return_to=${returnTo}`,
    signOutPath: `https://mcp.coders.kr/sso/logout?return_to=${returnTo}`,
  };
}

export async function GET(request: Request) {
  const paths = authPaths(request);
  const user = await getChatGPTUser();
  if (!user) {
    return Response.json({ authenticated: false, signInPath: paths.signInPath }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const { participantId, role } = await ensurePaperUser(user);
  const account = await getPaperAccount(user.userId);
  return Response.json({
    authenticated: true,
    user: { displayName: user.displayName, email: user.email, participantId, role },
    account,
    signOutPath: paths.signOutPath,
  }, { headers: { "Cache-Control": "no-store" } });
}
