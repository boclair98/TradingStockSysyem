type LockGlobal = typeof globalThis & { __atsLockPool?: import("pg").Pool };

const LOCK_ID = 721_202_211;

export async function withDistributedEngineLock<T>(task: () => Promise<T>): Promise<T> {
  if (!process.env.DATABASE_URL) return task();
  const globalState = globalThis as LockGlobal;
  if (!globalState.__atsLockPool) {
    const moduleName = "pg";
    const { Pool } = await import(moduleName) as typeof import("pg");
    globalState.__atsLockPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, application_name: "tradingstocksysyem-matching-leader" });
  }
  const client = await globalState.__atsLockPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_ID]);
    const result = await task();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
