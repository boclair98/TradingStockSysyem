import * as schema from "./schema";

export async function getDb() {
  const workersModule = "cloudflare:workers";
  const { env } = await import(workersModule) as { env: { DB?: unknown } };
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }
  const { drizzle } = await import("drizzle-orm/d1");
  return drizzle(env.DB as never, { schema });
}
