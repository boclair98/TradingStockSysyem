import { getTradingDb } from "./trading";
import { applySimulationCommand, createSimulationState, simulationAvailableCash, simulationEquity, type SimulationCommand, type SimulationState } from "../engine/paperSimulation";

export class SimulationConflict extends Error {}
export async function getSimulationAccount(userId: string) {
  const db = await getTradingDb();
  await db.query(`INSERT INTO paper_simulation_accounts (user_id, state_json, version, commit_token, updated_at) VALUES (?, ?, 1, '', ?) ON CONFLICT(user_id) DO NOTHING`, [userId, JSON.stringify(createSimulationState()), new Date().toISOString()]);
  const row = (await db.query<{ stateJson: string; version: number; updatedAt: string }>(`SELECT state_json AS "stateJson", version, updated_at AS "updatedAt" FROM paper_simulation_accounts WHERE user_id=?`, [userId])).rows[0];
  const state = JSON.parse(row.stateJson) as SimulationState;
  return { state, version: Number(row.version), updatedAt: row.updatedAt, summary: { equity: simulationEquity(state), availableCash: simulationAvailableCash(state), priceSource: "USER_REPLAY", feeModelBps: 1.5, realOrdersSubmitted: 0 } };
}

export async function listSimulationCommands(userId: string, limit = 20) {
  const db = await getTradingDb();
  const rows = await db.query<{ commandId: string; responseJson: string; createdAt: string }>(`SELECT command_id AS "commandId", response_json AS "responseJson", created_at AS "createdAt" FROM paper_simulation_commands WHERE user_id=? ORDER BY created_at DESC, command_id DESC LIMIT ?`, [userId, Math.min(100, Math.max(1, limit))]);
  return rows.rows.map((row) => ({ id: row.commandId, createdAt: row.createdAt, events: (JSON.parse(row.responseJson) as { events: unknown[] }).events }));
}

export async function commitSimulationCommand(userId: string, commandId: string, requestHash: string, expectedVersion: number, command: SimulationCommand) {
  const db = await getTradingDb();
  const replay = async () => (await db.query<{ requestHash: string; responseJson: string }>(`SELECT request_hash AS "requestHash", response_json AS "responseJson" FROM paper_simulation_commands WHERE user_id=? AND command_id=?`, [userId, commandId])).rows[0];
  const replayResponse = async (json: string) => {
    const recorded = JSON.parse(json) as { events: unknown[]; version: number };
    return { ...await getSimulationAccount(userId), events: recorded.events, originalVersion: recorded.version, replayed: true };
  };
  const existing = await replay();
  if (existing) {
    if (existing.requestHash !== requestHash) throw new SimulationConflict("같은 요청 키로 다른 명령을 보낼 수 없습니다.");
    return replayResponse(existing.responseJson);
  }
  const account = await getSimulationAccount(userId);
  if (account.version !== expectedVersion) throw new SimulationConflict("다른 탭에서 원장이 바뀌었습니다. 새로고침한 뒤 다시 실행하세요.");
  const result = applySimulationCommand(account.state, command, commandId);
  const version = expectedVersion + 1;
  const now = new Date().toISOString();
  const response = { ...result, version, updatedAt: now, replayed: false };
  const token = crypto.randomUUID();
  try {
    await db.batch([
      { sql: `UPDATE paper_simulation_accounts SET state_json=?, version=?, commit_token=?, updated_at=? WHERE user_id=? AND version=?`, params: [JSON.stringify(result.state), version, token, now, userId, expectedVersion] },
      // If the account CAS lost, this NOT NULL guard rolls the whole transaction back.
      { sql: `INSERT INTO paper_simulation_commands (user_id, command_id, request_hash, response_json, created_at) VALUES ((SELECT user_id FROM paper_simulation_accounts WHERE user_id=? AND version=? AND commit_token=?), ?, ?, ?, ?)`, params: [userId, version, token, commandId, requestHash, JSON.stringify({ events: result.events, version, updatedAt: now }), now] },
    ]);
  } catch (error) {
    const duplicate = await replay();
    if (duplicate) {
      if (duplicate.requestHash !== requestHash) throw new SimulationConflict("같은 요청 키로 다른 명령을 보낼 수 없습니다.");
      return replayResponse(duplicate.responseJson);
    }
    if ((await getSimulationAccount(userId)).version !== expectedVersion) throw new SimulationConflict("동시에 요청한 변경이 먼저 반영됐습니다. 최신 원장을 확인하세요.");
    throw error;
  }
  return response;
}
