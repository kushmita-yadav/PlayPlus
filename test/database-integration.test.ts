import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createUiSession } from "../src/auth/auth.js";
import { env } from "../src/config/env.js";
import { migrate } from "../src/database/migrate.js";
import { pool } from "../src/database/pool.js";

const app = createApp();

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

test("manager shared-state writes cannot alter protected modules", { skip: !process.env.DATABASE_URL }, async () => {
  assert.ok(pool);
  env.JWT_SECRET = "a-test-secret-at-least-thirty-two-characters";
  const current = await pool!.query(
    "SELECT state, version FROM shared_demo_state WHERE singleton_key=1",
  );
  if (!current.rowCount) return;
  const original = current.rows[0].state as Record<string, unknown>;
  const modified = JSON.parse(JSON.stringify(original)) as Record<string, unknown>;
  const transactions = Array.isArray(modified.transactions) ? modified.transactions : [];
  modified.transactions = [...transactions, { id: `UNAUTHORIZED-${randomUUID()}`, amount: 1 }];
  const session = createUiSession("manager", "Test Manager", "manager@example.com");
  await request(app)
    .put("/api/v1/demo-data")
    .set("Cookie", `playpulse_ui=${session}`)
    .send({ version: Number(current.rows[0].version), data: modified })
    .expect(403);
  const after = await pool!.query(
    "SELECT state, version FROM shared_demo_state WHERE singleton_key=1",
  );
  assert.deepEqual(after.rows[0].state, original);
  assert.equal(Number(after.rows[0].version), Number(current.rows[0].version));
});

test("concurrent court bookings reject duplicate reservation", { skip: !process.env.DATABASE_URL }, async () => {
  assert.ok(pool);
  const code = `TEST-${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const court = await pool!.query(
    `INSERT INTO courts (sport_id,code,name,base_hourly_price)
     SELECT id,$1,$2,1000 FROM sports WHERE code='TENNIS'
     RETURNING id`,
    [code, `Concurrency test ${code}`],
  );
  assert.ok(court.rowCount);
  const courtId = court.rows[0].id as string;
  try {
    const start = new Date(Date.now() + 7 * 86400000);
    start.setUTCMinutes(start.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
    const end = new Date(start.getTime() + 3600000);
    const insert = async () => {
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO court_reservations
             (court_id,starts_at,ends_at,status,booking_type,base_amount,discount_amount,final_amount)
           VALUES ($1,$2,$3,'confirmed','walk_in',1000,0,1000)`,
          [courtId, start, end],
        );
        await client.query("COMMIT");
        return "success";
      } catch {
        await client.query("ROLLBACK");
        return "conflict";
      } finally {
        client.release();
      }
    };
    const results = await Promise.all([insert(), insert()]);
    assert.deepEqual(results.sort(), ["conflict", "success"]);
  } finally {
    await pool!.query("DELETE FROM court_reservations WHERE court_id=$1", [courtId]);
    await pool!.query("DELETE FROM courts WHERE id=$1", [courtId]);
  }
});

test("concurrent stock deductions never make stock negative", { skip: !process.env.DATABASE_URL }, async () => {
  assert.ok(pool);
  const product = await pool!.query(
    `INSERT INTO shop_products (sku,name,category,price,stock_quantity,low_stock_threshold)
     VALUES ($1,'Concurrency stock test','Test',100,1,0)
     ON CONFLICT (sku) DO UPDATE SET stock_quantity=1
     RETURNING id`,
    [`CONCURRENCY-${Date.now()}`],
  );
  assert.ok(product.rowCount);
  const productId = product.rows[0].id;
  try {
    const deduct = async () => {
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query(
          "SELECT stock_quantity FROM shop_products WHERE id=$1 FOR UPDATE",
          [productId],
        );
        if (current.rows[0].stock_quantity < 1) throw new Error("insufficient");
        await client.query(
          "UPDATE shop_products SET stock_quantity=stock_quantity-1 WHERE id=$1",
          [productId],
        );
        await client.query("COMMIT");
        return "success";
      } catch {
        await client.query("ROLLBACK");
        return "insufficient";
      } finally {
        client.release();
      }
    };
    const results = await Promise.all([deduct(), deduct()]);
    assert.deepEqual(results.sort(), ["insufficient", "success"]);
  } finally {
    await pool!.query("DELETE FROM shop_products WHERE id=$1", [productId]);
  }
});

test("payment idempotency rejects duplicate provider key", { skip: !process.env.DATABASE_URL }, async () => {
  assert.ok(pool);
  const tab = await pool!.query(
    `INSERT INTO customer_tabs (guest_name,status) VALUES ('Concurrency Payment Test','open') RETURNING id`,
  );
  const tabId = tab.rows[0].id;
  try {
    const key = `payment-${Date.now()}`;
    const insert = async () => {
      try {
        await pool!.query(
          `INSERT INTO cafeteria_payments (tab_id,amount,method,idempotency_key)
           VALUES ($1,100,'upi',$2)`,
          [tabId, key],
        );
        return "success";
      } catch {
        return "duplicate";
      }
    };
    const results = await Promise.all([insert(), insert()]);
    assert.deepEqual(results.sort(), ["duplicate", "success"]);
  } finally {
    await pool!.query("DELETE FROM cafeteria_payments WHERE tab_id=$1", [tabId]);
    await pool!.query("DELETE FROM customer_tabs WHERE id=$1", [tabId]);
  }
});
