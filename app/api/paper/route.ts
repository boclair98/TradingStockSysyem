import { getChatGPTUser } from "../../chatgpt-auth";
import { ensurePaperUser, getAutomationStrategy } from "../../../db/trading";
import { commitSimulationCommand, getSimulationAccount, listSimulationCommands, SimulationConflict } from "../../../db/paperSimulation";
import { normalizePriceCrossDraft } from "../../../engine/automationStrategy";
import { normalizeReplayTicks, type SimulationCommand } from "../../../engine/paperSimulation";
import { checkOrderRateLimit } from "../../../engine/apiRuntime";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "로그인 후 가상 계좌를 사용할 수 있습니다." }, { status: 401, headers });
  try {
    await ensurePaperUser(user);
    if (new URL(request.url).searchParams.get("format") === "csv") {
      const account = await getSimulationAccount(user.userId);
      const rows = [["order_id", "symbol", "side", "quantity", "filled", "remaining", "average_price", "fees", "status", "created_at"], ...account.state.orders.map((order) => [order.id, order.symbol, order.side, order.quantity, order.filled, order.remaining, order.averagePrice, order.fees, order.status, order.createdAt])];
      return new Response("\uFEFF" + rows.map((row) => row.join(",")).join("\r\n"), { headers: { ...headers, "Content-Type": "text/csv;charset=utf-8", "Content-Disposition": 'attachment; filename="paper-orders.csv"', "X-Content-Type-Options": "nosniff" } });
    }
    const [account, journal] = await Promise.all([getSimulationAccount(user.userId), listSimulationCommands(user.userId)]);
    return Response.json({ ...account, journal }, { headers });
  } catch { return Response.json({ error: "가상 원장을 불러오지 못했습니다. 잠시 후 새로고침하세요." }, { status: 503, headers }); }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401, headers });
  const commandId = request.headers.get("Idempotency-Key") ?? "";
  if (!/^[A-Za-z0-9-]{16,100}$/.test(commandId)) return Response.json({ error: "유효한 Idempotency-Key가 필요합니다." }, { status: 400, headers });
  const rate = checkOrderRateLimit(`paper:${user.userId}`, Date.now(), 30, 60_000);
  if (!rate.allowed) return Response.json({ error: "요청이 많습니다. 잠시 후 다시 실행하세요." }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } });
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 24_000) return Response.json({ error: "요청 크기가 너무 큽니다." }, { status: 413, headers });
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object required");
    body = parsed;
  } catch { return Response.json({ error: "요청 내용을 확인하세요." }, { status: 400, headers }); }
  if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) return Response.json({ error: "최신 원장 버전이 필요합니다. 새로고침하세요." }, { status: 409, headers });
  try {
    await ensurePaperUser(user);
    let command: SimulationCommand;
    let semantic: unknown;
    if (body.action === "start") {
      if (typeof body.strategyId !== "string") return Response.json({ error: "전략을 선택하세요." }, { status: 422, headers });
      const strategy = await getAutomationStrategy(user.userId, body.strategyId);
      if (!strategy) return Response.json({ error: "내 전략을 찾을 수 없습니다." }, { status: 404, headers });
      const normalized = normalizePriceCrossDraft(strategy, strategy.id);
      if (!normalized.ok) return Response.json({ error: normalized.issues[0].message }, { status: 422, headers });
      command = { action: "start", strategy: normalized.strategy };
      semantic = { action: "start", strategyId: body.strategyId };
    } else if (body.action === "stop") {
      command = { action: "stop" }; semantic = command;
    } else if (body.action === "cancel" && typeof body.orderId === "string" && /^SIM-\d+$/.test(body.orderId)) {
      command = { action: "cancel", orderId: body.orderId }; semantic = command;
    } else if (body.action === "replay") {
      command = { action: "replay", ticks: normalizeReplayTicks(body.ticks) }; semantic = command;
    } else return Response.json({ error: "지원하지 않는 가상 운용 명령입니다." }, { status: 422, headers });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(semantic)));
    const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
    return Response.json(await commitSimulationCommand(user.userId, commandId, hash, Number(body.expectedVersion), command), { headers });
  } catch (error) {
    if (error instanceof SimulationConflict) return Response.json({ error: error.message }, { status: 409, headers });
    // Pure command validation errors have no provider secrets; DB errors are not exposed.
    const message = error instanceof Error ? error.message : "";
    if (/가격 기록|가상 운용|가상 주문|호가단위|체결 가능|시각은|종목|먼저 가상|이전 기록|현재 운용/.test(message)) return Response.json({ error: message }, { status: 422, headers });
    return Response.json({ error: "가상 원장 저장에 실패했습니다. 새로고침해 반영 여부를 확인하세요." }, { status: 503, headers });
  }
}
