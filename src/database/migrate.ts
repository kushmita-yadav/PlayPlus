import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";
import { logger } from "../logger.js";

const migrationsDirectory = path.resolve(process.cwd(), "migrations");

export async function migrate(): Promise<string[]> {
  if (!pool) throw new Error("DATABASE_URL is not configured");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const entries = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();
  const applied = new Set(
    (await pool.query("SELECT name FROM schema_migrations")).rows.map((row) => row.name as string),
  );
  const newlyApplied: string[] = [];

  for (const name of entries) {
    if (applied.has(name)) continue;
    const sql = await readFile(path.join(migrationsDirectory, name), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
      newlyApplied.push(name);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return newlyApplied;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate()
    .then((names) => logger.info({ migrations: names }, "Database migrations completed"))
    .catch((error) => {
      logger.error({ err: error }, "Database migration failed");
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool?.end();
    });
}
