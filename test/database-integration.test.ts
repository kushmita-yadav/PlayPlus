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

test("concurrent court bookings reject duplicate reservation", { skip: !process.env.DATABASE_URL }, async () => {
  assert.ok(pool);
  const court = await pool!.query("SELECT id FROM courts LIMIT 1");
  assert.ok(court.rowCount);
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
        [court.rows[0].id, start, end],
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
  const productId = product.rows[0].id;
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
});

test("payment idempotency rejects duplicate provider key", { skip: !process.env.DATABASE_URL }, async () => {
  assert.ok(pool);
  const tab = await pool!.query(
    `INSERT INTO customer_tabs (guest_name,status) VALUES ('Concurrency Payment Test','open') RETURNING id`,
  );
  const key = `payment-${Date.now()}`;
  const insert = async () => {
    try {
      await pool!.query(
        `INSERT INTO cafeteria_payments (tab_id,amount,method,idempotency_key)
         VALUES ($1,100,'upi',$2)`,
        [tab.rows[0].id, key],
      );
      return "success";
    } catch {
      return "duplicate";
    }
  };
  const results = await Promise.all([insert(), insert()]);
  assert.deepEqual(results.sort(), ["duplicate", "success"]);
});
