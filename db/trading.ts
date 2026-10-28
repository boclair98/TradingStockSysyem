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
  `CREATE TABLE IF NOT EXISTS engine_runtime_state (venue TEXT PRIMARY KEY, last_sequence BIGINT NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS paper_simulation_accounts (user_id TEXT PRIMARY KEY REFERENCES users(id), state_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, commit_token TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS paper_simulation_commands (user_id TEXT NOT NULL REFERENCES users(id), command_id TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (user_id, command_id))`,
  `CREATE TABLE IF NOT EXISTS audit_chain (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL, entity_id TEXT, payload_json TEXT NOT NULL, previous_hash TEXT NOT NULL, entry_hash TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit_chain_heads (user_id TEXT PRIMARY KEY, entry_hash TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS broker_connections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), provider TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'sandbox', account_label TEXT NOT NULL, account_ref TEXT NOT NULL, credential_ciphertext TEXT, status TEXT NOT NULL DEFAULT 'pending', last_checked_at TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS automation_strategies (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), connection_id TEXT, name TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL, strategy_type TEXT NOT NULL, trigger_operator TEXT NOT NULL, trigger_price INTEGER, order_type TEXT NOT NULL, limit_price INTEGER, quantity INTEGER NOT NULL, interval_seconds INTEGER NOT NULL DEFAULT 60, max_orders_per_day INTEGER NOT NULL DEFAULT 1, max_daily_notional INTEGER NOT NULL DEFAULT 1000000, status TEXT NOT NULL DEFAULT 'draft', execution_mode TEXT NOT NULL DEFAULT 'paper', last_evaluated_at TEXT, last_triggered_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, commit_token TEXT)`,
  `CREATE TABLE IF NOT EXISTS automation_runs (id TEXT PRIMARY KEY, strategy_id TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL, observed_price INTEGER, order_id TEXT, detail_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS automation_validation_progress (user_id TEXT NOT NULL, strategy_id TEXT NOT NULL, strategy_fingerprint TEXT NOT NULL, validation_count INTEGER NOT NULL DEFAULT 0, trigger_count INTEGER NOT NULL DEFAULT 0, waiting_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, strategy_id, strategy_fingerprint))`,
  `CREATE TABLE IF NOT EXISTS broker_rate_windows (provider TEXT NOT NULL, connection_id TEXT NOT NULL, rate_group TEXT NOT NULL, window_started_at INTEGER NOT NULL, request_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (provider, connection_id, rate_group))`,
  `CREATE TABLE IF NOT EXISTS member_gateway_sessions (session_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, protocol TEXT NOT NULL DEFAULT 'NATIVE_JSON_1', status TEXT NOT NULL DEFAULT 'ACTIVE', expected_inbound_sequence INTEGER NOT NULL DEFAULT 1, outbound_sequence INTEGER NOT NULL DEFAULT 1, remote_address TEXT, connected_at TEXT NOT NULL, last_heartbeat_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS gateway_messages (id TEXT PRIMARY KEY, member_id TEXT NOT NULL, session_id TEXT NOT NULL, direction TEXT NOT NULL, message_type TEXT NOT NULL, session_sequence INTEGER NOT NULL, market_sequence INTEGER, client_order_id TEXT, venue_order_id TEXT, status TEXT NOT NULL, reject_code TEXT, payload_json TEXT NOT NULL, received_at TEXT NOT NULL, processed_at TEXT, latency_micros INTEGER)`,
  `CREATE TABLE IF NOT EXISTS drop_copy_events (id TEXT PRIMARY KEY, member_id TEXT NOT NULL, market_sequence INTEGER NOT NULL, event_type TEXT NOT NULL, order_id TEXT, execution_id TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS broker_tokens (connection_id TEXT PRIMARY KEY, token_ciphertext TEXT NOT NULL, expires_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS live_risk_policies (user_id TEXT PRIMARY KEY REFERENCES users(id), live_enabled INTEGER NOT NULL DEFAULT 0, automation_enabled INTEGER NOT NULL DEFAULT 0, kill_switch INTEGER NOT NULL DEFAULT 1, max_order_quantity INTEGER NOT NULL DEFAULT 10, max_order_notional INTEGER NOT NULL DEFAULT 1000000, max_daily_notional INTEGER NOT NULL DEFAULT 5000000, max_open_orders INTEGER NOT NULL DEFAULT 5, allowed_symbols_json TEXT NOT NULL DEFAULT '[]', acknowledged_at TEXT, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, commit_token TEXT)`,
  `CREATE TABLE IF NOT EXISTS live_order_previews (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), connection_id TEXT NOT NULL, request_hash TEXT NOT NULL, request_json TEXT NOT NULL, quote_price INTEGER NOT NULL, estimated_notional INTEGER NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS live_orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), connection_id TEXT NOT NULL, client_order_id TEXT NOT NULL, broker_order_id TEXT, broker_org_no TEXT, symbol TEXT NOT NULL, side TEXT NOT NULL, order_type TEXT NOT NULL, time_in_force TEXT NOT NULL, venue TEXT NOT NULL, price INTEGER, quantity INTEGER NOT NULL, executed_quantity INTEGER NOT NULL DEFAULT 0, average_price INTEGER, risk_notional INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, broker_code TEXT, broker_message TEXT, submitted_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS live_executions (id TEXT PRIMARY KEY, live_order_id TEXT NOT NULL, execution_ref TEXT NOT NULL, price INTEGER NOT NULL, quantity INTEGER NOT NULL, venue TEXT NOT NULL, executed_at TEXT NOT NULL)`,
];

const indexes = [
  `CREATE INDEX IF NOT EXISTS idx_paper_simulation_commands_time ON paper_simulation_commands(user_id, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_accounts_participant_id ON paper_accounts(participant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_paper_orders_user_updated ON paper_orders(user_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_paper_orders_symbol_status ON paper_orders(symbol, status)`,
  `CREATE INDEX IF NOT EXISTS idx_paper_orders_participant_status ON paper_orders(participant_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_paper_executions_buy_user_time ON paper_executions(buy_user_id, executed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_paper_executions_sell_user_time ON paper_executions(sell_user_id, executed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_paper_executions_symbol_time ON paper_executions(symbol, executed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_user_time ON audit_log(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_chain_user_time ON audit_chain(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_chain_user_previous_hash ON audit_chain(user_id, previous_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_idempotency_created_at ON order_idempotency(created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_operator ON users(role) WHERE role='operator'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_broker_connections_user_provider_account ON broker_connections(user_id, provider, account_ref)`,
  `CREATE INDEX IF NOT EXISTS idx_broker_connections_user_status ON broker_connections(user_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_automation_strategies_user_status ON automation_strategies(user_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_automation_strategies_due ON automation_strategies(status, last_evaluated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_automation_runs_strategy_time ON automation_runs(strategy_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_automation_runs_user_time ON automation_runs(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_automation_progress_user_strategy ON automation_validation_progress(user_id, strategy_id)`,
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

/** Test-only seam for exercising the persistence layer against a transactional SQLite adapter. */
export function __setTradingDatabaseAdapterForTests(adapter: DatabaseAdapter | null) {
  adapterPromise = adapter ? Promise.resolve(adapter) : null;
  schemaReady = null;
}

async function ensureCompatibilityColumns(db: DatabaseAdapter, table: string, definitions: Array<{ name: string; sql: string }>) {
  const readColumns = () => db.kind === "postgres"
    ? db.query<{ name: string }>(`SELECT column_name AS "name" FROM information_schema.columns WHERE table_schema='public' AND table_name=?`, [table])
    : db.query<{ name: string }>(`PRAGMA table_info(${table})`);
  for (const definition of definitions) {
    if ((await readColumns()).rows.some((column) => column.name === definition.name)) continue;
    try {
      await db.query(definition.sql);
    } catch (error) {
      if (!(await readColumns()).rows.some((column) => column.name === definition.name)) throw error;
    }
  }
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
      await ensureCompatibilityColumns(db, "automation_strategies", [
        { name: "version", sql: `ALTER TABLE automation_strategies ADD COLUMN version INTEGER NOT NULL DEFAULT 1` },
        { name: "commit_token", sql: `ALTER TABLE automation_strategies ADD COLUMN commit_token TEXT` },
      ]);
      await ensureCompatibilityColumns(db, "live_risk_policies", [
        { name: "version", sql: `ALTER TABLE live_risk_policies ADD COLUMN version INTEGER NOT NULL DEFAULT 1` },
        { name: "commit_token", sql: `ALTER TABLE live_risk_policies ADD COLUMN commit_token TEXT` },
      ]);
      await ensureCompatibilityColumns(db, "live_orders", [
        { name: "risk_notional", sql: `ALTER TABLE live_orders ADD COLUMN risk_notional INTEGER NOT NULL DEFAULT 0` },
      ]);
      await db.query(`INSERT INTO audit_chain_heads (user_id, entry_hash, updated_at) SELECT leaf.user_id, leaf.entry_hash, leaf.created_at FROM audit_chain leaf WHERE NOT EXISTS (SELECT 1 FROM audit_chain child WHERE child.user_id=leaf.user_id AND child.previous_hash=leaf.entry_hash) AND (SELECT COUNT(*) FROM audit_chain candidate WHERE candidate.user_id=leaf.user_id AND NOT EXISTS (SELECT 1 FROM audit_chain child_of_candidate WHERE child_of_candidate.user_id=candidate.user_id AND child_of_candidate.previous_hash=candidate.entry_hash))=1 ON CONFLICT(user_id) DO NOTHING`);
      const forkedAuditUser = (await db.query<{ userId: string }>(`SELECT candidate.user_id AS "userId" FROM audit_chain candidate WHERE NOT EXISTS (SELECT 1 FROM audit_chain child WHERE child.user_id=candidate.user_id AND child.previous_hash=candidate.entry_hash) GROUP BY candidate.user_id HAVING COUNT(*)>1 LIMIT 1`)).rows[0];
      if (forkedAuditUser) throw new Error("audit chain has multiple leaves; database writes are disabled until integrity is restored");
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
  if (!(await ensureAuditHead(db, user.userId))) throw new Error("audit chain has multiple leaves; writes are disabled until integrity is restored");
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

type ReplaceRiskOrder = Pick<Order, "side" | "symbol" | "price" | "quantity" | "remaining">;

export function paperReplaceRiskReason(account: PaperAccountView, current: ReplaceRiskOrder, desiredQuantity: number, replacementPrice: number | null) {
  const filledQuantity = current.quantity - current.remaining;
  if (!Number.isSafeInteger(desiredQuantity) || desiredQuantity <= filledQuantity) return "교체 주문 총수량은 이미 체결된 수량보다 커야 합니다";
  const replacementQuantity = desiredQuantity - filledQuantity;

  if (current.side === "BUY") {
    if (!Number.isSafeInteger(replacementPrice) || (replacementPrice ?? 0) <= 0) return "교체 주문의 위험 계산 가격을 확인할 수 없습니다";
    const oldReservation = current.price == null ? 0 : current.price * current.remaining;
    const replacementNotional = (replacementPrice as number) * replacementQuantity;
    const cashAfterOldReservationRelease = account.availableCash + oldReservation;
    if (!Number.isSafeInteger(oldReservation) || !Number.isSafeInteger(replacementNotional) || replacementNotional > cashAfterOldReservationRelease) return "모의 예수금이 부족합니다";
  } else {
    const position = account.positions.find((item) => item.symbol === current.symbol);
    const quantityAfterOldReservationRelease = (position?.availableQuantity ?? 0) + current.remaining;
    if (replacementQuantity > quantityAfterOldReservationRelease) return "매도 가능 수량이 부족합니다";
  }
  return null;
}

export async function preTradeReplaceRiskCheck(userId: string, current: ReplaceRiskOrder, desiredQuantity: number, replacementPrice: number | null) {
  return paperReplaceRiskReason(await getPaperAccount(userId), current, desiredQuantity, replacementPrice);
}

export async function savePaperOrder(userId: string, order: Order) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const saved = await db.query(`INSERT INTO paper_orders (id, user_id, participant_id, symbol, side, order_type, time_in_force, price, stop_price, quantity, remaining, status, sequence, accepted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET remaining=excluded.remaining, status=excluded.status, sequence=excluded.sequence, updated_at=excluded.updated_at WHERE paper_orders.user_id=excluded.user_id AND paper_orders.participant_id=excluded.participant_id`, [order.id, userId, order.participantId, order.symbol, order.side, order.type, order.timeInForce, order.price, order.stopPrice ?? null, order.quantity, order.remaining, order.status, order.sequence, order.acceptedAt, order.lastUpdatedAt]);
  if (saved.changes === 0) {
    const owner = await ownerForOrder(order.id);
    if (owner && owner.userId !== userId) throw new Error("paper order ownership conflict");
  }
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

async function getAuditHeadRecord(db: DatabaseAdapter, userId: string) {
  return (await db.query<{ entryHash: string; versionToken: string }>(`SELECT entry_hash AS "entryHash", updated_at AS "versionToken" FROM audit_chain_heads WHERE user_id=?`, [userId])).rows[0] ?? null;
}

async function ensureAuditHead(db: DatabaseAdapter, userId: string) {
  const existing = await getAuditHeadRecord(db, userId);
  if (existing) return existing;
  const leaves = await db.query<{ entryHash: string }>(`SELECT candidate.entry_hash AS "entryHash" FROM audit_chain candidate WHERE candidate.user_id=? AND NOT EXISTS (SELECT 1 FROM audit_chain child WHERE child.user_id=candidate.user_id AND child.previous_hash=candidate.entry_hash) LIMIT 2`, [userId]);
  if (leaves.rows.length > 1) return null;
  const entryHash = leaves.rows[0]?.entryHash ?? "GENESIS";
  await db.query(`INSERT INTO audit_chain_heads (user_id, entry_hash, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING`, [userId, entryHash, crypto.randomUUID()]);
  return getAuditHeadRecord(db, userId);
}

export async function addAudit(userId: string, action: string, entityId: string | null, payload: unknown) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const payloadJson = JSON.stringify(payload);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const head = await ensureAuditHead(db, userId);
    if (!head) throw new Error("audit chain has multiple leaves");
    const createdAt = new Date().toISOString();
    const previousHash = head.entryHash;
    const commitToken = crypto.randomUUID();
    const entryHash = await computeAuditEntryHash(previousHash, userId, action, entityId, payloadJson, createdAt);
    const id = `AUD-${Date.now()}-${crypto.randomUUID()}`;
    await db.batch([
      { sql: `UPDATE audit_chain_heads SET entry_hash=?, updated_at=? WHERE user_id=? AND entry_hash=? AND updated_at=?`, params: [entryHash, commitToken, userId, previousHash, head.versionToken] },
      { sql: `INSERT INTO audit_log (user_id, action, entity_id, payload_json, created_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM audit_chain_heads WHERE user_id=? AND entry_hash=? AND updated_at=?)`, params: [userId, action, entityId, payloadJson, createdAt, userId, entryHash, commitToken] },
      { sql: `INSERT INTO audit_chain (id, user_id, action, entity_id, payload_json, previous_hash, entry_hash, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM audit_chain_heads WHERE user_id=? AND entry_hash=? AND updated_at=?)`, params: [id, userId, action, entityId, payloadJson, previousHash, entryHash, createdAt, userId, entryHash, commitToken] },
    ]);
    if ((await db.query<{ id: string }>(`SELECT id FROM audit_chain WHERE id=?`, [id])).rows[0]) return;
    if (attempt === 2) throw new Error("audit chain head changed repeatedly");
  }
}

export type LiveRiskPolicyMutation = {
  liveEnabled: boolean;
  automationEnabled: boolean;
  killSwitch: boolean;
  maxOrderQuantity: number;
  maxOrderNotional: number;
  maxDailyNotional: number;
  maxOpenOrders: number;
  allowedSymbols: string[];
  acknowledgedAt: string | null;
};

export async function commitLiveRiskPolicyChange(input: { userId: string; expectedVersion: number; policy: LiveRiskPolicyMutation; auditPayload: Record<string, unknown> }) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const action = "LIVE_RISK_POLICY_UPDATED";
  const payloadJson = JSON.stringify({ ...input.auditPayload, policyVersion: input.expectedVersion + 1 });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const head = await ensureAuditHead(db, input.userId);
    if (!head) throw new Error("audit chain has multiple leaves");
    const changedAt = new Date().toISOString();
    const commitToken = crypto.randomUUID();
    const entryHash = await computeAuditEntryHash(head.entryHash, input.userId, action, null, payloadJson, changedAt);
    const auditId = `AUD-${Date.now()}-${crypto.randomUUID()}`;
    try {
      await db.batch([
        { sql: `UPDATE live_risk_policies SET live_enabled=?, automation_enabled=?, kill_switch=?, max_order_quantity=?, max_order_notional=?, max_daily_notional=?, max_open_orders=?, allowed_symbols_json=?, acknowledged_at=?, updated_at=?, version=version+1, commit_token=? WHERE user_id=? AND version=? AND EXISTS (SELECT 1 FROM audit_chain_heads WHERE user_id=? AND entry_hash=? AND updated_at=?)`, params: [input.policy.liveEnabled ? 1 : 0, input.policy.automationEnabled ? 1 : 0, input.policy.killSwitch ? 1 : 0, input.policy.maxOrderQuantity, input.policy.maxOrderNotional, input.policy.maxDailyNotional, input.policy.maxOpenOrders, JSON.stringify(input.policy.allowedSymbols), input.policy.acknowledgedAt, changedAt, commitToken, input.userId, input.expectedVersion, input.userId, head.entryHash, head.versionToken] },
        { sql: `UPDATE audit_chain_heads SET entry_hash=?, updated_at=? WHERE user_id=? AND entry_hash=? AND updated_at=? AND EXISTS (SELECT 1 FROM live_risk_policies WHERE user_id=? AND version=? AND commit_token=?)`, params: [entryHash, commitToken, input.userId, head.entryHash, head.versionToken, input.userId, input.expectedVersion + 1, commitToken] },
        { sql: `INSERT INTO audit_log (user_id, action, entity_id, payload_json, created_at) SELECT ?, ?, NULL, ?, ? WHERE EXISTS (SELECT 1 FROM audit_chain_heads WHERE user_id=? AND entry_hash=? AND updated_at=?) AND EXISTS (SELECT 1 FROM live_risk_policies WHERE user_id=? AND version=? AND commit_token=?)`, params: [input.userId, action, payloadJson, changedAt, input.userId, entryHash, commitToken, input.userId, input.expectedVersion + 1, commitToken] },
        // A failed version/head CAS makes user_id NULL and rolls back the whole batch.
        { sql: `INSERT INTO audit_chain (id, user_id, action, entity_id, payload_json, previous_hash, entry_hash, created_at) VALUES (?, (SELECT ? WHERE EXISTS (SELECT 1 FROM audit_chain_heads WHERE user_id=? AND entry_hash=? AND updated_at=?) AND EXISTS (SELECT 1 FROM live_risk_policies WHERE user_id=? AND version=? AND commit_token=?)), ?, NULL, ?, ?, ?, ?)`, params: [auditId, input.userId, input.userId, entryHash, commitToken, input.userId, input.expectedVersion + 1, commitToken, action, payloadJson, head.entryHash, entryHash, changedAt] },
      ]);
    } catch {
      const current = (await db.query<{ version: number }>(`SELECT version FROM live_risk_policies WHERE user_id=?`, [input.userId])).rows[0];
      if (!current || Number(current.version) !== input.expectedVersion) return { committed: false as const, reason: "conflict" as const };
      if (attempt === 2) return { committed: false as const, reason: "contention" as const };
      continue;
    }
    const current = (await db.query<{ version: number; commitToken: string | null }>(`SELECT version, commit_token AS "commitToken" FROM live_risk_policies WHERE user_id=?`, [input.userId])).rows[0];
    const auditCommitted = Boolean((await db.query<{ id: string }>(`SELECT id FROM audit_chain WHERE id=?`, [auditId])).rows[0]);
    if (auditCommitted && Number(current?.version) === input.expectedVersion + 1 && current?.commitToken === commitToken) return { committed: true as const, reason: null };
  }
  return { committed: false as const, reason: "contention" as const };
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
  const rows = await db.query<{ id: string; action: string; entityId: string | null; payloadJson: string; previousHash: string; entryHash: string; createdAt: string }>(`SELECT id, action, entity_id AS "entityId", payload_json AS "payloadJson", previous_hash AS "previousHash", entry_hash AS "entryHash", created_at AS "createdAt" FROM audit_chain WHERE user_id=? ORDER BY created_at ASC, id ASC LIMIT 2001`, [userId]);
  const truncated = rows.rows.length > 2000;
  const sample = rows.rows.slice(0, 2000);
  const childByPrevious = new Map<string, (typeof sample)[number]>();
  for (const row of sample) {
    if (childByPrevious.has(row.previousHash)) return { ok: false, complete: !truncated, checked: sample.length, failedAt: row.id };
    childByPrevious.set(row.previousHash, row);
  }
  let previousHash = "GENESIS";
  const visited = new Set<string>();
  while (childByPrevious.has(previousHash)) {
    const row = childByPrevious.get(previousHash)!;
    if (visited.has(row.id)) return { ok: false, complete: !truncated, checked: sample.length, failedAt: row.id };
    const expected = await computeAuditEntryHash(previousHash, userId, row.action, row.entityId, row.payloadJson, row.createdAt);
    if (row.entryHash !== expected) return { ok: false, complete: !truncated, checked: sample.length, failedAt: row.id };
    visited.add(row.id);
    previousHash = row.entryHash;
  }
  if (visited.size !== sample.length) return { ok: false, complete: !truncated, checked: sample.length, failedAt: "DISCONNECTED_CHAIN" };
  if (truncated) return { ok: true, complete: false, checked: sample.length, head: previousHash };
  const storedHead = await getAuditHeadRecord(db, userId);
  if (!storedHead || storedHead.entryHash !== previousHash) return { ok: false, complete: true, checked: sample.length, failedAt: "AUDIT_HEAD" };
  return { ok: true, complete: true, checked: sample.length, head: previousHash };
}

export async function getLastPaperEngineSequence() {
  await ensureTradingSchema();
  const db = await getAdapter();
  const row = (await db.query<{ sequence: number | string }>(`SELECT CASE WHEN COALESCE((SELECT last_sequence FROM engine_runtime_state WHERE venue='NEXTRADE'), 0) > COALESCE((SELECT MAX(sequence) FROM paper_orders), 0) THEN COALESCE((SELECT last_sequence FROM engine_runtime_state WHERE venue='NEXTRADE'), 0) ELSE COALESCE((SELECT MAX(sequence) FROM paper_orders), 0) END AS sequence`)).rows[0];
  return Number(row?.sequence ?? 0);
}

/** Persists the monotonic engine high-water mark, including rejected/cancel/replace events. */
export async function savePaperEngineSequence(sequence: number) {
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("engine sequence must be a non-negative safe integer");
  await ensureTradingSchema();
  const db = await getAdapter();
  const now = new Date().toISOString();
  await db.query(`INSERT INTO engine_runtime_state (venue, last_sequence, updated_at) VALUES ('NEXTRADE', ?, ?) ON CONFLICT(venue) DO UPDATE SET last_sequence=CASE WHEN engine_runtime_state.last_sequence < excluded.last_sequence THEN excluded.last_sequence ELSE engine_runtime_state.last_sequence END, updated_at=CASE WHEN engine_runtime_state.last_sequence < excluded.last_sequence THEN excluded.updated_at ELSE engine_runtime_state.updated_at END`, [sequence, now]);
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
  await db.query(`UPDATE automation_strategies SET status='paused', updated_at=?, version=version+1, commit_token=NULL WHERE user_id=? AND connection_id=? AND status IN ('armed','ready')`, [new Date().toISOString(), userId, connectionId]);
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
  status: "draft" | "ready" | "armed" | "paused" | "stopped";
  executionMode: "paper" | "sandbox" | "production";
  lastEvaluatedAt: string | null;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

function normalizeAutomationStrategyRow(row: AutomationStrategyView): AutomationStrategyView {
  return { ...row, triggerPrice: row.triggerPrice == null ? null : Number(row.triggerPrice), limitPrice: row.limitPrice == null ? null : Number(row.limitPrice), quantity: Number(row.quantity), intervalSeconds: Number(row.intervalSeconds), maxOrdersPerDay: Number(row.maxOrdersPerDay), maxDailyNotional: Number(row.maxDailyNotional), version: Number(row.version) };
}

export async function listAutomationStrategies(userId: string): Promise<AutomationStrategyView[]> {
  await ensureTradingSchema();
  const db = await getAdapter();
  const rows = await db.query<AutomationStrategyView>(`SELECT id, connection_id AS "connectionId", name, symbol, side, strategy_type AS "strategyType", trigger_operator AS "triggerOperator", trigger_price AS "triggerPrice", order_type AS "orderType", limit_price AS "limitPrice", quantity, interval_seconds AS "intervalSeconds", max_orders_per_day AS "maxOrdersPerDay", max_daily_notional AS "maxDailyNotional", status, execution_mode AS "executionMode", last_evaluated_at AS "lastEvaluatedAt", last_triggered_at AS "lastTriggeredAt", created_at AS "createdAt", updated_at AS "updatedAt", version FROM automation_strategies WHERE user_id=? ORDER BY created_at DESC LIMIT 50`, [userId]);
  return rows.rows.map(normalizeAutomationStrategyRow);
}

export type AutomationStrategyDraft = Omit<AutomationStrategyView, "lastEvaluatedAt" | "lastTriggeredAt" | "createdAt" | "updatedAt" | "version" | "status" | "executionMode">;

export async function getAutomationStrategy(userId: string, strategyId: string) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const row = (await db.query<AutomationStrategyView>(`SELECT id, connection_id AS "connectionId", name, symbol, side, strategy_type AS "strategyType", trigger_operator AS "triggerOperator", trigger_price AS "triggerPrice", order_type AS "orderType", limit_price AS "limitPrice", quantity, interval_seconds AS "intervalSeconds", max_orders_per_day AS "maxOrdersPerDay", max_daily_notional AS "maxDailyNotional", status, execution_mode AS "executionMode", last_evaluated_at AS "lastEvaluatedAt", last_triggered_at AS "lastTriggeredAt", created_at AS "createdAt", updated_at AS "updatedAt", version FROM automation_strategies WHERE user_id=? AND id=? LIMIT 1`, [userId, strategyId])).rows[0];
  return row ? normalizeAutomationStrategyRow(row) : null;
}

export async function countAutomationStrategies(userId: string) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const row = (await db.query<{ count: number }>(`SELECT COUNT(*) AS count FROM automation_strategies WHERE user_id=?`, [userId])).rows[0];
  return Number(row?.count ?? 0);
}

type AutomationStrategyCommitResult = { strategy: AutomationStrategyView | null; reason: "conflict" | "quota" | "contention" | null };

export async function commitAutomationStrategyChange(input: { userId: string; strategy: AutomationStrategyDraft; expectedVersion?: number | null; auditPayload: Record<string, unknown> }): Promise<AutomationStrategyCommitResult> {
  await ensureTradingSchema();
  const db = await getAdapter();
  const isUpdate = input.expectedVersion != null;
  const nextVersion = (input.expectedVersion ?? 0) + 1;
  const action = isUpdate ? "AUTOMATION_STRATEGY_UPDATED" : "AUTOMATION_STRATEGY_CREATED";
  const payloadJson = JSON.stringify({ ...input.auditPayload, strategyVersion: nextVersion });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const head = await ensureAuditHead(db, input.userId);
    if (!head) throw new Error("audit chain has multiple leaves");
    const previousHash = head.entryHash;
    const changedAt = new Date().toISOString();
    const commitToken = crypto.randomUUID();
    const entryHash = await computeAuditEntryHash(previousHash, input.userId, action, input.strategy.id, payloadJson, changedAt);
    const auditId = `AUD-${Date.now()}-${crypto.randomUUID()}`;
    const mutation = isUpdate
      ? { sql: `UPDATE automation_strategies SET connection_id=?, name=?, symbol=?, side=?, strategy_type=?, trigger_operator=?, trigger_price=?, order_type=?, limit_price=?, quantity=?, interval_seconds=?, max_orders_per_day=?, max_daily_notional=?, status='draft', execution_mode='paper', last_evaluated_at=NULL, last_triggered_at=NULL, updated_at=?, version=version+1, commit_token=? WHERE id=? AND user_id=? AND version=? AND EXISTS (SELECT 1 FROM audit_chain_heads WHERE user_id=? AND entry_hash=? AND updated_at=?)`, params: [input.strategy.connectionId, input.strategy.name, input.strategy.symbol, input.strategy.side, input.strategy.strategyType, input.strategy.triggerOperator, input.strategy.triggerPrice, input.strategy.orderType, input.strategy.limitPrice, input.strategy.quantity, input.strategy.intervalSeconds, input.strategy.maxOrdersPerDay, input.strategy.maxDailyNotional, changedAt, commitToken, input.strategy.id, input.userId, input.expectedVersion, input.userId, previousHash, head.versionToken] }
      : { sql: `INSERT INTO automation_strategies (id, user_id, connection_id, name, symbol, side, strategy_type, trigger_operator, trigger_price, order_type, limit_price, quantity, interval_seconds, max_orders_per_day, max_daily_notional, status, execution_mode, created_at, updated_at, version, commit_token) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'paper', ?, ?, 1, ? WHERE EXISTS (SELECT 1 FROM audit_chain_heads WHERE user_id=? AND entry_hash=? AND updated_at=?) AND (SELECT COUNT(*) FROM automation_strategies WHERE user_id=?) < 50 ON CONFLICT(id) DO NOTHING`, params: [input.strategy.id, input.userId, input.strategy.connectionId, input.strategy.name, input.strategy.symbol, input.strategy.side, input.strategy.strategyType, input.strategy.triggerOperator, input.strategy.triggerPrice, input.strategy.orderType, input.strategy.limitPrice, input.strategy.quantity, input.strategy.intervalSeconds, input.strategy.maxOrdersPerDay, input.strategy.maxDailyNotional, changedAt, changedAt, commitToken, input.userId, previousHash, head.versionToken, input.userId] };
    try {
      await db.batch([
        mutation,
        { sql: `UPDATE audit_chain_heads SET entry_hash=?, updated_at=? WHERE user_id=? AND entry_hash=? AND updated_at=? AND EXISTS (SELECT 1 FROM automation_strategies WHERE id=? AND user_id=? AND version=? AND commit_token=?)`, params: [entryHash, commitToken, input.userId, previousHash, head.versionToken, input.strategy.id, input.userId, nextVersion, commitToken] },
        { sql: `INSERT INTO audit_log (user_id, action, entity_id, payload_json, created_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM audit_chain_heads WHERE user_id=? AND entry_hash=? AND updated_at=?) AND EXISTS (SELECT 1 FROM automation_strategies WHERE id=? AND user_id=? AND version=? AND commit_token=?)`, params: [input.userId, action, input.strategy.id, payloadJson, changedAt, input.userId, entryHash, commitToken, input.strategy.id, input.userId, nextVersion, commitToken] },
        // A lost CAS makes the scalar subquery NULL. audit_chain.user_id is NOT NULL,
        // so both PostgreSQL and D1 roll the entire batch back, including mutation.
        { sql: `INSERT INTO audit_chain (id, user_id, action, entity_id, payload_json, previous_hash, entry_hash, created_at) VALUES (?, (SELECT ? WHERE EXISTS (SELECT 1 FROM audit_chain_heads WHERE user_id=? AND entry_hash=? AND updated_at=?) AND EXISTS (SELECT 1 FROM automation_strategies WHERE id=? AND user_id=? AND version=? AND commit_token=?)), ?, ?, ?, ?, ?, ?)`, params: [auditId, input.userId, input.userId, entryHash, commitToken, input.strategy.id, input.userId, nextVersion, commitToken, action, input.strategy.id, payloadJson, previousHash, entryHash, changedAt] },
      ]);
    } catch (error) {
      const strategy = await getAutomationStrategy(input.userId, input.strategy.id);
      if (isUpdate && (!strategy || strategy.version !== input.expectedVersion)) return { strategy: null, reason: "conflict" };
      if (!isUpdate && strategy) return { strategy: null, reason: "conflict" };
      if (!isUpdate && await countAutomationStrategies(input.userId) >= 50) return { strategy: null, reason: "quota" };
      if (attempt === 2) throw error;
      continue;
    }
    const strategy = await getAutomationStrategy(input.userId, input.strategy.id);
    const auditCommitted = Boolean((await db.query<{ id: string }>(`SELECT id FROM audit_chain WHERE id=?`, [auditId])).rows[0]);
    if (auditCommitted && strategy?.version === nextVersion) return { strategy, reason: null };
    if (isUpdate && (!strategy || strategy.version !== input.expectedVersion)) return { strategy: null, reason: "conflict" };
    if (!isUpdate && strategy) return { strategy: null, reason: "conflict" };
    if (!isUpdate && await countAutomationStrategies(input.userId) >= 50) return { strategy: null, reason: "quota" };
  }
  return { strategy: null, reason: "contention" };
}

export async function commitAutomationStrategyStatus(input: { userId: string; strategyId: string; status: AutomationStrategyView["status"]; expectedVersion: number; auditPayload: Record<string, unknown> }): Promise<AutomationStrategyCommitResult> {
  await ensureTradingSchema();
  const db = await getAdapter();
  const action = "AUTOMATION_STRATEGY_STATUS_CHANGED";
  const nextVersion = input.expectedVersion + 1;
  const payloadJson = JSON.stringify({ ...input.auditPayload, strategyVersion: nextVersion });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const head = await ensureAuditHead(db, input.userId);
    if (!head) throw new Error("audit chain has multiple leaves");
    const previousHash = head.entryHash;
    const changedAt = new Date().toISOString();
    const commitToken = crypto.randomUUID();
    const entryHash = await computeAuditEntryHash(previousHash, input.userId, action, input.strategyId, payloadJson, changedAt);
    const auditId = `AUD-${Date.now()}-${crypto.randomUUID()}`;
    try {
      await db.batch([
        { sql: `UPDATE automation_strategies SET status=?, updated_at=?, version=version+1, commit_token=? WHERE id=? AND user_id=? AND version=? AND EXISTS (SELECT 1 FROM audit_chain_heads WHERE user_id=? AND entry_hash=? AND updated_at=?)`, params: [input.status, changedAt, commitToken, input.strategyId, input.userId, input.expectedVersion, input.userId, previousHash, head.versionToken] },
        { sql: `UPDATE audit_chain_heads SET entry_hash=?, updated_at=? WHERE user_id=? AND entry_hash=? AND updated_at=? AND EXISTS (SELECT 1 FROM automation_strategies WHERE id=? AND user_id=? AND version=? AND commit_token=?)`, params: [entryHash, commitToken, input.userId, previousHash, head.versionToken, input.strategyId, input.userId, nextVersion, commitToken] },
        { sql: `INSERT INTO audit_log (user_id, action, entity_id, payload_json, created_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM audit_chain_heads WHERE user_id=? AND entry_hash=? AND updated_at=?) AND EXISTS (SELECT 1 FROM automation_strategies WHERE id=? AND user_id=? AND version=? AND commit_token=?)`, params: [input.userId, action, input.strategyId, payloadJson, changedAt, input.userId, entryHash, commitToken, input.strategyId, input.userId, nextVersion, commitToken] },
        // See commitAutomationStrategyChange: this NOT NULL guard is the rollback trigger.
        { sql: `INSERT INTO audit_chain (id, user_id, action, entity_id, payload_json, previous_hash, entry_hash, created_at) VALUES (?, (SELECT ? WHERE EXISTS (SELECT 1 FROM audit_chain_heads WHERE user_id=? AND entry_hash=? AND updated_at=?) AND EXISTS (SELECT 1 FROM automation_strategies WHERE id=? AND user_id=? AND version=? AND commit_token=?)), ?, ?, ?, ?, ?, ?)`, params: [auditId, input.userId, input.userId, entryHash, commitToken, input.strategyId, input.userId, nextVersion, commitToken, action, input.strategyId, payloadJson, previousHash, entryHash, changedAt] },
      ]);
    } catch (error) {
      const strategy = await getAutomationStrategy(input.userId, input.strategyId);
      if (!strategy || strategy.version !== input.expectedVersion) return { strategy: null, reason: "conflict" };
      if (attempt === 2) throw error;
      continue;
    }
    const strategy = await getAutomationStrategy(input.userId, input.strategyId);
    const auditCommitted = Boolean((await db.query<{ id: string }>(`SELECT id FROM audit_chain WHERE id=?`, [auditId])).rows[0]);
    if (auditCommitted && strategy?.version === nextVersion) return { strategy, reason: null };
    if (!strategy || strategy.version !== input.expectedVersion) return { strategy: null, reason: "conflict" };
  }
  return { strategy: null, reason: "contention" };
}

export async function getAutomationRunUsage(userId: string, strategyId: string, since: string) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const rows = await db.query<{ detailJson: string }>(`SELECT detail_json AS "detailJson" FROM automation_runs WHERE user_id=? AND strategy_id=? AND created_at>=? AND status='ORDER_SUBMITTED'`, [userId, strategyId, since]);
  return { orders: rows.rows.length, notional: rows.rows.reduce((sum, row) => { try { return sum + Number((JSON.parse(row.detailJson) as { notional?: number }).notional ?? 0); } catch { return sum; } }, 0) };
}

export type AutomationRunView = {
  id: string;
  strategyId: string;
  status: string;
  observedPrice: number | null;
  orderId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
};

export async function listAutomationRuns(userId: string, strategyId?: string | null, limit = 100): Promise<AutomationRunView[]> {
  await ensureTradingSchema();
  const db = await getAdapter();
  const safeLimit = Math.max(1, Math.min(250, Math.trunc(limit)));
  const filter = strategyId ? " AND strategy_id=?" : "";
  const rows = await db.query<{ id: string; strategyId: string; status: string; observedPrice: number | null; orderId: string | null; detailJson: string; createdAt: string }>(`SELECT id, strategy_id AS "strategyId", status, observed_price AS "observedPrice", order_id AS "orderId", detail_json AS "detailJson", created_at AS "createdAt" FROM automation_runs WHERE user_id=?${filter} ORDER BY created_at DESC LIMIT ${safeLimit}`, strategyId ? [userId, strategyId] : [userId]);
  return rows.rows.map((row) => {
    let detail: Record<string, unknown> = {};
    try { detail = JSON.parse(row.detailJson) as Record<string, unknown>; } catch { detail = { parseError: true }; }
    return { id: row.id, strategyId: row.strategyId, status: row.status, observedPrice: row.observedPrice == null ? null : Number(row.observedPrice), orderId: row.orderId, detail, createdAt: row.createdAt };
  });
}

export async function countAutomationRuns(userId: string) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const row = (await db.query<{ count: number }>(`SELECT COUNT(*) AS count FROM automation_runs WHERE user_id=?`, [userId])).rows[0];
  return Number(row?.count ?? 0);
}

export async function getAutomationRunStats(userId: string, strategyId: string, strategyFingerprint: string) {
  await ensureTradingSchema();
  const db = await getAdapter();
  let row = (await db.query<{ validationCount: number; triggerCount: number; waitingCount: number }>(`SELECT validation_count AS "validationCount", trigger_count AS "triggerCount", waiting_count AS "waitingCount" FROM automation_validation_progress WHERE user_id=? AND strategy_id=? AND strategy_fingerprint=?`, [userId, strategyId, strategyFingerprint])).rows[0];
  if (!row) {
    const fingerprintPattern = `%"strategyFingerprint":"${strategyFingerprint}"%`;
    await db.query(`INSERT INTO automation_validation_progress (user_id, strategy_id, strategy_fingerprint, validation_count, trigger_count, waiting_count, updated_at) SELECT ?, ?, ?, COUNT(*), COALESCE(SUM(CASE WHEN status='WOULD_SUBMIT' THEN 1 ELSE 0 END), 0), COALESCE(SUM(CASE WHEN status='CONDITION_WAITING' THEN 1 ELSE 0 END), 0), ? FROM automation_runs WHERE user_id=? AND strategy_id=? AND detail_json LIKE ? ON CONFLICT(user_id, strategy_id, strategy_fingerprint) DO NOTHING`, [userId, strategyId, strategyFingerprint, new Date().toISOString(), userId, strategyId, fingerprintPattern]);
    row = (await db.query<{ validationCount: number; triggerCount: number; waitingCount: number }>(`SELECT validation_count AS "validationCount", trigger_count AS "triggerCount", waiting_count AS "waitingCount" FROM automation_validation_progress WHERE user_id=? AND strategy_id=? AND strategy_fingerprint=?`, [userId, strategyId, strategyFingerprint])).rows[0];
  }
  return { validationCount: Number(row?.validationCount ?? 0), triggerCount: Number(row?.triggerCount ?? 0), waitingCount: Number(row?.waitingCount ?? 0) };
}

export async function listAutomationRunStats(userId: string) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const rows = await db.query<{ strategyId: string; strategyFingerprint: string; validationCount: number; triggerCount: number; waitingCount: number }>(`SELECT strategy_id AS "strategyId", strategy_fingerprint AS "strategyFingerprint", validation_count AS "validationCount", trigger_count AS "triggerCount", waiting_count AS "waitingCount" FROM automation_validation_progress WHERE user_id=?`, [userId]);
  return rows.rows.map((row) => ({ strategyId: row.strategyId, strategyFingerprint: row.strategyFingerprint, validationCount: Number(row.validationCount), triggerCount: Number(row.triggerCount), waitingCount: Number(row.waitingCount) }));
}

export async function commitAutomationEvaluation(input: {
  userId: string;
  strategyId: string;
  idempotencyKey: string;
  requestHash: string;
  statusCode: number;
  response: unknown;
  run: AutomationRunView & { triggered: boolean };
  auditPayload: Record<string, unknown>;
}) {
  await ensureTradingSchema();
  const db = await getAdapter();
  const responseJson = JSON.stringify(input.response);
  const detailJson = JSON.stringify(input.run.detail);
  const auditPayloadJson = JSON.stringify(input.auditPayload);
  const strategyFingerprint = typeof input.run.detail.strategyFingerprint === "string" ? input.run.detail.strategyFingerprint : "";
  if (!/^[a-f0-9]{64}$/.test(strategyFingerprint)) throw new Error("automation evaluation requires a valid strategy fingerprint");
  await getAutomationRunStats(input.userId, input.strategyId, strategyFingerprint);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const head = await ensureAuditHead(db, input.userId);
    if (!head) throw new Error("audit chain has multiple leaves");
    const auditCreatedAt = new Date().toISOString();
    const previousHash = head.entryHash;
    const commitToken = crypto.randomUUID();
    const entryHash = await computeAuditEntryHash(previousHash, input.userId, "AUTOMATION_SCENARIO_EVALUATED", input.strategyId, auditPayloadJson, auditCreatedAt);
    const auditId = `AUD-${Date.now()}-${crypto.randomUUID()}`;
    try {
      await db.batch([
        { sql: `UPDATE audit_chain_heads SET entry_hash=?, updated_at=? WHERE user_id=? AND entry_hash=? AND updated_at=?`, params: [entryHash, commitToken, input.userId, previousHash, head.versionToken] },
        { sql: `INSERT INTO order_idempotency (user_id, idempotency_key, request_hash, status_code, response_json, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM audit_chain_heads WHERE user_id=? AND entry_hash=? AND updated_at=?)`, params: [input.userId, input.idempotencyKey, input.requestHash, input.statusCode, responseJson, input.run.createdAt, input.userId, entryHash, commitToken] },
        { sql: `INSERT INTO automation_runs (id, strategy_id, user_id, status, observed_price, order_id, detail_json, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM audit_chain_heads WHERE user_id=? AND entry_hash=? AND updated_at=?)`, params: [input.run.id, input.strategyId, input.userId, input.run.status, input.run.observedPrice, input.run.orderId, detailJson, input.run.createdAt, input.userId, entryHash, commitToken] },
        { sql: `UPDATE automation_strategies SET last_evaluated_at=?, last_triggered_at=CASE WHEN ? THEN ? ELSE last_triggered_at END WHERE id=? AND user_id=? AND EXISTS (SELECT 1 FROM audit_chain_heads WHERE user_id=? AND entry_hash=? AND updated_at=?)`, params: [input.run.createdAt, input.run.triggered ? 1 : 0, input.run.createdAt, input.strategyId, input.userId, input.userId, entryHash, commitToken] },
        { sql: `INSERT INTO automation_validation_progress (user_id, strategy_id, strategy_fingerprint, validation_count, trigger_count, waiting_count, updated_at) SELECT ?, ?, ?, 1, ?, ?, ? WHERE EXISTS (SELECT 1 FROM audit_chain_heads WHERE user_id=? AND entry_hash=? AND updated_at=?) ON CONFLICT(user_id, strategy_id, strategy_fingerprint) DO UPDATE SET validation_count=automation_validation_progress.validation_count+1, trigger_count=automation_validation_progress.trigger_count+excluded.trigger_count, waiting_count=automation_validation_progress.waiting_count+excluded.waiting_count, updated_at=excluded.updated_at`, params: [input.userId, input.strategyId, strategyFingerprint, input.run.status === "WOULD_SUBMIT" ? 1 : 0, input.run.status === "CONDITION_WAITING" ? 1 : 0, input.run.createdAt, input.userId, entryHash, commitToken] },
        { sql: `INSERT INTO audit_log (user_id, action, entity_id, payload_json, created_at) SELECT ?, 'AUTOMATION_SCENARIO_EVALUATED', ?, ?, ? WHERE EXISTS (SELECT 1 FROM audit_chain_heads WHERE user_id=? AND entry_hash=? AND updated_at=?)`, params: [input.userId, input.strategyId, auditPayloadJson, auditCreatedAt, input.userId, entryHash, commitToken] },
        { sql: `INSERT INTO audit_chain (id, user_id, action, entity_id, payload_json, previous_hash, entry_hash, created_at) SELECT ?, ?, 'AUTOMATION_SCENARIO_EVALUATED', ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM audit_chain_heads WHERE user_id=? AND entry_hash=? AND updated_at=?)`, params: [auditId, input.userId, input.strategyId, auditPayloadJson, previousHash, entryHash, auditCreatedAt, input.userId, entryHash, commitToken] },
      ]);
      const stored = (await db.query<{ requestHash: string; statusCode: number; responseJson: string }>(`SELECT request_hash AS "requestHash", status_code AS "statusCode", response_json AS "responseJson" FROM order_idempotency WHERE user_id=? AND idempotency_key=?`, [input.userId, input.idempotencyKey])).rows[0] ?? null;
      if (stored) {
        const created = Boolean((await db.query<{ id: string }>(`SELECT id FROM automation_runs WHERE id=? AND user_id=?`, [input.run.id, input.userId])).rows[0]);
        return created ? { created: true as const, replay: null } : { created: false as const, replay: stored };
      }
      if (attempt === 2) throw new Error("automation audit head changed repeatedly");
    } catch (error) {
      const replay = (await db.query<{ requestHash: string; statusCode: number; responseJson: string }>(`SELECT request_hash AS "requestHash", status_code AS "statusCode", response_json AS "responseJson" FROM order_idempotency WHERE user_id=? AND idempotency_key=?`, [input.userId, input.idempotencyKey])).rows[0] ?? null;
      if (replay) return { created: false as const, replay };
      if (attempt === 2) throw error;
    }
  }
  throw new Error("automation evaluation could not be committed");
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
