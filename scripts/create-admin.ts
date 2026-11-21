import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "../src/database/pool.js";

const input = z.object({
  email: z.string().email().max(254),
  password: z.string().min(12).max(128),
  fullName: z.string().trim().min(2).max(120),
}).parse({
  email: process.env.BOOTSTRAP_ADMIN_EMAIL,
  password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
  fullName: process.env.BOOTSTRAP_ADMIN_NAME,
});

if (!pool) throw new Error("DATABASE_URL is required");

const passwordHash = await bcrypt.hash(input.password, 12);
try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('playpulse-bootstrap-admin'))");
    const existing = await client.query(
      `SELECT a.id FROM accounts a
       JOIN roles r ON r.id=a.role_id
       WHERE r.name='admin'
       LIMIT 1`,
    );
    if (existing.rowCount) {
      throw new Error("An administrator already exists; no account was changed.");
    }
    const created = await client.query(
      `INSERT INTO accounts (email, password_hash, full_name, role_id)
       SELECT lower($1), $2, $3, r.id
       FROM roles r
       WHERE r.name='admin'
       RETURNING id`,
      [input.email, passwordHash, input.fullName],
    );
    if (!created.rowCount) throw new Error("The admin role is missing; run database migrations first.");
    await client.query("COMMIT");
    console.log(`Created initial administrator account: ${input.email}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
