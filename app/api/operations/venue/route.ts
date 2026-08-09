import { getChatGPTUser } from "../../../chatgpt-auth";
import { addAudit, ensurePaperUser, getVenueControl, updateVenueControl, type VenueHaltMode } from "../../../../db/trading";
import { applyVenueControl, withTradingMutationLock } from "../../../../engine/apiRuntime";
import type { MarketPhase } from "../../../../engine/koreanMarketRules";

export const dynamic = "force-dynamic";

const PHASES: MarketPhase[] = ["CLOSED", "PRE_MARKET", "OPENING_AUCTION", "CONTINUOUS", "CLOSING_AUCTION", "AFTER_MARKET"];
const HALT_MODES: VenueHaltMode[] = ["OPEN", "CANCEL_ONLY", "FULL_STOP"];

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  const { role } = await ensurePaperUser(user);
  const control = await getVenueControl();
  return Response.json({ control, permissions: { operator: role === "operator", canChangeVenueState: role === "operator" } }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign in required" }, { status: 401 });
  const { role } = await ensurePaperUser(user);
  if (role !== "operator") return Response.json({ error: "operator role required" }, { status: 403 });
  let payload: { phase?: MarketPhase; haltMode?: VenueHaltMode; reason?: string | null; expectedVersion?: number };
  try { payload = await request.json(); } catch { return Response.json({ error: "request body must be valid JSON" }, { status: 400 }); }
  if (!payload.phase || !PHASES.includes(payload.phase)) return Response.json({ error: "invalid market phase" }, { status: 400 });
  if (!payload.haltMode || !HALT_MODES.includes(payload.haltMode)) return Response.json({ error: "invalid halt mode" }, { status: 400 });
  if (!Number.isSafeInteger(payload.expectedVersion) || (payload.expectedVersion ?? 0) < 1) return Response.json({ error: "expectedVersion is required" }, { status: 400 });
  const reason = payload.reason?.trim().slice(0, 240) || null;
  return withTradingMutationLock(async () => {
    const updated = await updateVenueControl({ phase: payload.phase as MarketPhase, haltMode: payload.haltMode as VenueHaltMode, reason, expectedVersion: payload.expectedVersion as number, updatedBy: user.userId });
    if (!updated) return Response.json({ error: "venue state changed; reload and retry", control: await getVenueControl() }, { status: 409 });
    applyVenueControl(updated);
    await addAudit(user.userId, "VENUE_CONTROL_CHANGED", "NEXTRADE", { phase: updated.phase, haltMode: updated.haltMode, reason, version: updated.version });
    return Response.json({ control: updated }, { headers: { "Cache-Control": "no-store" } });
  });
}
