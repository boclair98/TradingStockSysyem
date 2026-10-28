import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { disconnectLiveBroker } from "../engine/liveTradingService";
import { createPendingLiveOrder, getLiveRiskPolicy, getLiveRiskUsage, updateLiveOrderBrokerState } from "../db/liveTrading";
import { commitSimulationCommand, getSimulationAccount } from "../db/paperSimulation";
import { normalizePriceCrossDraft } from "../engine/automationStrategy";
import {
  __setTradingDatabaseAdapterForTests,
  commitAutomationEvaluation,
  commitAutomationStrategyChange,
  commitAutomationStrategyStatus,
  commitLiveRiskPolicyChange,
  countAutomationRuns,
  deleteBrokerConnection,
  ensurePaperUser,
  getAutomationRunStats,
  getAutomationStrategy,
  getLastPaperEngineSequence,
  savePaperEngineSequence,
  savePaperOrder,
  saveBrokerConnection,
  verifyAuditChain,
  type AutomationStrategyDraft,
  type DatabaseAdapter,
} from "../db/trading";

type BatchHook = (statements: ReadonlyArray<{ sql: string; params?: unknown[] }>) => void;

function sqliteValue(value: unknown) {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value as string | number | bigint | Uint8Array | null;
}

function createTransactionalAdapter(database: DatabaseSync) {
  let beforeBatch: BatchHook | null = null;
  const adapter: DatabaseAdapter & { setBeforeBatch(hook: BatchHook | null): void } = {
    kind: "d1",
    setBeforeBatch(hook) {
      beforeBatch = hook;
    },
    async query<T>(sql: string, params: unknown[] = []) {
      const statement = database.prepare(sql);
      const values = params.map(sqliteValue);
      if (statement.columns().length > 0) {
        return { rows: statement.all(...values) as T[], changes: 0 };
      }
      const result = statement.run(...values);
      return { rows: [], changes: Number(result.changes) };
    },
    async batch(statements) {
      beforeBatch?.(statements);
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const { sql, params = [] } of statements) {
          const statement = database.prepare(sql);
          const values = params.map(sqliteValue);
          if (statement.columns().length > 0) statement.all(...values);
          else statement.run(...values);
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return adapter;
}

function applyMigration(database: DatabaseSync, filename: string) {
  const sql = readFileSync(join(process.cwd(), "drizzle", filename), "utf8");
  for (const statement of sql.split(/-->\s*statement-breakpoint/)) {
    if (statement.trim()) database.exec(statement);
  }
}

function tableExists(database: DatabaseSync, name: string) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function indexExists(database: DatabaseSync, name: string) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(name));
}

function columnNames(database: DatabaseSync, table: string) {
  return new Set((database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
}

function scalar(database: DatabaseSync, sql: string, ...params: Array<string | number | null>) {
  return Number((database.prepare(sql).get(...params) as { value: number }).value);
}

const baseDraft: AutomationStrategyDraft = {
  id: "AUTO-SQLITE-1",
  connectionId: null,
  name: "SQLite 가격 도달 매수",
  symbol: "005930",
  side: "BUY",
  strategyType: "PRICE_CROSS",
  triggerOperator: "LTE",
  triggerPrice: 70_000,
  orderType: "LIMIT",
  limitPrice: 69_900,
  quantity: 2,
  intervalSeconds: 60,
  maxOrdersPerDay: 2,
  maxDailyNotional: 500_000,
};

const baselineMigrations = [
  "0000_nasty_vampiro.sql",
  "0001_colorful_tony_stark.sql",
  "0002_motionless_mephistopheles.sql",
  "0003_skinny_warlock.sql",
  "0004_loving_hex.sql",
  "0005_bright_marauders.sql",
];

test("automation persistence is atomic, versioned, idempotent, and migration-safe on SQLite", async (t) => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  t.after(() => {
    __setTradingDatabaseAdapterForTests(null);
    database.close();
  });

  for (const filename of baselineMigrations) applyMigration(database, filename);

  await t.test("migrations 0006-0012 preserve legacy data and add persistence controls", () => {
    assert.equal(tableExists(database, "audit_chain_heads"), false);
    assert.equal(tableExists(database, "automation_validation_progress"), false);
    assert.equal(columnNames(database, "automation_strategies").has("version"), false);

    const legacyAt = "2026-01-01T00:00:00.000Z";
    database.prepare("INSERT INTO users (id, email, display_name, role, status, created_at, last_seen_at) VALUES (?, ?, ?, 'participant', 'active', ?, ?)")
      .run("migration-user", "migration@example.test", "Migration", legacyAt, legacyAt);
    database.prepare("INSERT INTO audit_chain (id, user_id, action, entity_id, payload_json, previous_hash, entry_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("legacy-audit", "migration-user", "LEGACY", null, "{}", "GENESIS", "legacy-head", legacyAt);
    database.prepare("INSERT INTO automation_strategies (id, user_id, connection_id, name, symbol, side, strategy_type, trigger_operator, trigger_price, order_type, limit_price, quantity, interval_seconds, max_orders_per_day, max_daily_notional, status, execution_mode, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'paper', ?, ?)")
      .run("legacy-strategy", "migration-user", "Legacy strategy", "005930", "BUY", "PRICE_CROSS", "LTE", 70_000, "LIMIT", 69_900, 1, 60, 1, 100_000, legacyAt, legacyAt);

    applyMigration(database, "0006_classy_slapstick.sql");
    assert.equal(tableExists(database, "audit_chain_heads"), true);
    assert.equal(tableExists(database, "automation_validation_progress"), true);
    assert.deepEqual(
      { ...(database.prepare("SELECT entry_hash AS entryHash, updated_at AS updatedAt FROM audit_chain_heads WHERE user_id=?").get("migration-user") as object) },
      { entryHash: "legacy-head", updatedAt: legacyAt },
    );

    applyMigration(database, "0007_faulty_wrecker.sql");
    applyMigration(database, "0008_unknown_carlie_cooper.sql");
    applyMigration(database, "0009_unknown_tempest.sql");
    applyMigration(database, "0010_first_captain_universe.sql");
    applyMigration(database, "0011_famous_galactus.sql");
    applyMigration(database, "0012_light_raza.sql");
    const columns = columnNames(database, "automation_strategies");
    assert.equal(columns.has("version"), true);
    assert.equal(columns.has("commit_token"), true);
    assert.equal(indexExists(database, "idx_audit_chain_user_previous_hash"), true);
    assert.equal(columnNames(database, "live_orders").has("risk_notional"), true);
    assert.equal(columnNames(database, "live_risk_policies").has("version"), true);
    assert.equal(columnNames(database, "live_risk_policies").has("commit_token"), true);
    assert.equal(tableExists(database, "engine_runtime_state"), true);
    assert.equal(tableExists(database, "paper_simulation_accounts"), true);
    assert.equal(tableExists(database, "paper_simulation_commands"), true);
    assert.deepEqual(
      { ...(database.prepare("SELECT version, commit_token AS commitToken FROM automation_strategies WHERE id='legacy-strategy'").get() as object) },
      { version: 1, commitToken: null },
    );
  });

  await t.test("migration 0006 fails closed when one legacy user has two audit leaves", () => {
    const forkedDatabase = new DatabaseSync(":memory:");
    try {
      for (const filename of baselineMigrations) applyMigration(forkedDatabase, filename);
      const createdAt = "2026-01-01T00:00:00.000Z";
      const insert = forkedDatabase.prepare("INSERT INTO audit_chain (id, user_id, action, entity_id, payload_json, previous_hash, entry_hash, created_at) VALUES (?, ?, 'LEGACY', NULL, '{}', 'GENESIS', ?, ?)");
      insert.run("fork-left", "forked-user", "left-leaf", createdAt);
      insert.run("fork-right", "forked-user", "right-leaf", createdAt);

      assert.throws(() => applyMigration(forkedDatabase, "0006_classy_slapstick.sql"), /CHECK constraint failed/i);
      assert.equal(tableExists(forkedDatabase, "audit_chain_heads"), false);
      assert.equal(tableExists(forkedDatabase, "automation_validation_progress"), false);
    } finally {
      forkedDatabase.close();
    }
  });

  const adapter = createTransactionalAdapter(database);
  __setTradingDatabaseAdapterForTests(adapter);
  const userId = "sqlite-automation-user";
  await ensurePaperUser({ userId, email: "sqlite@example.test", displayName: "SQLite User", fullName: "SQLite User" });

  await t.test("isolated simulation commits once, replays a lost response and rejects stale or conflicting commands", async () => {
    const initial = await getSimulationAccount(userId);
    const normalized = normalizePriceCrossDraft(baseDraft, baseDraft.id);
    assert.ok(normalized.ok);
    const first = await commitSimulationCommand(userId, "simulation-start-0001", "start-hash", initial.version, { action: "start", strategy: normalized.strategy });
    assert.equal(first.version, 2);
    const duplicate = await commitSimulationCommand(userId, "simulation-start-0001", "start-hash", initial.version, { action: "start", strategy: normalized.strategy });
    assert.equal(duplicate.replayed, true);
    assert.equal((await getSimulationAccount(userId)).version, 2);
    await assert.rejects(commitSimulationCommand(userId, "simulation-start-0001", "different", 2, { action: "stop" }), /같은 요청 키/);
    await assert.rejects(commitSimulationCommand(userId, "simulation-stale-0001", "stop", 1, { action: "stop" }), /다른 탭/);
    const filled = await commitSimulationCommand(userId, "simulation-replay-0001", "replay-hash", 2, { action: "replay", ticks: [{ observedAt: "2026-10-28T00:00:00Z", price: 69_900, quantity: 1 }] });
    assert.equal(filled.state.positions["005930"].quantity, 1);
    assert.equal((await getSimulationAccount(userId)).state.cash, filled.state.cash);
    assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM paper_simulation_commands WHERE user_id=?", userId), 2);
    const other = "simulation-other-user";
    await ensurePaperUser({ userId: other, email: "other@example.test", displayName: "Other", fullName: null });
    assert.equal((await getSimulationAccount(other)).state.cash, 100_000_000);
    assert.equal((await getSimulationAccount(other)).state.orders.length, 0);
  });

  await t.test("a simulation account CAS loser rolls back its command journal", async () => {
    const account = await getSimulationAccount(userId);
    adapter.setBeforeBatch((statements) => {
      if (statements.some((statement) => statement.sql.startsWith("UPDATE paper_simulation_accounts SET state_json"))) {
        database.prepare("UPDATE paper_simulation_accounts SET version=version+1 WHERE user_id=?").run(userId);
      }
    });
    try {
      await assert.rejects(commitSimulationCommand(userId, "simulation-cas-loser-0001", "stop-hash", account.version, { action: "stop" }), /동시에 요청/);
      assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM paper_simulation_commands WHERE command_id='simulation-cas-loser-0001'"), 0);
      assert.equal((await getSimulationAccount(userId)).state.session?.status, "RUNNING");
    } finally { adapter.setBeforeBatch(null); }
  });

  await t.test("engine high-water mark survives non-order events and never moves backwards", async () => {
    assert.equal(await getLastPaperEngineSequence(), 0);
    await savePaperEngineSequence(19);
    await savePaperEngineSequence(7);
    assert.equal(await getLastPaperEngineSequence(), 19);
    assert.equal(scalar(database, "SELECT last_sequence AS value FROM engine_runtime_state WHERE venue='NEXTRADE'"), 19);
  });

  await t.test("live risk policy updates are versioned, audited, and stale-write safe", async () => {
    const initial = await getLiveRiskPolicy(userId);
    assert.equal(initial.version, 1);
    const updated = await commitLiveRiskPolicyChange({
      userId,
      expectedVersion: initial.version,
      policy: { liveEnabled: false, automationEnabled: false, killSwitch: true, maxOrderQuantity: 5, maxOrderNotional: 500_000, maxDailyNotional: 2_000_000, maxOpenOrders: 3, allowedSymbols: ["005930"], acknowledgedAt: null },
      auditPayload: { liveEnabled: false, killSwitch: true },
    });
    assert.equal(updated.committed, true);
    const afterUpdate = await getLiveRiskPolicy(userId);
    assert.equal(afterUpdate.version, 2);
    assert.equal(afterUpdate.maxOrderQuantity, 5);

    const stale = await commitLiveRiskPolicyChange({
      userId,
      expectedVersion: 1,
      policy: { liveEnabled: true, automationEnabled: false, killSwitch: false, maxOrderQuantity: 99, maxOrderNotional: 999_000, maxDailyNotional: 9_000_000, maxOpenOrders: 9, allowedSymbols: [], acknowledgedAt: new Date().toISOString() },
      auditPayload: { liveEnabled: true, killSwitch: false },
    });
    assert.equal(stale.reason, "conflict");
    assert.equal((await getLiveRiskPolicy(userId)).killSwitch, true);
  });

  await t.test("paper order persistence rejects a cross-user primary-key collision", async () => {
    const acceptedAt = "2026-01-02T00:00:00.000Z";
    await savePaperOrder(userId, {
      id: "PAPER-OWNER-GUARD",
      participantId: "PART-A",
      symbol: "005930",
      side: "BUY",
      type: "LIMIT",
      timeInForce: "GTC",
      price: 70_000,
      stopPrice: null,
      quantity: 2,
      remaining: 2,
      status: "OPEN",
      sequence: 1,
      acceptedAt,
      lastUpdatedAt: acceptedAt,
    });
    const otherUser = "sqlite-paper-collision-user";
    await ensurePaperUser({ userId: otherUser, email: "paper-collision@example.test", displayName: "Paper Collision", fullName: null });
    await assert.rejects(savePaperOrder(otherUser, {
      id: "PAPER-OWNER-GUARD",
      participantId: "PART-B",
      symbol: "005930",
      side: "SELL",
      type: "LIMIT",
      timeInForce: "GTC",
      price: 69_000,
      stopPrice: null,
      quantity: 9,
      remaining: 0,
      status: "FILLED",
      sequence: 99,
      acceptedAt,
      lastUpdatedAt: acceptedAt,
    }), /ownership conflict/);
    assert.equal((database.prepare("SELECT user_id AS userId FROM paper_orders WHERE id='PAPER-OWNER-GUARD'").get() as { userId: string }).userId, userId);
  });

  await t.test("market orders reserve their preview notional in daily risk usage", async () => {
    const pending = await createPendingLiveOrder({
      id: "LORD-RISK-RESERVE",
      userId,
      connectionId: "BROKER-RISK-RESERVE",
      clientOrderId: "LIVE-RISK-RESERVE",
      request: { connectionId: "BROKER-RISK-RESERVE", symbol: "005930", side: "BUY", orderType: "MARKET", timeInForce: "IOC", venue: "SOR", quantity: 3, price: null },
      riskNotional: 210_000,
    });
    assert.equal(pending?.status, "PENDING");
    const usage = await getLiveRiskUsage(userId);
    assert.equal(usage.dailyNotional, 210_000);
    assert.equal(usage.openOrders, 1);
  });

  await t.test("a partially filled then cancelled order keeps its executed notional in daily usage", async () => {
    await updateLiveOrderBrokerState(userId, "LORD-RISK-RESERVE", {
      status: "CANCELLED",
      executedQuantity: 1,
      averagePrice: 70_500,
    });
    const usage = await getLiveRiskUsage(userId);
    assert.equal(usage.dailyNotional, 70_500);
    assert.equal(usage.openOrders, 0);
  });

  await t.test("create/edit use monotonic versions and reject a stale edit without an orphan audit", async () => {
    const created = await commitAutomationStrategyChange({
      userId,
      strategy: baseDraft,
      auditPayload: { source: "sqlite-integration", operation: "create" },
    });
    assert.equal(created.reason, null);
    assert.equal(created.strategy?.version, 1);
    assert.equal(created.strategy?.status, "draft");
    assert.equal(created.strategy?.executionMode, "paper");

    const edited = await commitAutomationStrategyChange({
      userId,
      strategy: { ...baseDraft, name: "SQLite 수정 전략", quantity: 3 },
      expectedVersion: 1,
      auditPayload: { source: "sqlite-integration", operation: "edit" },
    });
    assert.equal(edited.reason, null);
    assert.equal(edited.strategy?.version, 2);
    assert.equal(edited.strategy?.quantity, 3);

    const auditCountBeforeConflict = scalar(database, "SELECT COUNT(*) AS value FROM audit_chain WHERE user_id=?", userId);
    const stale = await commitAutomationStrategyChange({
      userId,
      strategy: { ...baseDraft, name: "반영되면 안 되는 전략", quantity: 99 },
      expectedVersion: 1,
      auditPayload: { source: "sqlite-integration", operation: "stale-edit" },
    });
    assert.equal(stale.reason, "conflict");
    assert.equal((await getAutomationStrategy(userId, baseDraft.id))?.quantity, 3);
    assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM audit_chain WHERE user_id=?", userId), auditCountBeforeConflict);
  });

  await t.test("repeated audit-head CAS contention leaves no partial strategy or audit write", async () => {
    const contentionUser = "sqlite-contention-user";
    await ensurePaperUser({ userId: contentionUser, email: "race@example.test", displayName: "Race User", fullName: null });
    let race = 0;
    adapter.setBeforeBatch(() => {
      race += 1;
      database.prepare("UPDATE audit_chain_heads SET entry_hash=?, updated_at=? WHERE user_id=?")
        .run(`COMPETING-${race}`, `race-token-${race}`, contentionUser);
    });
    try {
      const outcome = await commitAutomationStrategyChange({
          userId: contentionUser,
          strategy: { ...baseDraft, id: "AUTO-CONTENDED" },
          auditPayload: { source: "sqlite-integration", operation: "contended-create" },
        }).then((result) => result.reason, (error: unknown) => {
          assert.match(error instanceof Error ? error.message : String(error), /constraint|NOT NULL/i);
          return "contention" as const;
        });
      assert.equal(outcome, "contention");
    } finally {
      adapter.setBeforeBatch(null);
    }
    assert.equal(race, 3);
    assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM automation_strategies WHERE user_id=?", contentionUser), 0);
    assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM audit_chain WHERE user_id=?", contentionUser), 0);
    assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM audit_log WHERE user_id=?", contentionUser), 0);
  });

  await t.test("deleting a broker connection pauses linked strategies and invalidates a stale CAS version", async () => {
    const brokerUser = "sqlite-broker-user";
    const connectionId = "BROKER-SQLITE-1";
    const strategyId = "AUTO-BROKER-LINKED";
    await ensurePaperUser({ userId: brokerUser, email: "broker@example.test", displayName: "Broker User", fullName: null });
    await saveBrokerConnection({
      id: connectionId,
      userId: brokerUser,
      provider: "TEST_BROKER",
      mode: "sandbox",
      accountLabel: "SQLite sandbox",
      accountRef: "masked-account",
      credentialCiphertext: null,
      status: "connected",
    });
    const created = await commitAutomationStrategyChange({
      userId: brokerUser,
      strategy: { ...baseDraft, id: strategyId, connectionId },
      auditPayload: { source: "sqlite-integration", operation: "broker-linked-create" },
    });
    assert.equal(created.strategy?.version, 1);
    const ready = await commitAutomationStrategyStatus({
      userId: brokerUser,
      strategyId,
      status: "ready",
      expectedVersion: 1,
      auditPayload: { source: "sqlite-integration", operation: "ready" },
    });
    assert.equal(ready.strategy?.version, 2);

    assert.equal(await deleteBrokerConnection(brokerUser, connectionId), true);
    const paused = await getAutomationStrategy(brokerUser, strategyId);
    assert.equal(paused?.status, "paused");
    assert.equal(paused?.version, 3);

    const staleStatus = await commitAutomationStrategyStatus({
      userId: brokerUser,
      strategyId,
      status: "armed",
      expectedVersion: 2,
      auditPayload: { source: "sqlite-integration", operation: "stale-arm" },
    });
    assert.equal(staleStatus.reason, "conflict");
    assert.equal((await getAutomationStrategy(brokerUser, strategyId))?.status, "paused");
  });

  await t.test("an attacker cannot disconnect or delete another user's broker token", async () => {
    const victimUser = "sqlite-victim-user";
    const attackerUser = "sqlite-attacker-user";
    const victimConnection = "VICTIM-CONNECTION-1";
    await ensurePaperUser({ userId: victimUser, email: "victim@example.test", displayName: "Victim", fullName: null });
    await ensurePaperUser({ userId: attackerUser, email: "attacker@example.test", displayName: "Attacker", fullName: null });
    const createdAt = "2026-01-03T00:00:00.000Z";
    database.prepare("INSERT INTO broker_connections (id, user_id, provider, mode, account_label, account_ref, credential_ciphertext, status, last_checked_at, last_error, created_at, updated_at) VALUES (?, ?, 'korea_investment', 'sandbox', 'Victim account', 'masked-victim', 'sealed-victim-credentials', 'connected', ?, NULL, ?, ?)")
      .run(victimConnection, victimUser, createdAt, createdAt, createdAt);
    database.prepare("INSERT INTO broker_tokens (connection_id, token_ciphertext, expires_at, updated_at) VALUES (?, 'sealed-victim-token', ?, ?)")
      .run(victimConnection, "2026-12-31T23:59:59.000Z", createdAt);

    assert.equal(await disconnectLiveBroker(attackerUser, victimConnection), false);
    assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM broker_connections WHERE id=? AND user_id=?", victimConnection, victimUser), 1);
    assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM broker_tokens WHERE connection_id=?", victimConnection), 1);
    assert.equal((database.prepare("SELECT token_ciphertext AS tokenCiphertext FROM broker_tokens WHERE connection_id=?").get(victimConnection) as { tokenCiphertext: string }).tokenCiphertext, "sealed-victim-token");
  });

  await t.test("a connection with an unresolved live order keeps its credentials for cancellation and reconciliation", async () => {
    const victimUser = "sqlite-victim-user";
    const victimConnection = "VICTIM-CONNECTION-1";
    await createPendingLiveOrder({
      id: "LORD-OPEN-DISCONNECT-GUARD",
      userId: victimUser,
      connectionId: victimConnection,
      clientOrderId: "LIVE-OPEN-DISCONNECT-GUARD",
      request: { connectionId: victimConnection, symbol: "005930", side: "BUY", orderType: "LIMIT", timeInForce: "DAY", venue: "SOR", quantity: 1, price: 70_000 },
      riskNotional: 70_000,
    });
    await assert.rejects(disconnectLiveBroker(victimUser, victimConnection), /취소·대사를 완료/);
    assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM broker_connections WHERE id=? AND user_id=?", victimConnection, victimUser), 1);
    assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM broker_tokens WHERE connection_id=?", victimConnection), 1);
  });

  const fingerprint = "a".repeat(64);
  await t.test("validation progress is lazily backfilled exactly for the user, strategy, and fingerprint", async () => {
    const insertRun = database.prepare("INSERT INTO automation_runs (id, strategy_id, user_id, status, observed_price, order_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)");
    insertRun.run("legacy-trigger", baseDraft.id, userId, "WOULD_SUBMIT", 70_000, JSON.stringify({ strategyFingerprint: fingerprint }), "2026-01-02T00:00:00.000Z");
    insertRun.run("legacy-wait", baseDraft.id, userId, "CONDITION_WAITING", 70_100, JSON.stringify({ strategyFingerprint: fingerprint }), "2026-01-02T00:01:00.000Z");
    insertRun.run("legacy-other-fingerprint", baseDraft.id, userId, "WOULD_SUBMIT", 70_000, JSON.stringify({ strategyFingerprint: "b".repeat(64) }), "2026-01-02T00:02:00.000Z");
    insertRun.run("legacy-other-strategy", "AUTO-OTHER", userId, "WOULD_SUBMIT", 70_000, JSON.stringify({ strategyFingerprint: fingerprint }), "2026-01-02T00:03:00.000Z");

    const stats = await getAutomationRunStats(userId, baseDraft.id, fingerprint);
    assert.deepEqual(stats, { validationCount: 2, triggerCount: 1, waitingCount: 1 });
    assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM automation_validation_progress WHERE user_id=? AND strategy_id=? AND strategy_fingerprint=?", userId, baseDraft.id, fingerprint), 1);
  });

  await t.test("evaluation retry replays one response and transactionally rolls back every duplicate side effect", async () => {
    const first = await commitAutomationEvaluation({
      userId,
      strategyId: baseDraft.id,
      idempotencyKey: "sqlite-idempotency-key",
      requestHash: "request-hash-1",
      statusCode: 200,
      response: { decision: "WOULD_SUBMIT", orderSubmitted: false },
      run: {
        id: "evaluation-once",
        strategyId: baseDraft.id,
        status: "WOULD_SUBMIT",
        observedPrice: 70_000,
        orderId: null,
        detail: { strategyFingerprint: fingerprint, orderSubmitted: false },
        createdAt: "2026-01-02T01:00:00.000Z",
        triggered: true,
      },
      auditPayload: { source: "sqlite-integration", decision: "WOULD_SUBMIT" },
    });
    assert.equal(first.created, true);
    assert.equal(first.replay, null);

    const headBeforeReplay = database.prepare("SELECT entry_hash AS entryHash, updated_at AS versionToken FROM audit_chain_heads WHERE user_id=?").get(userId);
    const auditBeforeReplay = scalar(database, "SELECT COUNT(*) AS value FROM audit_chain WHERE user_id=?", userId);
    const second = await commitAutomationEvaluation({
      userId,
      strategyId: baseDraft.id,
      idempotencyKey: "sqlite-idempotency-key",
      requestHash: "request-hash-1",
      statusCode: 200,
      response: { decision: "SHOULD_NOT_REPLACE" },
      run: {
        id: "evaluation-duplicate",
        strategyId: baseDraft.id,
        status: "CONDITION_WAITING",
        observedPrice: 70_100,
        orderId: null,
        detail: { strategyFingerprint: fingerprint, orderSubmitted: false },
        createdAt: "2026-01-02T01:01:00.000Z",
        triggered: false,
      },
      auditPayload: { source: "sqlite-integration", decision: "CONDITION_WAITING" },
    });
    assert.equal(second.created, false);
    assert.equal(second.replay?.requestHash, "request-hash-1");
    assert.deepEqual(database.prepare("SELECT entry_hash AS entryHash, updated_at AS versionToken FROM audit_chain_heads WHERE user_id=?").get(userId), headBeforeReplay);
    assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM audit_chain WHERE user_id=?", userId), auditBeforeReplay);
    assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM automation_runs WHERE id='evaluation-duplicate'"), 0);
    assert.equal(await countAutomationRuns(userId), 5);
    assert.deepEqual(await getAutomationRunStats(userId, baseDraft.id, fingerprint), { validationCount: 3, triggerCount: 2, waitingCount: 1 });

    const integrity = await verifyAuditChain(userId);
    assert.deepEqual(
      { ok: integrity.ok, complete: integrity.complete, checked: integrity.checked },
      { ok: true, complete: true, checked: 4 },
    );
  });
});
