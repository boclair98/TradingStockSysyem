import { env } from "cloudflare:workers";
import type { ChatGPTUser } from "../app/chatgpt-auth";
import { NEXTRADE_INSTRUMENTS } from "../engine/instrumentMaster";
import type { Execution, Order } from "../engine/matchingEngine";

const OPEN_STATUSES = ["OPEN", "PARTIAL", "PENDING_TRIGGER"];
let schemaReady: Promise<void> | null = null;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'participant', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS paper_accounts (user_id TEXT PRIMARY KEY REFERENCES users(id), participant_id TEXT NOT NULL UNIQUE, cash_balance INTEGER NOT NULL DEFAULT 100000000, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS paper_positions (user_id TEXT NOT NULL REFERENCES users(id), symbol TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0, average_price INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, symbol))`,
  `CREATE TABLE IF NOT EXISTS paper_orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), participant_id TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL, order_type TEXT NOT NULL, time_in_force TEXT NOT NULL, price INTEGER, stop_price INTEGER, quantity INTEGER NOT NULL, remaining INTEGER NOT NULL, status TEXT NOT NULL, sequence INTEGER NOT NULL, accepted_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS paper_executions (id TEXT PRIMARY KEY, engine_execution_id TEXT NOT NULL, symbol TEXT NOT NULL, price INTEGER NOT NULL, quantity INTEGER NOT NULL, buy_order_id TEXT NOT NULL, sell_order_id TEXT NOT NULL, buy_user_id TEXT NOT NULL, sell_user_id TEXT NOT NULL, executed_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, action TEXT NOT NULL, entity_id TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_accounts_participant_id ON paper_accounts(participant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_paper_orders_user_updated ON paper_orders(user_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_paper_orders_symbol_status ON paper_orders(symbol, status)`,
  `CREATE INDEX IF NOT EXISTS idx_paper_orders_participant_status ON paper_orders(participant_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_paper_executions_buy_user_time ON paper_executions(buy_user_id, executed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_paper_executions_sell_user_time ON paper_executions(sell_user_id, executed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_paper_executions_symbol_time ON paper_executions(symbol, executed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_user_time ON audit_log(user_id, created_at)`,
];

export type PaperAccountView = {
  participantId: string;
  cashBalance: number;
  availableCash: number;
  positions: Array<{ symbol: string; quantity: number; availableQuantity: number; averagePrice: number }>;
};

export async function ensureTradingSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      if (!env.DB) throw new Error("D1 binding DB is unavailable");
      await env.DB.batch(schemaStatements.map((sql) => env.DB.prepare(sql)));
      await env.DB.prepare("PRAGMA optimize").run();
    })();
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
  const now = new Date().toISOString();
  const participantId = await participantIdFor(user.userId);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO users (id, email, display_name, role, status, created_at, last_seen_at) VALUES (?, ?, ?, 'participant', 'active', ?, ?) ON CONFLICT(id) DO UPDATE SET email=excluded.email, display_name=excluded.display_name, last_seen_at=excluded.last_seen_at`).bind(user.userId, user.email, user.displayName, now, now),
    env.DB.prepare(`INSERT OR IGNORE INTO paper_accounts (user_id, participant_id, cash_balance, created_at) VALUES (?, ?, 100000000, ?)`).bind(user.userId, participantId, now),
    ...NEXTRADE_INSTRUMENTS.map((instrument) => env.DB.prepare(`INSERT OR IGNORE INTO paper_positions (user_id, symbol, quantity, average_price, updated_at) VALUES (?, ?, 100, ?, ?)`).bind(user.userId, instrument.symbol, instrument.basePrice ?? 0, now)),
  ]);
  return { participantId };
}

export async function getPaperAccount(userId: string): Promise<PaperAccountView> {
  await ensureTradingSchema();
  const account = await env.DB.prepare(`SELECT participant_id AS participantId, cash_balance AS cashBalance FROM paper_accounts WHERE user_id = ?`).bind(userId).first<{ participantId: string; cashBalance: number }>();
  if (!account) throw new Error("paper account not found");
  const positions = await env.DB.prepare(`SELECT p.symbol, p.quantity, p.average_price AS averagePrice, p.quantity - COALESCE(SUM(CASE WHEN o.side='SELL' AND o.status IN ('OPEN','PARTIAL','PENDING_TRIGGER') THEN o.remaining ELSE 0 END), 0) AS availableQuantity FROM paper_positions p LEFT JOIN paper_orders o ON o.user_id=p.user_id AND o.symbol=p.symbol WHERE p.user_id=? GROUP BY p.symbol, p.quantity, p.average_price ORDER BY p.symbol`).bind(userId).all<{ symbol: string; quantity: number; averagePrice: number; availableQuantity: number }>();
  const reserved = await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN price IS NOT NULL THEN price * remaining ELSE 0 END), 0) AS amount FROM paper_orders WHERE user_id=? AND side='BUY' AND status IN ('OPEN','PARTIAL','PENDING_TRIGGER')`).bind(userId).first<{ amount: number }>();
  return { ...account, availableCash: account.cashBalance - (reserved?.amount ?? 0), positions: positions.results };
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
  await env.DB.prepare(`INSERT INTO paper_orders (id, user_id, participant_id, symbol, side, order_type, time_in_force, price, stop_price, quantity, remaining, status, sequence, accepted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET remaining=excluded.remaining, status=excluded.status, sequence=excluded.sequence, updated_at=excluded.updated_at`)
    .bind(order.id, userId, order.participantId, order.symbol, order.side, order.type, order.timeInForce, order.price, order.stopPrice ?? null, order.quantity, order.remaining, order.status, order.sequence, order.acceptedAt, order.lastUpdatedAt).run();
}

export async function ownerForOrder(orderId: string) {
  await ensureTradingSchema();
  return env.DB.prepare(`SELECT user_id AS userId FROM paper_orders WHERE id=?`).bind(orderId).first<{ userId: string }>();
}

export async function saveExecution(execution: Execution) {
  await ensureTradingSchema();
  const buyOwner = await ownerForOrder(execution.buyOrderId);
  const sellOwner = await ownerForOrder(execution.sellOrderId);
  if (!buyOwner || !sellOwner) return;
  const id = `${execution.buyOrderId}:${execution.sellOrderId}:${execution.sequence}`;
  const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO paper_executions (id, engine_execution_id, symbol, price, quantity, buy_order_id, sell_order_id, buy_user_id, sell_user_id, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, execution.id, execution.symbol, execution.price, execution.quantity, execution.buyOrderId, execution.sellOrderId, buyOwner.userId, sellOwner.userId, execution.executedAt).run();
  if ((inserted.meta.changes ?? 0) === 0) return;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE paper_accounts SET cash_balance = cash_balance - ? WHERE user_id=?`).bind(execution.price * execution.quantity, buyOwner.userId),
    env.DB.prepare(`UPDATE paper_accounts SET cash_balance = cash_balance + ? WHERE user_id=?`).bind(execution.price * execution.quantity, sellOwner.userId),
    env.DB.prepare(`INSERT INTO paper_positions (user_id, symbol, quantity, average_price, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, symbol) DO UPDATE SET quantity=quantity+excluded.quantity, average_price=CASE WHEN quantity+excluded.quantity>0 THEN CAST(((quantity*average_price)+(excluded.quantity*excluded.average_price))/(quantity+excluded.quantity) AS INTEGER) ELSE 0 END, updated_at=excluded.updated_at`).bind(buyOwner.userId, execution.symbol, execution.quantity, execution.price, now),
    env.DB.prepare(`UPDATE paper_positions SET quantity=quantity-?, updated_at=? WHERE user_id=? AND symbol=?`).bind(execution.quantity, now, sellOwner.userId, execution.symbol),
  ]);
}

export async function addAudit(userId: string, action: string, entityId: string | null, payload: unknown) {
  await ensureTradingSchema();
  await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(userId, action, entityId, JSON.stringify(payload), new Date().toISOString()).run();
}

export async function listUserTradingState(userId: string) {
  await ensureTradingSchema();
  const orders = await env.DB.prepare(`SELECT id, participant_id AS participantId, symbol, side, order_type AS type, time_in_force AS timeInForce, price, stop_price AS stopPrice, quantity, remaining, status, sequence, accepted_at AS acceptedAt, updated_at AS lastUpdatedAt FROM paper_orders WHERE user_id=? ORDER BY updated_at DESC LIMIT 100`).bind(userId).all<Order>();
  const executions = await env.DB.prepare(`SELECT id, engine_execution_id AS engineExecutionId, symbol, price, quantity, buy_order_id AS buyOrderId, sell_order_id AS sellOrderId, executed_at AS executedAt FROM paper_executions WHERE buy_user_id=? OR sell_user_id=? ORDER BY executed_at DESC LIMIT 100`).bind(userId, userId).all();
  return { orders: orders.results, executions: executions.results };
}

export async function listOpenOrdersForHydration() {
  await ensureTradingSchema();
  const rows = await env.DB.prepare(`SELECT id, participant_id AS participantId, symbol, side, order_type AS type, time_in_force AS timeInForce, price, stop_price AS stopPrice, quantity, remaining, status, accepted_at AS acceptedAt FROM paper_orders WHERE status IN ('OPEN','PARTIAL','PENDING_TRIGGER') ORDER BY accepted_at ASC`).all<Order>();
  return rows.results;
}

export { OPEN_STATUSES };
