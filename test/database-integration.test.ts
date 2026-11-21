import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../src/database/migrate.js";
import { pool } from "../src/database/pool.js";

test("PostgreSQL migrations and core integrity checks", { skip: !process.env.DATABASE_URL }, async () => {
  assert.ok(pool);
  const applied = await migrate();
  assert.ok(Array.isArray(applied));
  const result = await pool!.query(
    `SELECT
       to_regclass('public.court_reservations') AS court_reservations,
       to_regclass('public.shop_orders') AS shop_orders,
       to_regclass('public.ledger_entries') AS ledger_entries`,
  );
  assert.ok(result.rows[0].court_reservations);
  assert.ok(result.rows[0].shop_orders);
  assert.ok(result.rows[0].ledger_entries);
});
