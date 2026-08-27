import type { ChatGPTUser } from "../app/chatgpt-auth";
import { NEXTRADE_INSTRUMENTS } from "../engine/instrumentMaster";
import type { Execution, Order } from "../engine/matchingEngine";
import type { MarketPhase } from "../engine/koreanMarketRules";

type Statement = { sql: string; params?: unknown[] };
type QueryResult<T> = { rows: T[]; changes: number };
export type DatabaseAdapter = {
  kind: "postgres" | "d1";
  query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  batch(statements: Statement[]): Promise<void>;
};
type D1Like = {
  prepare(sql: string): {
    bind(...params: unknown[]): {
      all<T>(): Promise<{ results: T[]; meta: { changes?: number } }>;
    };
  };
  batch(statements: unknown[]): Promise<unknown>;
};

const OPEN_STATUSES = ["OPEN", "PARTIAL", "PENDING_TRIGGER"];
let adapterPromise: Promise<DatabaseAdapter> | null = null;
let schemaReady: Promise<void> | null = null;

const commonSchema = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'participant', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS paper_accounts (user_id TEXT PRIMARY KEY REFERENCES users(id), participant_id TEXT NOT NULL UNIQUE, cash_balance INTEGER NOT NULL DEFAULT 100000000, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS paper_positions (user_id TEXT NOT NULL REFERENCES users(id), symbol TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0, average_price INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, symbol))`,
  `CREATE TABLE IF NOT EXISTS paper_orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), participant_id TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL, order_type TEXT NOT NULL, time_in_force TEXT NOT NULL, price INTEGER, stop_price INTEGER, quantity INTEGER NOT NULL, remaining INTEGER NOT NULL, status TEXT NOT NULL, sequence INTEGER NOT NULL, accepted_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS paper_executions (id TEXT PRIMARY KEY, engine_execution_id TEXT NOT NULL, symbol TEXT NOT NULL, price INTEGER NOT NULL, quantity INTEGER NOT NULL, buy_order_id TEXT NOT NULL, sell_order_id TEXT NOT NULL, buy_user_id TEXT NOT NULL, sell_user_id TEXT NOT NULL, executed_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS order_idempotency (user_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, status_code INTEGER NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (user_id, idempotency_key))`,
  `CREATE TABLE IF NOT EXISTS venue_control (venue TEXT PRIMARY KEY, phase TEXT NOT NULL, halt_mode TEXT NOT NULL DEFAULT 'OPEN', reason TEXT, version INTEGER NOT NULL DEFAULT 1, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit_chain (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL, entity_id TEXT, payload_json TEXT NOT NULL, previous_hash TEXT NOT NULL, entry_hash TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS broker_connections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), provider TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'sandbox', account_label TEXT NOT NULL, account_ref TEXT NOT NULL, credential_ciphertext TEXT, status TEXT NOT NULL DEFAULT 'pending', last_checked_at TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS automation_strategies (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), connection_id TEXT, name TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL, strategy_type TEXT NOT NULL, trigger_operator TEXT NOT NULL, trigger_price INTEGER, order_type TEXT NOT NULL, limit_price INTEGER, quantity INTEGER NOT NULL, interval_seconds INTEGER NOT NULL DEFAULT 60, max_orders_per_day INTEGER NOT NULL DEFAULT 1, max_daily_notional INTEGER NOT NULL DEFAULT 1000000, status TEXT NOT NULL DEFAULT 'draft', execution_mode TEXT NOT NULL DEFAULT 'paper', last_evaluated_at TEXT, last_triggered_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS automation_runs (id TEXT PRIMARY KEY, strategy_id TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL, observed_price INTEGER, order_id TEXT, detail_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS broker_rate_windows (provider TEXT NOT NULL, connection_id TEXT NOT NULL, rate_group TEXT NOT NULL, window_started_at INTEGER NOT NULL, request_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (provider, connection_id, rate_group))`,
  `CREATE TABLE IF NOT EXISTS member_gateway_sessions (session_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, protocol TEXT NOT NULL DEFAULT 'NATIVE_JSON_1', status TEXT NOT NULL DEFAULT 'ACTIVE', expected_inbound_sequence INTEGER NOT NULL DEFAULT 1, outbound_sequence INTEGER NOT NULL DEFAULT 1, remote_address TEXT, connected_at TEXT NOT NULL, last_heartbeat_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS gateway_messages (id TEXT PRIMARY KEY, member_id TEXT NOT NULL, session_id TEXT NOT NULL, direction TEXT NOT NULL, message_type TEXT NOT NULL, session_sequence INTEGER NOT NULL, market_sequence INTEGER, client_order_id TEXT, venue_order_id TEXT, status TEXT NOT NULL, reject_code TEXT, payload_json TEXT NOT NULL, received_at TEXT NOT NULL, processed_at TEXT, latency_micros INTEGER)`,
  `CREATE TABLE IF NOT EXISTS drop_copy_events (id TEXT PRIMARY KEY, member_id TEXT NOT NULL, market_sequence INTEGER NOT NULL, event_type TEXT NOT NULL, order_id TEXT, execution_id TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS broker_tokens (connection_id TEXT PRIMARY KEY, token_ciphertext TEXT NOT NULL, expires_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS live_risk_policies (user_id TEXT PRIMARY KEY REFERENCES users(id), live_enabled INTEGER NOT NULL DEFAULT 0, automation_enabled INTEGER NOT NULL DEFAULT 0, kill_switch INTEGER NOT NULL DEFAULT 1, max_order_quantity INTEGER NOT NULL DEFAULT 10, max_order_notional INTEGER NOT NULL DEFAULT 1000000, max_daily_notional INTEGER NOT NULL DEFAULT 5000000, max_open_orders INTEGER NOT NULL DEFAULT 5, allowed_symbols_json TEXT NOT NULL DEFAULT '[]', acknowledged_at TEXT, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS live_order_previews (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), connection_id TEXT NOT NULL, request_hash TEXT NOT NULL, request_json TEXT NOT NULL, quote_price INTEGER NOT NULL, estimated_notional INTEGER NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS live_orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), connection_id TEXT NOT NULL, client_order_id TEXT NOT NULL, broker_order_id TEXT, broker_org_no TEXT, symbol TEXT NOT NULL, side TEXT NOT NULL, order_type TEXT NOT NULL, time_in_force TEXT NOT NULL, venue TEXT NOT NULL, price INTEGER, quantity INTEGER NOT NULL, executed_quantity INTEGER NOT NULL DEFAULT 0, average_price INTEGER, status TEXT NOT NULL, broker_code TEXT, broker_message TEXT, submitted_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS live_executions (id TEXT PRIMARY KEY, live_order_id TEXT NOT NULL, execution_ref TEXT NOT NULL, price INTEGER NOT NULL, quantity INTEGER NOT NULL, venue TEXT NOT NULL, executed_at TEXT NOT NULL)`,
];

const indexes = [
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_accounts_participant_id ON paper_accounts(participant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_paper_orders_user_updated ON paper_orders(user_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_paper_orders_symbol_status ON paper_orders(symbol, status)`,
  `CREATE INDEX IF NOT EXISTS idx_paper_orders_participant_status ON paper_orders(participant_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_paper_executions_buy_user_time ON paper_executions(buy_user_id, executed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_paper_executions_sell_user_time ON paper_executions(sell_user_id, executed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_paper_executions_symbol_time ON paper_executions(symbol, executed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_user_time ON audit_log(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_chain_user_time ON audit_chain(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_idempotency_created_at ON order_idempotency(created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_operator ON users(role) WHERE role='operator'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_broker_connections_user_provider_account ON broker_connections(user_id, provider, account_ref)`,
  `CREATE INDEX IF NOT EXISTS idx_broker_connections_user_status ON broker_connections(user_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_automation_strategies_user_status ON automation_strategies(user_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_automation_strategies_due ON automation_strategies(status, last_evaluated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_automation_runs_strategy_time ON automation_runs(strategy_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_automation_runs_user_time ON automation_runs(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_gateway_sessions_member_status ON member_gateway_sessions(member_id, status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_message_session_sequence ON gateway_messages(session_id, direction, session_sequence)`,
  `CREATE INDEX IF NOT EXISTS idx_gateway_message_member_clordid ON gateway_messages(member_id, client_order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_gateway_message_market_sequence ON gateway_messages(market_sequence)`,
  `CREATE INDEX IF NOT EXISTS idx_gateway_message_received_at ON gateway_messages(received_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_drop_copy_member_sequence_event ON drop_copy_events(member_id, market_sequence, event_type)`,
  `CREATE INDEX IF NOT EXISTS idx_drop_copy_member_time ON drop_copy_events(member_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_live_previews_user_expiry ON live_order_previews(user_id, expires_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_live_orders_user_client_order ON live_orders(user_id, client_order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_live_orders_user_updated ON live_orders(user_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_live_orders_connection_status ON live_orders(connection_id, status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_live_executions_order_ref ON live_executions(live_order_id, execution_ref)`,
  `CREATE INDEX IF NOT EXISTS idx_live_executions_time ON live_executions(executed_at)`,
];

function postgresSql(sql: string) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function createPostgresAdapter(): Promise<DatabaseAdapter> {
  const moduleName = "pg";
  const { Pool } = await import(/* @vite-ignore */ moduleName) as typeof import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  return {
    kind: "postgres",
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await pool.query(postgresSql(sql), params);
      return { rows: result.rows as T[], changes: result.rowCount ?? 0 };
    },
    async batch(statements: Statement[]) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const statement of statements) await client.query(postgresSql(statement.sql), statement.params ?? []);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

async function createD1Adapter(): Promise<DatabaseAdapter> {
  const moduleName = "cloudflare:workers";
  const workers = await import(/* @vite-ignore */ moduleName) as { env: { DB?: D1Like } };
  const db = workers.env.DB;
  if (!db) throw new Error("No database binding is configured");
  return {
    kind: "d1",
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await db.prepare(sql).bind(...params).all<T>();
      return { rows: result.results, changes: Number(result.meta.changes ?? 0) };
    },
    async batch(statements: Statement[]) {
      await db.batch(statements.map((statement) => db.prepare(statement.sql).bind(...(statement.params ?? []))));
    },
  };
}

async function getAdapter() {
  if (!adapterPromise) adapterPromise = process.env.DATABASE_URL ? createPostgresAdapter() : createD1Adapter();
  return adapterPromise;
}

export async function getTradingDb() {
  await ensureTradingSchema();
  return getAdapter();
}

export type PaperAccountView = {
  participantId: string;
  cashBalance: number;
  availableCash: number;
  positions: Array<{ symbol: string; quantity: number; availableQuantity: number; averagePrice: number }>;
};

export async function ensureTradingSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = await getAdapter();
      const auditSql = db.kind === "postgres"
        ? `CREATE TABLE IF NOT EXISTS audit_log (id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL, entity_id TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)`
        : `CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, action TEXT NOT NULL, entity_id TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)`;
      await db.batch([...commonSchema, auditSql, ...indexes].map((sql) => ({ sql })));
      await db.query(`INSERT INTO venue_control (venue, phase, halt_mode, reason, version, updated_by, updated_at) VALUES ('NEXTRADE', 'CONTINUOUS', 'OPEN', NULL, 1, 'SYSTEM', ?) ON CONFLICT(venue) DO NOTHING`, [new Date().toISOString()]);
      if (db.kind === "d1") await db.query("PRAGMA optimize");
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function participantIdFor(userId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
  const short = [...new Uint8Array(digest)].slice(0, 6).map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `MBR-${short}`;
}

export async function ensurePaperUser(user: ChatGPTUser) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const now = new Date().toISOString();
  const participantId = await participantIdFor(user.userId);
  await db.batch([
    { sql: `INSERT INTO users (id, email, display_name, role, status, created_at, last_seen_at) VALUES (?, ?, ?, 'participant', 'active', ?, ?) ON CONFLICT(id) DO UPDATE SET email=excluded.email, display_name=excluded.display_name, last_seen_at=excluded.last_seen_at`, params: [user.userId, user.email, user.displayName, now, now] },
    { sql: `INSERT INTO paper_accounts (user_id, participant_id, cash_balance, created_at) VALUES (?, ?, 100000000, ?) ON CONFLICT(user_id) DO NOTHING`, params: [user.userId, participantId, now] },
    ...NEXTRADE_INSTRUMENTS.map((instrument) => ({ sql: `INSERT INTO paper_positions (user_id, symbol, quantity, average_price, updated_at) VALUES (?, ?, 100, ?, ?) ON CONFLICT(user_id, symbol) DO NOTHING`, params: [user.userId, instrument.symbol, instrument.basePrice ?? 0, now] })),
  ]);
  const configuredOperators = new Set((process.env.OPERATOR_USER_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  if (configuredOperators.has(user.userId)) await db.query(`UPDATE users SET role='operator' WHERE id=?`, [user.userId]);
  const role = (await db.query<{ role: "operator" | "participant" }>(`SELECT role FROM users WHERE id=?`, [user.userId])).rows[0]?.role ?? "participant";
  return { participantId, role };
}

export async function ensureGatewayMember(memberId: string) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const userId = `member:${memberId}`;
  const now = new Date().toISOString();
  await db.batch([
    { sql: `INSERT INTO users (id, email, display_name, role, status, created_at, last_seen_at) VALUES (?, ?, ?, 'participant', 'active', ?, ?) ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at`, params: [userId, `${memberId.toLowerCase()}@certification.invalid`, `${memberId} 회원사`, now, now] },
    { sql: `INSERT INTO paper_accounts (user_id, participant_id, cash_balance, created_at) VALUES (?, ?, 9000000000000000, ?) ON CONFLICT(user_id) DO NOTHING`, params: [userId, memberId, now] },
    ...NEXTRADE_INSTRUMENTS.map((instrument) => ({ sql: `INSERT INTO paper_positions (user_id, symbol, quantity, average_price, updated_at) VALUES (?, ?, 1000000000, ?, ?) ON CONFLICT(user_id, symbol) DO NOTHING`, params: [userId, instrument.symbol, instrument.basePrice ?? 0, now] })),
  ]);
  return { userId, participantId: memberId };
}

export async function getPaperAccount(userId: string): Promise<PaperAccountView> {
  await ensureTradingSchema();
  const db = await getAdapter();
  const account = (await db.query<{ participantId: string; cashBalance: number }>(`SELECT participant_id AS "participantId", cash_balance AS "cashBalance" FROM paper_accounts WHERE user_id = ?`, [userId])).rows[0];
  if (!account) throw new Error("paper account not found");
  const positions = await db.query<{ symbol: string; quantity: number; averagePrice: number; availableQuantity: number }>(`SELECT p.symbol, p.quantity, p.average_price AS "averagePrice", p.quantity - COALESCE(SUM(CASE WHEN o.side='SELL' AND o.status IN ('OPEN','PARTIAL','PENDING_TRIGGER') THEN o.remaining ELSE 0 END), 0) AS "availableQuantity" FROM paper_positions p LEFT JOIN paper_orders o ON o.user_id=p.user_id AND o.symbol=p.symbol WHERE p.user_id=? GROUP BY p.symbol, p.quantity, p.average_price ORDER BY p.symbol`, [userId]);
  const reserved = (await db.query<{ amount: number }>(`SELECT COALESCE(SUM(CASE WHEN price IS NOT NULL THEN price * remaining ELSE 0 END), 0) AS amount FROM paper_orders WHERE user_id=? AND side='BUY' AND status IN ('OPEN','PARTIAL','PENDING_TRIGGER')`, [userId])).rows[0];
  return { ...account, cashBalance: Number(account.cashBalance), availableCash: Number(account.cashBalance) - Number(reserved?.amount ?? 0), positions: positions.rows.map((row) => ({ ...row, quantity: Number(row.quantity), averagePrice: Number(row.averagePrice), availableQuantity: Number(row.availableQuantity) })) };
}

export async function preTradeRiskCheck(userId: string, side: "BUY" | "SELL", symbol: string, quantity: number, referencePrice: number) {
  const account = await getPaperAccount(userId);
  if (side === "BUY" && referencePrice * quantity > account.availableCash) return "모의 예수금이 부족합니다";
  if (side === "SELL") {
    const position = account.positions.find((item) => item.symbol === symbol);
    if (!position || position.availableQuantity < quantity) return "매도 가능 수량이 부족합니다";
  }
  return null;
}

export async function savePaperOrder(userId: string, order: Order) {
  await ensureTradingSchema();
  const db = await getAdapter();
  await db.query(`INSERT INTO paper_orders (id, user_id, participant_id, symbol, side, order_type, time_in_force, price, stop_price, quantity, remaining, status, sequence, accepted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET remaining=excluded.remaining, status=excluded.status, sequence=excluded.sequence, updated_at=excluded.updated_at`, [order.id, userId, order.participantId, order.symbol, order.side, order.type, order.timeInForce, order.price, order.stopPrice ?? null, order.quantity, order.remaining, order.status, order.sequence, order.acceptedAt, order.lastUpdatedAt]);
}

export async function ownerForOrder(orderId: string) {
  await ensureTradingSchema();
  const db = await getAdapter();
  return (await db.query<{ userId: string }>(`SELECT user_id AS "userId" FROM paper_orders WHERE id=?`, [orderId])).rows[0];
}

export async function saveExecution(execution: Execution) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const buyOwner = await ownerForOrder(execution.buyOrderId);
  const sellOwner = await ownerForOrder(execution.sellOrderId);
  if (!buyOwner || !sellOwner) return;
  const id = `${execution.buyOrderId}:${execution.sellOrderId}:${execution.sequence}`;
  const inserted = await db.query(`INSERT INTO paper_executions (id, engine_execution_id, symbol, price, quantity, buy_order_id, sell_order_id, buy_user_id, sell_user_id, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`, [id, execution.id, execution.symbol, execution.price, execution.quantity, execution.buyOrderId, execution.sellOrderId, buyOwner.userId, sellOwner.userId, execution.executedAt]);
  if (inserted.changes === 0) return;
  const now = new Date().toISOString();
  await db.batch([
    { sql: `UPDATE paper_accounts SET cash_balance = cash_balance - ? WHERE user_id=?`, params: [execution.price * execution.quantity, buyOwner.userId] },
    { sql: `UPDATE paper_accounts SET cash_balance = cash_balance + ? WHERE user_id=?`, params: [execution.price * execution.quantity, sellOwner.userId] },
    { sql: `INSERT INTO paper_positions (user_id, symbol, quantity, average_price, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, symbol) DO UPDATE SET quantity=paper_positions.quantity+excluded.quantity, average_price=CASE WHEN paper_positions.quantity+excluded.quantity>0 THEN CAST(((paper_positions.quantity*paper_positions.average_price)+(excluded.quantity*excluded.average_price))/(paper_positions.quantity+excluded.quantity) AS INTEGER) ELSE 0 END, updated_at=excluded.updated_at`, params: [buyOwner.userId, execution.symbol, execution.quantity, execution.price, now] },
    { sql: `UPDATE paper_positions SET quantity=quantity-?, updated_at=? WHERE user_id=? AND symbol=?`, params: [execution.quantity, now, sellOwner.userId, execution.symbol] },
  ]);
}

export async function addAudit(userId: string, action: string, entityId: string | null, payload: unknown) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const createdAt = new Date().toISOString();
  const payloadJson = JSON.stringify(payload);
  const previousHash = (await db.query<{ entryHash: string }>(`SELECT entry_hash AS "entryHash" FROM audit_chain WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 1`, [userId])).rows[0]?.entryHash ?? "GENESIS";
  const entryHash = await computeAuditEntryHash(previousHash, userId, action, entityId, payloadJson, createdAt);
  const id = `AUD-${Date.now()}-${crypto.randomUUID()}`;
  await db.batch([
    { sql: `INSERT INTO audit_log (user_id, action, entity_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`, params: [userId, action, entityId, payloadJson, createdAt] },
    { sql: `INSERT INTO audit_chain (id, user_id, action, entity_id, payload_json, previous_hash, entry_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, params: [id, userId, action, entityId, payloadJson, previousHash, entryHash, createdAt] },
  ]);
}

export async function listUserTradingState(userId: string) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const orders = await db.query<Order>(`SELECT id, participant_id AS "participantId", symbol, side, order_type AS type, time_in_force AS "timeInForce", price, stop_price AS "stopPrice", quantity, remaining, status, sequence, accepted_at AS "acceptedAt", updated_at AS "lastUpdatedAt" FROM paper_orders WHERE user_id=? ORDER BY updated_at DESC LIMIT 100`, [userId]);
  const executions = await db.query(`SELECT id, engine_execution_id AS "engineExecutionId", symbol, price, quantity, buy_order_id AS "buyOrderId", sell_order_id AS "sellOrderId", executed_at AS "executedAt" FROM paper_executions WHERE buy_user_id=? OR sell_user_id=? ORDER BY executed_at DESC LIMIT 100`, [userId, userId]);
  return { orders: orders.rows, executions: executions.rows };
}

export async function listOpenOrdersForHydration() {
  await ensureTradingSchema();
  const db = await getAdapter();
  const rows = await db.query<Order>(`SELECT id, participant_id AS "participantId", symbol, side, order_type AS type, time_in_force AS "timeInForce", price, stop_price AS "stopPrice", quantity, remaining, status, sequence, accepted_at AS "acceptedAt", updated_at AS "lastUpdatedAt" FROM paper_orders WHERE status IN ('OPEN','PARTIAL','PENDING_TRIGGER') ORDER BY sequence ASC, accepted_at ASC`);
  return rows.rows;
}

export async function listUserAudit(userId: string, limit = 50) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const result = await db.query<{ id: string; action: string; entityId: string | null; payloadJson: string; entryHash: string; createdAt: string }>(`SELECT id, action, entity_id AS "entityId", payload_json AS "payloadJson", entry_hash AS "entryHash", created_at AS "createdAt" FROM audit_chain WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT ${safeLimit}`, [userId]);
  return result.rows.map((row) => {
    let payload: unknown = null;
    try { payload = JSON.parse(row.payloadJson); } catch { payload = null; }
    return { id: row.id, action: row.action, entityId: row.entityId, payload, entryHash: row.entryHash, createdAt: row.createdAt };
  });
}

export type VenueHaltMode = "OPEN" | "CANCEL_ONLY" | "FULL_STOP";
export type VenueControlState = { venue: "NEXTRADE"; phase: MarketPhase; haltMode: VenueHaltMode; reason: string | null; version: number; updatedBy: string; updatedAt: string };

export async function getVenueControl(): Promise<VenueControlState> {
  await ensureTradingSchema();
  const db = await getAdapter();
  const row = (await db.query<{ venue: "NEXTRADE"; phase: MarketPhase; haltMode: VenueHaltMode; reason: string | null; version: number; updatedBy: string; updatedAt: string }>(`SELECT venue, phase, halt_mode AS "haltMode", reason, version, updated_by AS "updatedBy", updated_at AS "updatedAt" FROM venue_control WHERE venue='NEXTRADE'`)).rows[0];
  if (!row) throw new Error("venue control state is unavailable");
  return { ...row, version: Number(row.version) };
}

export async function updateVenueControl(input: { phase: MarketPhase; haltMode: VenueHaltMode; reason?: string | null; expectedVersion: number; updatedBy: string }) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const result = await db.query(`UPDATE venue_control SET phase=?, halt_mode=?, reason=?, version=version+1, updated_by=?, updated_at=? WHERE venue='NEXTRADE' AND version=?`, [input.phase, input.haltMode, input.reason ?? null, input.updatedBy, new Date().toISOString(), input.expectedVersion]);
  if (result.changes !== 1) return null;
  return getVenueControl();
}

export async function getUserRole(userId: string): Promise<"operator" | "participant"> {
  await ensureTradingSchema();
  const db = await getAdapter();
  return (await db.query<{ role: "operator" | "participant" }>(`SELECT role FROM users WHERE id=?`, [userId])).rows[0]?.role ?? "participant";
}

export async function getIdempotencyRecord(userId: string, key: string) {
  await ensureTradingSchema();
  const db = await getAdapter();
  return (await db.query<{ requestHash: string; statusCode: number; responseJson: string }>(`SELECT request_hash AS "requestHash", status_code AS "statusCode", response_json AS "responseJson" FROM order_idempotency WHERE user_id=? AND idempotency_key=?`, [userId, key])).rows[0] ?? null;
}

export async function saveIdempotencyRecord(userId: string, key: string, requestHash: string, statusCode: number, response: unknown) {
  await ensureTradingSchema();
  const db = await getAdapter();
  await db.query(`INSERT INTO order_idempotency (user_id, idempotency_key, request_hash, status_code, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, idempotency_key) DO NOTHING`, [userId, key, requestHash, statusCode, JSON.stringify(response), new Date().toISOString()]);
}

export async function verifyAuditChain(userId: string) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const rows = await db.query<{ id: string; action: string; entityId: string | null; payloadJson: string; previousHash: string; entryHash: string; createdAt: string }>(`SELECT id, action, entity_id AS "entityId", payload_json AS "payloadJson", previous_hash AS "previousHash", entry_hash AS "entryHash", created_at AS "createdAt" FROM audit_chain WHERE user_id=? ORDER BY created_at ASC, id ASC LIMIT 2000`, [userId]);
  let previousHash = "GENESIS";
  for (const row of rows.rows) {
    const expected = await computeAuditEntryHash(previousHash, userId, row.action, row.entityId, row.payloadJson, row.createdAt);
    if (row.previousHash !== previousHash || row.entryHash !== expected) return { ok: false, checked: rows.rows.length, failedAt: row.id };
    previousHash = row.entryHash;
  }
  return { ok: true, checked: rows.rows.length, head: previousHash };
}

export async function computeAuditEntryHash(previousHash: string, userId: string, action: string, entityId: string | null, payloadJson: string, createdAt: string) {
  const value = [previousHash, userId, action, entityId ?? "", payloadJson, createdAt].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getPersistenceHealth() {
  const startedAt = Date.now();
  try {
    await ensureTradingSchema();
    const db = await getAdapter();
    await db.query("SELECT 1 AS ok");
    return { ok: true, provider: db.kind, latencyMs: Date.now() - startedAt };
  } catch {
    return { ok: false, provider: "unavailable", latencyMs: Date.now() - startedAt };
  }
}

export type BrokerConnectionView = {
  id: string;
  provider: string;
  mode: "sandbox" | "production";
  accountLabel: string;
  accountRef: string;
  status: "pending" | "connected" | "error" | "disabled";
  hasCredentials: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function listBrokerConnections(userId: string): Promise<BrokerConnectionView[]> {
  await ensureTradingSchema();
  const db = await getAdapter();
  const rows = await db.query<BrokerConnectionView & { credentialCiphertext: string | null }>(`SELECT id, provider, mode, account_label AS "accountLabel", account_ref AS "accountRef", status, credential_ciphertext AS "credentialCiphertext", last_checked_at AS "lastCheckedAt", last_error AS "lastError", created_at AS "createdAt", updated_at AS "updatedAt" FROM broker_connections WHERE user_id=? ORDER BY created_at DESC`, [userId]);
  return rows.rows.map(({ credentialCiphertext, ...row }) => ({ ...row, hasCredentials: Boolean(credentialCiphertext) }));
}

export async function saveBrokerConnection(input: { id: string; userId: string; provider: string; mode: "sandbox" | "production"; accountLabel: string; accountRef: string; credentialCiphertext: string | null; status: "pending" | "connected" | "error"; lastError?: string | null }) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const now = new Date().toISOString();
  await db.query(`INSERT INTO broker_connections (id, user_id, provider, mode, account_label, account_ref, credential_ciphertext, status, last_checked_at, last_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, provider, account_ref) DO UPDATE SET mode=excluded.mode, account_label=excluded.account_label, credential_ciphertext=excluded.credential_ciphertext, status=excluded.status, last_checked_at=excluded.last_checked_at, last_error=excluded.last_error, updated_at=excluded.updated_at`, [input.id, input.userId, input.provider, input.mode, input.accountLabel, input.accountRef, input.credentialCiphertext, input.status, now, input.lastError ?? null, now, now]);
  return (await listBrokerConnections(input.userId)).find((item) => item.provider === input.provider && item.accountRef === input.accountRef) ?? null;
}

export async function deleteBrokerConnection(userId: string, connectionId: string) {
  await ensureTradingSchema();
  const db = await getAdapter();
  await db.query(`UPDATE automation_strategies SET status='paused', updated_at=? WHERE user_id=? AND connection_id=? AND status='armed'`, [new Date().toISOString(), userId, connectionId]);
  return (await db.query(`DELETE FROM broker_connections WHERE id=? AND user_id=?`, [connectionId, userId])).changes === 1;
}

export type AutomationStrategyView = {
  id: string;
  connectionId: string | null;
  name: string;
  symbol: string;
  side: "BUY" | "SELL";
  strategyType: "PRICE_CROSS" | "DCA" | "BROKER_CONDITIONAL";
  triggerOperator: "GTE" | "LTE";
  triggerPrice: number | null;
  orderType: "LIMIT" | "MARKET";
  limitPrice: number | null;
  quantity: number;
  intervalSeconds: number;
  maxOrdersPerDay: number;
  maxDailyNotional: number;
  status: "draft" | "armed" | "paused" | "stopped";
  executionMode: "paper" | "sandbox" | "production";
  lastEvaluatedAt: string | null;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function listAutomationStrategies(userId: string): Promise<AutomationStrategyView[]> {
  await ensureTradingSchema();
  const db = await getAdapter();
  const rows = await db.query<AutomationStrategyView>(`SELECT id, connection_id AS "connectionId", name, symbol, side, strategy_type AS "strategyType", trigger_operator AS "triggerOperator", trigger_price AS "triggerPrice", order_type AS "orderType", limit_price AS "limitPrice", quantity, interval_seconds AS "intervalSeconds", max_orders_per_day AS "maxOrdersPerDay", max_daily_notional AS "maxDailyNotional", status, execution_mode AS "executionMode", last_evaluated_at AS "lastEvaluatedAt", last_triggered_at AS "lastTriggeredAt", created_at AS "createdAt", updated_at AS "updatedAt" FROM automation_strategies WHERE user_id=? ORDER BY created_at DESC`, [userId]);
  return rows.rows.map((row) => ({ ...row, triggerPrice: row.triggerPrice == null ? null : Number(row.triggerPrice), limitPrice: row.limitPrice == null ? null : Number(row.limitPrice), quantity: Number(row.quantity), intervalSeconds: Number(row.intervalSeconds), maxOrdersPerDay: Number(row.maxOrdersPerDay), maxDailyNotional: Number(row.maxDailyNotional) }));
}

export async function saveAutomationStrategy(userId: string, input: Omit<AutomationStrategyView, "lastEvaluatedAt" | "lastTriggeredAt" | "createdAt" | "updatedAt">) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const now = new Date().toISOString();
  await db.query(`INSERT INTO automation_strategies (id, user_id, connection_id, name, symbol, side, strategy_type, trigger_operator, trigger_price, order_type, limit_price, quantity, interval_seconds, max_orders_per_day, max_daily_notional, status, execution_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET connection_id=excluded.connection_id, name=excluded.name, symbol=excluded.symbol, side=excluded.side, strategy_type=excluded.strategy_type, trigger_operator=excluded.trigger_operator, trigger_price=excluded.trigger_price, order_type=excluded.order_type, limit_price=excluded.limit_price, quantity=excluded.quantity, interval_seconds=excluded.interval_seconds, max_orders_per_day=excluded.max_orders_per_day, max_daily_notional=excluded.max_daily_notional, status=excluded.status, execution_mode=excluded.execution_mode, updated_at=excluded.updated_at WHERE automation_strategies.user_id=?`, [input.id, userId, input.connectionId, input.name, input.symbol, input.side, input.strategyType, input.triggerOperator, input.triggerPrice, input.orderType, input.limitPrice, input.quantity, input.intervalSeconds, input.maxOrdersPerDay, input.maxDailyNotional, input.status, input.executionMode, now, now, userId]);
  return (await listAutomationStrategies(userId)).find((item) => item.id === input.id) ?? null;
}

export async function updateAutomationStrategyStatus(userId: string, strategyId: string, status: AutomationStrategyView["status"]) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const changed = await db.query(`UPDATE automation_strategies SET status=?, updated_at=? WHERE id=? AND user_id=?`, [status, new Date().toISOString(), strategyId, userId]);
  if (changed.changes !== 1) return null;
  return (await listAutomationStrategies(userId)).find((item) => item.id === strategyId) ?? null;
}

export async function getAutomationRunUsage(userId: string, strategyId: string, since: string) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const rows = await db.query<{ detailJson: string }>(`SELECT detail_json AS "detailJson" FROM automation_runs WHERE user_id=? AND strategy_id=? AND created_at>=? AND status='ORDER_SUBMITTED'`, [userId, strategyId, since]);
  return { orders: rows.rows.length, notional: rows.rows.reduce((sum, row) => { try { return sum + Number((JSON.parse(row.detailJson) as { notional?: number }).notional ?? 0); } catch { return sum; } }, 0) };
}

export async function recordAutomationRun(input: { strategyId: string; userId: string; status: string; observedPrice: number | null; orderId?: string | null; detail: Record<string, unknown>; triggered: boolean }) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const now = new Date().toISOString();
  await db.batch([
    { sql: `INSERT INTO automation_runs (id, strategy_id, user_id, status, observed_price, order_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, params: [`RUN-${crypto.randomUUID()}`, input.strategyId, input.userId, input.status, input.observedPrice, input.orderId ?? null, JSON.stringify(input.detail), now] },
    { sql: `UPDATE automation_strategies SET last_evaluated_at=?, last_triggered_at=CASE WHEN ? THEN ? ELSE last_triggered_at END, updated_at=? WHERE id=? AND user_id=?`, params: [now, input.triggered ? 1 : 0, now, now, input.strategyId, input.userId] },
  ]);
}

export async function consumeBrokerRateLimit(provider: string, connectionId: string, rateGroup: string, limit: number, windowMs = 1000, now = Date.now()) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const result = await db.query<{ requestCount: number; windowStartedAt: number }>(`INSERT INTO broker_rate_windows (provider, connection_id, rate_group, window_started_at, request_count) VALUES (?, ?, ?, ?, 1) ON CONFLICT(provider, connection_id, rate_group) DO UPDATE SET window_started_at=CASE WHEN ?-broker_rate_windows.window_started_at>=? THEN excluded.window_started_at ELSE broker_rate_windows.window_started_at END, request_count=CASE WHEN ?-broker_rate_windows.window_started_at>=? THEN 1 ELSE broker_rate_windows.request_count+1 END RETURNING request_count AS "requestCount", window_started_at AS "windowStartedAt"`, [provider, connectionId, rateGroup, now, now, windowMs, now, windowMs]);
  const row = result.rows[0] ?? { requestCount: limit + 1, windowStartedAt: now };
  const count = Number(row.requestCount);
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterMs: count <= limit ? 0 : Math.max(1, windowMs - (now - Number(row.windowStartedAt))) };
}

export type MemberGatewaySession = { sessionId: string; memberId: string; protocol: string; status: "ACTIVE" | "LOGGED_OUT" | "KILLED"; expectedInboundSequence: number; outboundSequence: number; connectedAt: string; lastHeartbeatAt: string };

export async function ensureMemberGatewaySession(memberId: string, sessionId: string, remoteAddress?: string | null): Promise<MemberGatewaySession> {
  await ensureTradingSchema();
  const db = await getAdapter();
  const now = new Date().toISOString();
  await db.query(`INSERT INTO member_gateway_sessions (session_id, member_id, protocol, status, expected_inbound_sequence, outbound_sequence, remote_address, connected_at, last_heartbeat_at) VALUES (?, ?, 'NATIVE_JSON_1', 'ACTIVE', 1, 1, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET last_heartbeat_at=excluded.last_heartbeat_at`, [sessionId, memberId, remoteAddress ?? null, now, now]);
  const row = (await db.query<MemberGatewaySession>(`SELECT session_id AS "sessionId", member_id AS "memberId", protocol, status, expected_inbound_sequence AS "expectedInboundSequence", outbound_sequence AS "outboundSequence", connected_at AS "connectedAt", last_heartbeat_at AS "lastHeartbeatAt" FROM member_gateway_sessions WHERE session_id=?`, [sessionId])).rows[0];
  if (!row) throw new Error("gateway session unavailable");
  return { ...row, expectedInboundSequence: Number(row.expectedInboundSequence), outboundSequence: Number(row.outboundSequence) };
}

export async function consumeGatewaySequence(sessionId: string, memberId: string, sequence: number) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const now = new Date().toISOString();
  const changed = await db.query(`UPDATE member_gateway_sessions SET expected_inbound_sequence=expected_inbound_sequence+1, last_heartbeat_at=? WHERE session_id=? AND member_id=? AND status='ACTIVE' AND expected_inbound_sequence=?`, [now, sessionId, memberId, sequence]);
  return changed.changes === 1;
}

export async function gatewayClientOrderExists(memberId: string, clientOrderId: string) {
  await ensureTradingSchema();
  const db = await getAdapter();
  return Boolean((await db.query<{ id: string }>(`SELECT id FROM gateway_messages WHERE member_id=? AND client_order_id=? AND direction='IN' LIMIT 1`, [memberId, clientOrderId])).rows[0]);
}

export async function nextGatewayOutboundSequence(sessionId: string, memberId: string) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const row = (await db.query<{ sequence: number }>(`UPDATE member_gateway_sessions SET outbound_sequence=outbound_sequence+1 WHERE session_id=? AND member_id=? RETURNING outbound_sequence-1 AS sequence`, [sessionId, memberId])).rows[0];
  return Number(row?.sequence ?? 0);
}

export async function recordGatewayMessage(input: { memberId: string; sessionId: string; direction: "IN" | "OUT"; messageType: string; sessionSequence: number; marketSequence?: number | null; clientOrderId?: string | null; venueOrderId?: string | null; status: string; rejectCode?: string | null; payload: unknown; receivedAt?: string; latencyMicros?: number | null }) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const now = new Date().toISOString();
  await db.query(`INSERT INTO gateway_messages (id, member_id, session_id, direction, message_type, session_sequence, market_sequence, client_order_id, venue_order_id, status, reject_code, payload_json, received_at, processed_at, latency_micros) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session_id, direction, session_sequence) DO NOTHING`, [`GW-${crypto.randomUUID()}`, input.memberId, input.sessionId, input.direction, input.messageType, input.sessionSequence, input.marketSequence ?? null, input.clientOrderId ?? null, input.venueOrderId ?? null, input.status, input.rejectCode ?? null, JSON.stringify(input.payload), input.receivedAt ?? now, now, input.latencyMicros ?? null]);
}

export async function recordDropCopy(input: { memberId: string; marketSequence: number; eventType: string; orderId?: string | null; executionId?: string | null; payload: unknown }) {
  await ensureTradingSchema();
  const db = await getAdapter();
  await db.query(`INSERT INTO drop_copy_events (id, member_id, market_sequence, event_type, order_id, execution_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(member_id, market_sequence, event_type) DO NOTHING`, [`DC-${crypto.randomUUID()}`, input.memberId, input.marketSequence, input.eventType, input.orderId ?? null, input.executionId ?? null, JSON.stringify(input.payload), new Date().toISOString()]);
}

export async function getGatewayOperations() {
  await ensureTradingSchema();
  const db = await getAdapter();
  const sessions = await db.query<{ memberId: string; sessionId: string; protocol: string; status: string; expectedInboundSequence: number; lastHeartbeatAt: string }>(`SELECT member_id AS "memberId", session_id AS "sessionId", protocol, status, expected_inbound_sequence AS "expectedInboundSequence", last_heartbeat_at AS "lastHeartbeatAt" FROM member_gateway_sessions ORDER BY last_heartbeat_at DESC LIMIT 50`);
  const metrics = (await db.query<{ messages: number; rejected: number; averageLatencyMicros: number; maxLatencyMicros: number }>(`SELECT COUNT(*) AS messages, COALESCE(SUM(CASE WHEN status='REJECTED' THEN 1 ELSE 0 END),0) AS rejected, COALESCE(AVG(latency_micros),0) AS "averageLatencyMicros", COALESCE(MAX(latency_micros),0) AS "maxLatencyMicros" FROM gateway_messages WHERE received_at>=?`, [new Date(Date.now() - 60_000).toISOString()])).rows[0];
  return { sessions: sessions.rows.map((row) => ({ ...row, expectedInboundSequence: Number(row.expectedInboundSequence) })), metrics: { messages: Number(metrics?.messages ?? 0), rejected: Number(metrics?.rejected ?? 0), averageLatencyMicros: Math.round(Number(metrics?.averageLatencyMicros ?? 0)), maxLatencyMicros: Number(metrics?.maxLatencyMicros ?? 0) } };
}

export async function listDropCopy(memberId: string, limit = 100) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  const rows = await db.query<{ id: string; marketSequence: number; eventType: string; orderId: string | null; executionId: string | null; payloadJson: string; createdAt: string }>(`SELECT id, market_sequence AS "marketSequence", event_type AS "eventType", order_id AS "orderId", execution_id AS "executionId", payload_json AS "payloadJson", created_at AS "createdAt" FROM drop_copy_events WHERE member_id=? ORDER BY market_sequence DESC LIMIT ${safeLimit}`, [memberId]);
  return rows.rows.map((row) => ({ ...row, marketSequence: Number(row.marketSequence), payload: JSON.parse(row.payloadJson) as unknown, payloadJson: undefined }));
}

export { OPEN_STATUSES };
