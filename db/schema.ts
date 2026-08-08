import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("participant"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
});

export const paperAccounts = sqliteTable("paper_accounts", {
  userId: text("user_id").primaryKey().references(() => users.id),
  participantId: text("participant_id").notNull(),
  cashBalance: integer("cash_balance").notNull().default(100_000_000),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("idx_paper_accounts_participant_id").on(table.participantId)]);

export const paperPositions = sqliteTable("paper_positions", {
  userId: text("user_id").notNull().references(() => users.id),
  symbol: text("symbol").notNull(),
  quantity: integer("quantity").notNull().default(0),
  averagePrice: integer("average_price").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.symbol] })]);

export const paperOrders = sqliteTable("paper_orders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  participantId: text("participant_id").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  orderType: text("order_type").notNull(),
  timeInForce: text("time_in_force").notNull(),
  price: integer("price"),
  stopPrice: integer("stop_price"),
  quantity: integer("quantity").notNull(),
  remaining: integer("remaining").notNull(),
  status: text("status").notNull(),
  sequence: integer("sequence").notNull(),
  acceptedAt: text("accepted_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("idx_paper_orders_user_updated").on(table.userId, table.updatedAt),
  index("idx_paper_orders_symbol_status").on(table.symbol, table.status),
  index("idx_paper_orders_participant_status").on(table.participantId, table.status),
]);

export const paperExecutions = sqliteTable("paper_executions", {
  id: text("id").primaryKey(),
  engineExecutionId: text("engine_execution_id").notNull(),
  symbol: text("symbol").notNull(),
  price: integer("price").notNull(),
  quantity: integer("quantity").notNull(),
  buyOrderId: text("buy_order_id").notNull(),
  sellOrderId: text("sell_order_id").notNull(),
  buyUserId: text("buy_user_id").notNull(),
  sellUserId: text("sell_user_id").notNull(),
  executedAt: text("executed_at").notNull(),
}, (table) => [
  index("idx_paper_executions_buy_user_time").on(table.buyUserId, table.executedAt),
  index("idx_paper_executions_sell_user_time").on(table.sellUserId, table.executedAt),
  index("idx_paper_executions_symbol_time").on(table.symbol, table.executedAt),
]);

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  action: text("action").notNull(),
  entityId: text("entity_id"),
  payloadJson: text("payload_json").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_audit_log_user_time").on(table.userId, table.createdAt)]);

export const orderIdempotency = sqliteTable("order_idempotency", {
  userId: text("user_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  statusCode: integer("status_code").notNull(),
  responseJson: text("response_json").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.idempotencyKey] }),
  index("idx_idempotency_created_at").on(table.createdAt),
]);

export const venueControl = sqliteTable("venue_control", {
  venue: text("venue").primaryKey(),
  phase: text("phase").notNull(),
  haltMode: text("halt_mode").notNull().default("OPEN"),
  reason: text("reason"),
  version: integer("version").notNull().default(1),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const auditChain = sqliteTable("audit_chain", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  action: text("action").notNull(),
  entityId: text("entity_id"),
  payloadJson: text("payload_json").notNull(),
  previousHash: text("previous_hash").notNull(),
  entryHash: text("entry_hash").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_audit_chain_user_time").on(table.userId, table.createdAt)]);
