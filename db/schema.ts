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
}, (table) => [
  index("idx_audit_chain_user_time").on(table.userId, table.createdAt),
  index("idx_audit_chain_user_previous_hash").on(table.userId, table.previousHash),
]);

export const auditChainHeads = sqliteTable("audit_chain_heads", {
  userId: text("user_id").primaryKey(),
  entryHash: text("entry_hash").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const engineRuntimeState = sqliteTable("engine_runtime_state", {
  venue: text("venue").primaryKey(),
  lastSequence: integer("last_sequence").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export const paperSimulationAccounts = sqliteTable("paper_simulation_accounts", {
  userId: text("user_id").primaryKey().references(() => users.id),
  stateJson: text("state_json").notNull(),
  version: integer("version").notNull().default(1),
  commitToken: text("commit_token").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const paperSimulationCommands = sqliteTable("paper_simulation_commands", {
  userId: text("user_id").notNull().references(() => users.id),
  commandId: text("command_id").notNull(),
  requestHash: text("request_hash").notNull(),
  responseJson: text("response_json").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.commandId] }), index("idx_paper_simulation_commands_time").on(table.userId, table.createdAt)]);

export const brokerConnections = sqliteTable("broker_connections", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  provider: text("provider").notNull(),
  mode: text("mode").notNull().default("sandbox"),
  accountLabel: text("account_label").notNull(),
  accountRef: text("account_ref").notNull(),
  credentialCiphertext: text("credential_ciphertext"),
  status: text("status").notNull().default("pending"),
  lastCheckedAt: text("last_checked_at"),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_broker_connections_user_provider_account").on(table.userId, table.provider, table.accountRef),
  index("idx_broker_connections_user_status").on(table.userId, table.status),
]);

export const automationStrategies = sqliteTable("automation_strategies", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  connectionId: text("connection_id"),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  strategyType: text("strategy_type").notNull(),
  triggerOperator: text("trigger_operator").notNull(),
  triggerPrice: integer("trigger_price"),
  orderType: text("order_type").notNull(),
  limitPrice: integer("limit_price"),
  quantity: integer("quantity").notNull(),
  intervalSeconds: integer("interval_seconds").notNull().default(60),
  maxOrdersPerDay: integer("max_orders_per_day").notNull().default(1),
  maxDailyNotional: integer("max_daily_notional").notNull().default(1000000),
  status: text("status").notNull().default("draft"),
  executionMode: text("execution_mode").notNull().default("paper"),
  lastEvaluatedAt: text("last_evaluated_at"),
  lastTriggeredAt: text("last_triggered_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  version: integer("version").notNull().default(1),
  commitToken: text("commit_token"),
}, (table) => [
  index("idx_automation_strategies_user_status").on(table.userId, table.status),
  index("idx_automation_strategies_due").on(table.status, table.lastEvaluatedAt),
]);

export const automationRuns = sqliteTable("automation_runs", {
  id: text("id").primaryKey(),
  strategyId: text("strategy_id").notNull(),
  userId: text("user_id").notNull(),
  status: text("status").notNull(),
  observedPrice: integer("observed_price"),
  orderId: text("order_id"),
  detailJson: text("detail_json").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("idx_automation_runs_strategy_time").on(table.strategyId, table.createdAt),
  index("idx_automation_runs_user_time").on(table.userId, table.createdAt),
]);

export const automationValidationProgress = sqliteTable("automation_validation_progress", {
  userId: text("user_id").notNull(),
  strategyId: text("strategy_id").notNull(),
  strategyFingerprint: text("strategy_fingerprint").notNull(),
  validationCount: integer("validation_count").notNull().default(0),
  triggerCount: integer("trigger_count").notNull().default(0),
  waitingCount: integer("waiting_count").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.strategyId, table.strategyFingerprint] }),
  index("idx_automation_progress_user_strategy").on(table.userId, table.strategyId),
]);

export const brokerRateWindows = sqliteTable("broker_rate_windows", {
  provider: text("provider").notNull(),
  connectionId: text("connection_id").notNull(),
  rateGroup: text("rate_group").notNull(),
  windowStartedAt: integer("window_started_at").notNull(),
  requestCount: integer("request_count").notNull().default(0),
}, (table) => [primaryKey({ columns: [table.provider, table.connectionId, table.rateGroup] })]);

export const memberGatewaySessions = sqliteTable("member_gateway_sessions", {
  sessionId: text("session_id").primaryKey(),
  memberId: text("member_id").notNull(),
  protocol: text("protocol").notNull().default("NATIVE_JSON_1"),
  status: text("status").notNull().default("ACTIVE"),
  expectedInboundSequence: integer("expected_inbound_sequence").notNull().default(1),
  outboundSequence: integer("outbound_sequence").notNull().default(1),
  remoteAddress: text("remote_address"),
  connectedAt: text("connected_at").notNull(),
  lastHeartbeatAt: text("last_heartbeat_at").notNull(),
}, (table) => [index("idx_gateway_sessions_member_status").on(table.memberId, table.status)]);

export const gatewayMessages = sqliteTable("gateway_messages", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull(),
  sessionId: text("session_id").notNull(),
  direction: text("direction").notNull(),
  messageType: text("message_type").notNull(),
  sessionSequence: integer("session_sequence").notNull(),
  marketSequence: integer("market_sequence"),
  clientOrderId: text("client_order_id"),
  venueOrderId: text("venue_order_id"),
  status: text("status").notNull(),
  rejectCode: text("reject_code"),
  payloadJson: text("payload_json").notNull(),
  receivedAt: text("received_at").notNull(),
  processedAt: text("processed_at"),
  latencyMicros: integer("latency_micros"),
}, (table) => [
  uniqueIndex("idx_gateway_message_session_sequence").on(table.sessionId, table.direction, table.sessionSequence),
  index("idx_gateway_message_member_clordid").on(table.memberId, table.clientOrderId),
  index("idx_gateway_message_market_sequence").on(table.marketSequence),
  index("idx_gateway_message_received_at").on(table.receivedAt),
]);

export const dropCopyEvents = sqliteTable("drop_copy_events", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull(),
  marketSequence: integer("market_sequence").notNull(),
  eventType: text("event_type").notNull(),
  orderId: text("order_id"),
  executionId: text("execution_id"),
  payloadJson: text("payload_json").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_drop_copy_member_sequence_event").on(table.memberId, table.marketSequence, table.eventType),
  index("idx_drop_copy_member_time").on(table.memberId, table.createdAt),
]);

export const brokerTokens = sqliteTable("broker_tokens", {
  connectionId: text("connection_id").primaryKey(),
  tokenCiphertext: text("token_ciphertext").notNull(),
  expiresAt: text("expires_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const liveRiskPolicies = sqliteTable("live_risk_policies", {
  userId: text("user_id").primaryKey().references(() => users.id),
  liveEnabled: integer("live_enabled").notNull().default(0),
  automationEnabled: integer("automation_enabled").notNull().default(0),
  killSwitch: integer("kill_switch").notNull().default(1),
  maxOrderQuantity: integer("max_order_quantity").notNull().default(10),
  maxOrderNotional: integer("max_order_notional").notNull().default(1_000_000),
  maxDailyNotional: integer("max_daily_notional").notNull().default(5_000_000),
  maxOpenOrders: integer("max_open_orders").notNull().default(5),
  allowedSymbolsJson: text("allowed_symbols_json").notNull().default("[]"),
  acknowledgedAt: text("acknowledged_at"),
  updatedAt: text("updated_at").notNull(),
  version: integer("version").notNull().default(1),
  commitToken: text("commit_token"),
});

export const liveOrderPreviews = sqliteTable("live_order_previews", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  connectionId: text("connection_id").notNull(),
  requestHash: text("request_hash").notNull(),
  requestJson: text("request_json").notNull(),
  quotePrice: integer("quote_price").notNull(),
  estimatedNotional: integer("estimated_notional").notNull(),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_live_previews_user_expiry").on(table.userId, table.expiresAt)]);

export const liveOrders = sqliteTable("live_orders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  connectionId: text("connection_id").notNull(),
  clientOrderId: text("client_order_id").notNull(),
  brokerOrderId: text("broker_order_id"),
  brokerOrgNo: text("broker_org_no"),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  orderType: text("order_type").notNull(),
  timeInForce: text("time_in_force").notNull(),
  venue: text("venue").notNull(),
  price: integer("price"),
  quantity: integer("quantity").notNull(),
  executedQuantity: integer("executed_quantity").notNull().default(0),
  averagePrice: integer("average_price"),
  riskNotional: integer("risk_notional").notNull().default(0),
  status: text("status").notNull(),
  brokerCode: text("broker_code"),
  brokerMessage: text("broker_message"),
  submittedAt: text("submitted_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_live_orders_user_client_order").on(table.userId, table.clientOrderId),
  index("idx_live_orders_user_updated").on(table.userId, table.updatedAt),
  index("idx_live_orders_connection_status").on(table.connectionId, table.status),
]);

export const liveExecutions = sqliteTable("live_executions", {
  id: text("id").primaryKey(),
  liveOrderId: text("live_order_id").notNull(),
  executionRef: text("execution_ref").notNull(),
  price: integer("price").notNull(),
  quantity: integer("quantity").notNull(),
  venue: text("venue").notNull(),
  executedAt: text("executed_at").notNull(),
}, (table) => [
  uniqueIndex("idx_live_executions_order_ref").on(table.liveOrderId, table.executionRef),
  index("idx_live_executions_time").on(table.executedAt),
]);
