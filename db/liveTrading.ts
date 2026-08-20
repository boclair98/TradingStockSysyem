import { getTradingDb } from "./trading";

export type BrokerConnectionSecretRecord = {
  id: string;
  userId: string;
  provider: string;
  mode: "sandbox" | "production";
  accountLabel: string;
  accountRef: string;
  credentialCiphertext: string;
  status: "pending" | "connected" | "error" | "disabled";
  lastCheckedAt: string | null;
  lastError: string | null;
};

export async function getBrokerConnectionSecret(userId: string, connectionId: string) {
  const db = await getTradingDb();
  return (await db.query<BrokerConnectionSecretRecord>(`SELECT id, user_id AS "userId", provider, mode, account_label AS "accountLabel", account_ref AS "accountRef", credential_ciphertext AS "credentialCiphertext", status, last_checked_at AS "lastCheckedAt", last_error AS "lastError" FROM broker_connections WHERE id=? AND user_id=?`, [connectionId, userId])).rows[0] ?? null;
}

export async function updateBrokerConnectionState(userId: string, connectionId: string, status: BrokerConnectionSecretRecord["status"], lastError: string | null) {
  const db = await getTradingDb();
  const now = new Date().toISOString();
  await db.query(`UPDATE broker_connections SET status=?, last_checked_at=?, last_error=?, updated_at=? WHERE id=? AND user_id=?`, [status, now, lastError, now, connectionId, userId]);
}

export async function saveBrokerToken(connectionId: string, tokenCiphertext: string, expiresAt: string) {
  const db = await getTradingDb();
  await db.query(`INSERT INTO broker_tokens (connection_id, token_ciphertext, expires_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(connection_id) DO UPDATE SET token_ciphertext=excluded.token_ciphertext, expires_at=excluded.expires_at, updated_at=excluded.updated_at`, [connectionId, tokenCiphertext, expiresAt, new Date().toISOString()]);
}

export async function getBrokerToken(connectionId: string) {
  const db = await getTradingDb();
  return (await db.query<{ tokenCiphertext: string; expiresAt: string }>(`SELECT token_ciphertext AS "tokenCiphertext", expires_at AS "expiresAt" FROM broker_tokens WHERE connection_id=?`, [connectionId])).rows[0] ?? null;
}

export async function deleteBrokerToken(connectionId: string) {
  const db = await getTradingDb();
  await db.query(`DELETE FROM broker_tokens WHERE connection_id=?`, [connectionId]);
}

export type LiveRiskPolicy = {
  liveEnabled: boolean;
  automationEnabled: boolean;
  killSwitch: boolean;
  maxOrderQuantity: number;
  maxOrderNotional: number;
  maxDailyNotional: number;
  maxOpenOrders: number;
  allowedSymbols: string[];
  acknowledgedAt: string | null;
  updatedAt: string;
};

function mapRiskRow(row: Record<string, unknown>): LiveRiskPolicy {
  let allowedSymbols: string[] = [];
  try { allowedSymbols = JSON.parse(String(row.allowedSymbolsJson ?? "[]")) as string[]; } catch { allowedSymbols = []; }
  return { liveEnabled: Number(row.liveEnabled) === 1, automationEnabled: Number(row.automationEnabled) === 1, killSwitch: Number(row.killSwitch) === 1, maxOrderQuantity: Number(row.maxOrderQuantity), maxOrderNotional: Number(row.maxOrderNotional), maxDailyNotional: Number(row.maxDailyNotional), maxOpenOrders: Number(row.maxOpenOrders), allowedSymbols, acknowledgedAt: row.acknowledgedAt ? String(row.acknowledgedAt) : null, updatedAt: String(row.updatedAt) };
}

export async function getLiveRiskPolicy(userId: string): Promise<LiveRiskPolicy> {
  const db = await getTradingDb();
  const now = new Date().toISOString();
  await db.query(`INSERT INTO live_risk_policies (user_id, live_enabled, automation_enabled, kill_switch, max_order_quantity, max_order_notional, max_daily_notional, max_open_orders, allowed_symbols_json, acknowledged_at, updated_at) VALUES (?, 0, 0, 1, 10, 1000000, 5000000, 5, '[]', NULL, ?) ON CONFLICT(user_id) DO NOTHING`, [userId, now]);
  const row = (await db.query<Record<string, unknown>>(`SELECT live_enabled AS "liveEnabled", automation_enabled AS "automationEnabled", kill_switch AS "killSwitch", max_order_quantity AS "maxOrderQuantity", max_order_notional AS "maxOrderNotional", max_daily_notional AS "maxDailyNotional", max_open_orders AS "maxOpenOrders", allowed_symbols_json AS "allowedSymbolsJson", acknowledged_at AS "acknowledgedAt", updated_at AS "updatedAt" FROM live_risk_policies WHERE user_id=?`, [userId])).rows[0];
  if (!row) throw new Error("live risk policy unavailable");
  return mapRiskRow(row);
}

export async function saveLiveRiskPolicy(userId: string, policy: Omit<LiveRiskPolicy, "updatedAt">) {
  const db = await getTradingDb();
  const now = new Date().toISOString();
  await db.query(`INSERT INTO live_risk_policies (user_id, live_enabled, automation_enabled, kill_switch, max_order_quantity, max_order_notional, max_daily_notional, max_open_orders, allowed_symbols_json, acknowledged_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET live_enabled=excluded.live_enabled, automation_enabled=excluded.automation_enabled, kill_switch=excluded.kill_switch, max_order_quantity=excluded.max_order_quantity, max_order_notional=excluded.max_order_notional, max_daily_notional=excluded.max_daily_notional, max_open_orders=excluded.max_open_orders, allowed_symbols_json=excluded.allowed_symbols_json, acknowledged_at=excluded.acknowledged_at, updated_at=excluded.updated_at`, [userId, policy.liveEnabled ? 1 : 0, policy.automationEnabled ? 1 : 0, policy.killSwitch ? 1 : 0, policy.maxOrderQuantity, policy.maxOrderNotional, policy.maxDailyNotional, policy.maxOpenOrders, JSON.stringify(policy.allowedSymbols), policy.acknowledgedAt, now]);
  return getLiveRiskPolicy(userId);
}

export async function getLiveRiskUsage(userId: string) {
  const db = await getTradingDb();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const row = (await db.query<{ dailyNotional: number; openOrders: number }>(`SELECT COALESCE(SUM(CASE WHEN submitted_at>=? AND status NOT IN ('REJECTED','CANCELLED') THEN COALESCE(price, average_price, 0)*quantity ELSE 0 END),0) AS "dailyNotional", COALESCE(SUM(CASE WHEN status IN ('PENDING','SUBMITTED','PARTIAL','CANCEL_REQUESTED','UNKNOWN') THEN 1 ELSE 0 END),0) AS "openOrders" FROM live_orders WHERE user_id=?`, [start.toISOString(), userId])).rows[0];
  return { dailyNotional: Number(row?.dailyNotional ?? 0), openOrders: Number(row?.openOrders ?? 0) };
}

export type LiveOrderRequestRecord = { connectionId: string; symbol: string; side: "BUY" | "SELL"; orderType: "LIMIT" | "MARKET"; timeInForce: "DAY" | "IOC" | "FOK"; venue: "KRX" | "NXT" | "SOR"; quantity: number; price: number | null };

export async function createLiveOrderPreview(input: { userId: string; connectionId: string; requestHash: string; request: LiveOrderRequestRecord; quotePrice: number; estimatedNotional: number; ttlMs?: number }) {
  const db = await getTradingDb();
  const now = new Date();
  const id = `LPV-${crypto.randomUUID()}`;
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? 60_000)).toISOString();
  await db.query(`INSERT INTO live_order_previews (id, user_id, connection_id, request_hash, request_json, quote_price, estimated_notional, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`, [id, input.userId, input.connectionId, input.requestHash, JSON.stringify(input.request), input.quotePrice, input.estimatedNotional, expiresAt, now.toISOString()]);
  return { id, request: input.request, quotePrice: input.quotePrice, estimatedNotional: input.estimatedNotional, expiresAt };
}

export async function consumeLiveOrderPreview(userId: string, previewId: string) {
  const db = await getTradingDb();
  const now = new Date().toISOString();
  const row = (await db.query<{ connectionId: string; requestHash: string; requestJson: string; quotePrice: number; estimatedNotional: number; expiresAt: string }>(`SELECT connection_id AS "connectionId", request_hash AS "requestHash", request_json AS "requestJson", quote_price AS "quotePrice", estimated_notional AS "estimatedNotional", expires_at AS "expiresAt" FROM live_order_previews WHERE id=? AND user_id=? AND consumed_at IS NULL AND expires_at>?`, [previewId, userId, now])).rows[0];
  if (!row) return null;
  const changed = await db.query(`UPDATE live_order_previews SET consumed_at=? WHERE id=? AND user_id=? AND consumed_at IS NULL`, [now, previewId, userId]);
  if (changed.changes !== 1) return null;
  return { ...row, quotePrice: Number(row.quotePrice), estimatedNotional: Number(row.estimatedNotional), request: JSON.parse(row.requestJson) as LiveOrderRequestRecord };
}

export type LiveOrderRecord = {
  id: string; userId: string; connectionId: string; clientOrderId: string; brokerOrderId: string | null; brokerOrgNo: string | null; symbol: string; side: "BUY" | "SELL"; orderType: "LIMIT" | "MARKET"; timeInForce: "DAY" | "IOC" | "FOK"; venue: "KRX" | "NXT" | "SOR"; price: number | null; quantity: number; executedQuantity: number; averagePrice: number | null; status: string; brokerCode: string | null; brokerMessage: string | null; submittedAt: string; updatedAt: string;
};

const liveOrderSelect = `id, user_id AS "userId", connection_id AS "connectionId", client_order_id AS "clientOrderId", broker_order_id AS "brokerOrderId", broker_org_no AS "brokerOrgNo", symbol, side, order_type AS "orderType", time_in_force AS "timeInForce", venue, price, quantity, executed_quantity AS "executedQuantity", average_price AS "averagePrice", status, broker_code AS "brokerCode", broker_message AS "brokerMessage", submitted_at AS "submittedAt", updated_at AS "updatedAt"`;

function normalizeLiveOrder(row: LiveOrderRecord): LiveOrderRecord {
  return { ...row, price: row.price == null ? null : Number(row.price), quantity: Number(row.quantity), executedQuantity: Number(row.executedQuantity), averagePrice: row.averagePrice == null ? null : Number(row.averagePrice) };
}

export async function createPendingLiveOrder(input: { id: string; userId: string; connectionId: string; clientOrderId: string; request: LiveOrderRequestRecord }) {
  const db = await getTradingDb();
  const now = new Date().toISOString();
  await db.query(`INSERT INTO live_orders (id, user_id, connection_id, client_order_id, broker_order_id, broker_org_no, symbol, side, order_type, time_in_force, venue, price, quantity, executed_quantity, average_price, status, broker_code, broker_message, submitted_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 'PENDING', NULL, NULL, ?, ?) ON CONFLICT(user_id, client_order_id) DO NOTHING`, [input.id, input.userId, input.connectionId, input.clientOrderId, input.request.symbol, input.request.side, input.request.orderType, input.request.timeInForce, input.request.venue, input.request.price, input.request.quantity, now, now]);
  return getLiveOrder(input.userId, input.id);
}

export async function updateLiveOrderBrokerState(userId: string, orderId: string, input: { brokerOrderId?: string | null; brokerOrgNo?: string | null; executedQuantity?: number; averagePrice?: number | null; status: string; brokerCode?: string | null; brokerMessage?: string | null }) {
  const db = await getTradingDb();
  await db.query(`UPDATE live_orders SET broker_order_id=COALESCE(?, broker_order_id), broker_org_no=COALESCE(?, broker_org_no), executed_quantity=COALESCE(?, executed_quantity), average_price=COALESCE(?, average_price), status=?, broker_code=?, broker_message=?, updated_at=? WHERE id=? AND user_id=?`, [input.brokerOrderId ?? null, input.brokerOrgNo ?? null, input.executedQuantity ?? null, input.averagePrice ?? null, input.status, input.brokerCode ?? null, input.brokerMessage ?? null, new Date().toISOString(), orderId, userId]);
  return getLiveOrder(userId, orderId);
}

export async function getLiveOrder(userId: string, orderId: string) {
  const db = await getTradingDb();
  const row = (await db.query<LiveOrderRecord>(`SELECT ${liveOrderSelect} FROM live_orders WHERE id=? AND user_id=?`, [orderId, userId])).rows[0];
  return row ? normalizeLiveOrder(row) : null;
}

export async function listLiveOrders(userId: string, limit = 100) {
  const db = await getTradingDb();
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  const rows = await db.query<LiveOrderRecord>(`SELECT ${liveOrderSelect} FROM live_orders WHERE user_id=? ORDER BY updated_at DESC LIMIT ${safeLimit}`, [userId]);
  return rows.rows.map(normalizeLiveOrder);
}

export async function listLiveOrdersForConnection(userId: string, connectionId: string, limit = 200) {
  const db = await getTradingDb();
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  const rows = await db.query<LiveOrderRecord>(`SELECT ${liveOrderSelect} FROM live_orders WHERE user_id=? AND connection_id=? ORDER BY updated_at DESC LIMIT ${safeLimit}`, [userId, connectionId]);
  return rows.rows.map(normalizeLiveOrder);
}
