import { Pool } from "pg";
import { env } from "../config/env.js";
import { logger } from "../logger.js";

export const pool = env.DATABASE_URL
  ? new Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  : null;

pool?.on("error", (error) => {
  logger.error({ err: error }, "Unexpected PostgreSQL pool error");
});

export async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number | null; error?: string }> {
  if (!pool) {
    return { ok: false, latencyMs: null, error: "DATABASE_URL is not configured" };
  }

  const started = Date.now();
  try {
    await pool.query("SELECT 1");
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error";
    return { ok: false, latencyMs: Date.now() - started, error: message };
  }
}
