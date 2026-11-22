import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createUiSession, signToken } from "../src/auth/auth.js";
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

test("public shop pickup order reserves stock until staff records payment", { skip: !process.env.DATABASE_URL }, async () => {
  assert.ok(pool);
  env.JWT_SECRET = "a-test-secret-at-least-thirty-two-characters";
  const sku = `PUBLIC-${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const product = await pool!.query(
    `INSERT INTO shop_products (sku,name,category,price,stock_quantity,low_stock_threshold)
     VALUES ($1,'Public order test','Test',125,4,0) RETURNING id`,
    [sku],
  );
  const productId = String(product.rows[0].id);
  const manager = await pool!.query(
    `INSERT INTO accounts (email,password_hash,full_name,role_id)
     SELECT $1,'not-a-login-hash','Shop Test Manager',id FROM roles WHERE name='manager'
     RETURNING id`,
    [`shop-manager-${randomUUID()}@example.test`],
  );
  assert.ok(manager.rowCount);
  const managerId = String(manager.rows[0].id);
  const idempotencyKey = randomUUID();
  const token = signToken({
    id: managerId,
    email: "shop-manager@example.test",
    fullName: "Shop Manager",
    role: "manager",
    permissions: ["shop.manage"],
  });
  let orderId = "";
  try {
    const body = {
      customer: { name: "Test Customer", email: "customer@example.test", phone: "9876543210" },
      items: [{ productId, quantity: 2 }],
    };
    const placed = await request(app)
      .post("/api/v1/shop/orders/public")
      .set("Idempotency-Key", idempotencyKey)
      .send(body)
      .expect(201);
    assert.equal(placed.body.data.status, "pending");
    assert.equal(placed.body.data.totalAmount, 250);
    orderId = String((await pool!.query("SELECT id FROM shop_orders WHERE order_number=$1", [placed.body.data.orderNumber])).rows[0].id);

    const replay = await request(app)
      .post("/api/v1/shop/orders/public")
      .set("Idempotency-Key", idempotencyKey)
      .send(body)
      .expect(200);
    assert.equal(replay.body.idempotent, true);
    assert.equal(Number((await pool!.query("SELECT stock_quantity FROM shop_products WHERE id=$1", [productId])).rows[0].stock_quantity), 2);

    const confirmed = await request(app)
      .post(`/api/v1/shop/orders/${orderId}/confirm`)
      .set("Authorization", `Bearer ${token}`)
      .send({ paymentMethod: "cash" })
      .expect(200);
    assert.equal(confirmed.body.data.status, "confirmed");
    assert.ok(confirmed.body.data.receiptNumber);
    await request(app)
      .post(`/api/v1/shop/orders/${orderId}/fulfill`)
      .set("Authorization", `Bearer ${token}`)
      .send({})
      .expect(200);
  } finally {
    if (orderId) {
      await pool!.query("DELETE FROM receipt_records WHERE source_id=$1", [orderId]);
      await pool!.query("DELETE FROM shop_payments WHERE order_id=$1", [orderId]);
      await pool!.query("DELETE FROM shop_order_status_history WHERE order_id=$1", [orderId]);
      await pool!.query("DELETE FROM shop_order_items WHERE order_id=$1", [orderId]);
      await pool!.query("DELETE FROM shop_orders WHERE id=$1", [orderId]);
    }
    await pool!.query("DELETE FROM stock_movements WHERE product_id=$1", [productId]);
    await pool!.query("DELETE FROM shop_products WHERE id=$1", [productId]);
    await pool!.query("DELETE FROM accounts WHERE id=$1", [managerId]);
  }
});

test("Razorpay shop checkout verifies captured amount before confirming the order", { skip: !process.env.DATABASE_URL }, async () => {
 assert.ok(pool);
 const previousProvider = env.PAYMENT_PROVIDER;
 const previousKeyId = env.RAZORPAY_KEY_ID;
 const previousSecret = env.RAZORPAY_KEY_SECRET;
 const originalFetch = globalThis.fetch;
 const suffix = randomUUID().replace(/-/g, "");
 const product = await pool!.query(
   `INSERT INTO shop_products (sku,name,category,price,stock_quantity)
    VALUES ($1,'Razorpay integration item','Test',125,3) RETURNING id`,
   [`RZP-${suffix.slice(0, 20)}`],
 );
 const productId = String(product.rows[0].id);
 const gatewayOrderId = `order_${suffix.slice(0, 20)}`;
 const gatewayPaymentId = `pay_${suffix.slice(0, 20)}`;
 const secret = `test-secret-${suffix}`;
 let gatewayAmount = 25000;
 env.PAYMENT_PROVIDER = "razorpay";
 env.RAZORPAY_KEY_ID = "rzp_test_playplus";
 env.RAZORPAY_KEY_SECRET = secret;
 globalThis.fetch = async (input, init) => {
   const url = String(input);
   if (url.endsWith("/v1/orders")) {
     const body = JSON.parse(String(init?.body)) as { amount: number; currency: string };
     return new Response(JSON.stringify({ id: gatewayOrderId, amount: body.amount, currency: body.currency }), {
       status: 200, headers: { "Content-Type": "application/json" },
     });
   }
   if (url.includes("/v1/payments/")) {
     return new Response(JSON.stringify({
       id: gatewayPaymentId, order_id: gatewayOrderId, amount: gatewayAmount,
       currency: "INR", status: "captured",
     }), { status: 200, headers: { "Content-Type": "application/json" } });
   }
   return new Response("Not found", { status: 404 });
 };
 let orderId = "";
 try {
   const placed = await request(app)
     .post("/api/v1/shop/orders/public")
     .set("Idempotency-Key", randomUUID())
     .send({
       customer: { name: "Razorpay Test", email: "razorpay@example.test", phone: "9876543210" },
       items: [{ productId, quantity: 2 }],
     })
     .expect(201);
   assert.equal(placed.body.data.checkout.provider, "razorpay");
   assert.equal(placed.body.data.checkout.amountPaise, 25000);
   orderId = String((await pool!.query("SELECT id FROM shop_orders WHERE order_number=$1", [placed.body.data.orderNumber])).rows[0].id);

   const signature = createHmac("sha256", secret)
     .update(`${gatewayOrderId}|${gatewayPaymentId}`)
     .digest("hex");
   const settled = await request(app)
     .post("/api/v1/shop/orders/public/verify-payment")
     .send({
       razorpay_order_id: gatewayOrderId,
       razorpay_payment_id: gatewayPaymentId,
       razorpay_signature: signature,
     })
     .expect(200);
   assert.equal(settled.body.data.status, "confirmed");
   assert.equal(Number(settled.body.data.totalAmount), 250);
   const payment = await pool!.query(
     `SELECT pt.status, pt.signature_verified, so.status AS order_status
      FROM payment_transactions pt JOIN shop_orders so ON so.id=pt.source_id
      WHERE pt.gateway_order_id=$1`,
     [gatewayOrderId],
   );
   assert.equal(payment.rows[0].status, "captured");
   assert.equal(payment.rows[0].signature_verified, true);
   assert.equal(payment.rows[0].order_status, "confirmed");

   gatewayAmount = 1;
   await request(app)
     .post("/api/v1/shop/orders/public/verify-payment")
     .send({
       razorpay_order_id: gatewayOrderId,
       razorpay_payment_id: gatewayPaymentId,
       razorpay_signature: signature,
     })
     .expect(409);
 } finally {
   env.PAYMENT_PROVIDER = previousProvider;
   env.RAZORPAY_KEY_ID = previousKeyId;
   env.RAZORPAY_KEY_SECRET = previousSecret;
   globalThis.fetch = originalFetch;
   if (orderId) {
     await pool!.query("DELETE FROM payment_transactions WHERE source_id=$1", [orderId]);
     await pool!.query("DELETE FROM receipt_records WHERE source_id=$1", [orderId]);
     await pool!.query("DELETE FROM shop_payments WHERE order_id=$1", [orderId]);
     await pool!.query("DELETE FROM shop_order_status_history WHERE order_id=$1", [orderId]);
     await pool!.query("DELETE FROM shop_order_items WHERE order_id=$1", [orderId]);
     await pool!.query("DELETE FROM shop_orders WHERE id=$1", [orderId]);
   }
   await pool!.query("DELETE FROM stock_movements WHERE product_id=$1", [productId]);
   await pool!.query("DELETE FROM shop_products WHERE id=$1", [productId]);
 }
});

test("member signup creates a pending plan and the desk records payment to activate it", { skip: !process.env.DATABASE_URL }, async () => {
  assert.ok(pool);
  env.JWT_SECRET = "a-test-secret-at-least-thirty-two-characters";
  const planCode = `TEST-${randomUUID().replace(/-/g, "").slice(0, 18).toUpperCase()}`;
  const email = `member-${randomUUID()}@example.test`;
  const plan = await pool!.query(
    `INSERT INTO membership_plans (code,name,description,monthly_price,benefits)
     VALUES ($1,'Integration plan','Temporary test plan',1500,'{}'::jsonb) RETURNING id`,
    [planCode],
  );
  let accountId = "";
  let memberId = "";
  let membershipId = "";
  try {
    const registration = await request(app).post("/api/v1/auth/register").send({
      email,
      password: "A-long-safe-password",
      fullName: "Integration Member",
      phone: "9876543211",
      planCode,
    }).expect(201);
    accountId = String(registration.body.data.id);
    assert.equal(registration.body.data.membership.status, "pending");
    const member = await pool!.query("SELECT id FROM members WHERE account_id=$1", [accountId]);
    memberId = String(member.rows[0].id);
    const pending = await pool!.query(
      "SELECT id FROM membership_records WHERE member_id=$1 AND status='pending'",
      [memberId],
    );
    membershipId = String(pending.rows[0].id);

    const token = signToken({
      id: randomUUID(),
      email: "front-desk@example.test",
      fullName: "Front Desk",
      role: "front_desk",
      permissions: ["members.read", "members.write"],
    });
    const directory = await request(app)
      .get("/api/v1/memberships/members")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    assert.ok(directory.body.data.some((row: { membership_id: string }) => row.membership_id === membershipId));

    await request(app)
      .post(`/api/v1/memberships/${membershipId}/activate`)
      .set("Authorization", `Bearer ${token}`)
      .send({ paymentMethod: "upi" })
      .expect(409);
    await request(app)
      .post(`/api/v1/memberships/${membershipId}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const activated = await request(app)
      .post(`/api/v1/memberships/${membershipId}/activate`)
      .set("Authorization", `Bearer ${token}`)
      .send({ paymentMethod: "upi" })
      .expect(200);
    assert.equal(activated.body.data.status, "active");
    assert.equal(activated.body.data.amount, 1500);
    const receipt = await pool!.query(
      "SELECT receipt_number, method, amount FROM receipt_records WHERE source_id=$1",
      [membershipId],
    );
    assert.equal(receipt.rows[0].method, "upi");
    assert.equal(Number(receipt.rows[0].amount), 1500);
    const memberToken = signToken({
      id: accountId,
      email,
      fullName: "Integration Member",
      role: "member",
      permissions: [],
    });
    const activity = await request(app)
      .get("/api/v1/memberships/activity")
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(200);
    assert.equal(activity.body.data.bookings.length, 0);
    assert.equal(activity.body.data.orders.length, 0);
    assert.ok(activity.body.data.payments.some((payment: { reference: string }) =>
      payment.reference === receipt.rows[0].receipt_number));
  } finally {
    if (membershipId) {
      await pool!.query("DELETE FROM receipt_records WHERE source_id=$1", [membershipId]);
      await pool!.query("DELETE FROM membership_history WHERE membership_record_id=$1", [membershipId]);
      await pool!.query("DELETE FROM membership_records WHERE id=$1", [membershipId]);
    }
    if (memberId) await pool!.query("DELETE FROM members WHERE id=$1", [memberId]);
    if (accountId) await pool!.query("DELETE FROM accounts WHERE id=$1", [accountId]);
    await pool!.query("DELETE FROM membership_plans WHERE id=$1", [plan.rows[0].id]);
  }
});

test("approved membership activates only after Razorpay payment is captured", { skip: !process.env.DATABASE_URL }, async () => {
  assert.ok(pool);
  env.JWT_SECRET = "a-test-secret-at-least-thirty-two-characters";
  const previousProvider = env.PAYMENT_PROVIDER;
  const previousKeyId = env.RAZORPAY_KEY_ID;
  const previousSecret = env.RAZORPAY_KEY_SECRET;
  const originalFetch = globalThis.fetch;
  const suffix = randomUUID().replace(/-/g, "");
  const planCode = `RZP-${suffix.slice(0, 18).toUpperCase()}`;
  const email = `razorpay-member-${suffix}@example.test`;
  const plan = await pool!.query(
    `INSERT INTO membership_plans (code,name,description,monthly_price,benefits)
     VALUES ($1,'Razorpay Membership','Temporary test plan',1500,'{}'::jsonb) RETURNING id`,
    [planCode],
  );
  const secret = `membership-test-secret-${suffix}`;
  const gatewayOrderId = `order_${suffix.slice(0, 20)}`;
  const gatewayPaymentId = `pay_${suffix.slice(0, 20)}`;
  const gatewayAmount = 150000;
  env.PAYMENT_PROVIDER = "razorpay";
  env.RAZORPAY_KEY_ID = "rzp_test_playplus";
  env.RAZORPAY_KEY_SECRET = secret;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/v1/orders")) {
      const body = JSON.parse(String(init?.body)) as { amount: number; currency: string };
      return new Response(JSON.stringify({ id: gatewayOrderId, amount: body.amount, currency: body.currency }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/v1/payments/")) {
      return new Response(JSON.stringify({
        id: gatewayPaymentId, order_id: gatewayOrderId, amount: gatewayAmount,
        currency: "INR", status: "captured",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("Not found", { status: 404 });
  };
  let accountId = "";
  let memberId = "";
  let membershipId = "";
  try {
    const registration = await request(app).post("/api/v1/auth/register").send({
      email, password: "A-long-safe-password", fullName: "Razorpay Member", phone: "9876543212", planCode,
    }).expect(201);
    accountId = String(registration.body.data.id);
    const member = await pool!.query("SELECT id FROM members WHERE account_id=$1", [accountId]);
    memberId = String(member.rows[0].id);
    const membership = await pool!.query(
      "SELECT id FROM membership_records WHERE member_id=$1 AND status='pending'",
      [memberId],
    );
    membershipId = String(membership.rows[0].id);
    const staffToken = signToken({
      id: randomUUID(), email: "membership-approver@example.test", fullName: "Approver",
      role: "front_desk", permissions: ["members.write"],
    });
    const memberToken = signToken({
      id: accountId, email, fullName: "Razorpay Member", role: "member", permissions: [],
    });
    await request(app)
      .post(`/api/v1/memberships/${membershipId}/approve`)
      .set("Authorization", `Bearer ${staffToken}`)
      .expect(200);
    const checkout = await request(app)
      .post(`/api/v1/memberships/${membershipId}/checkout`)
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(201);
    assert.equal(checkout.body.data.amountPaise, 150000);
    const signature = createHmac("sha256", secret)
      .update(`${gatewayOrderId}|${gatewayPaymentId}`)
      .digest("hex");
    const activated = await request(app)
      .post(`/api/v1/memberships/${membershipId}/verify-payment`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({
        razorpay_order_id: gatewayOrderId,
        razorpay_payment_id: gatewayPaymentId,
        razorpay_signature: signature,
      })
      .expect(200);
    assert.equal(activated.body.data.status, "active");
    const current = await pool!.query(
      `SELECT mr.status, pt.status AS payment_status, rr.method
       FROM membership_records mr
       JOIN payment_transactions pt ON pt.source_id=mr.id
       JOIN receipt_records rr ON rr.source_id=mr.id
       WHERE mr.id=$1`,
      [membershipId],
    );
    assert.equal(current.rows[0].status, "active");
    assert.equal(current.rows[0].payment_status, "captured");
    assert.equal(current.rows[0].method, "online");
  } finally {
    env.PAYMENT_PROVIDER = previousProvider;
    env.RAZORPAY_KEY_ID = previousKeyId;
    env.RAZORPAY_KEY_SECRET = previousSecret;
    globalThis.fetch = originalFetch;
    if (membershipId) {
      await pool!.query("DELETE FROM payment_transactions WHERE source_id=$1", [membershipId]);
      await pool!.query("DELETE FROM receipt_records WHERE source_id=$1", [membershipId]);
      await pool!.query("DELETE FROM membership_history WHERE membership_record_id=$1", [membershipId]);
      await pool!.query("DELETE FROM membership_records WHERE id=$1", [membershipId]);
    }
    if (memberId) await pool!.query("DELETE FROM members WHERE id=$1", [memberId]);
    if (accountId) await pool!.query("DELETE FROM accounts WHERE id=$1", [accountId]);
    await pool!.query("DELETE FROM membership_plans WHERE id=$1", [plan.rows[0].id]);
  }
});

test("cafeteria POS tabs record orders, payments, and table release", { skip: !process.env.DATABASE_URL }, async () => {
  assert.ok(pool);
  env.JWT_SECRET = "a-test-secret-at-least-thirty-two-characters";
  const suffix = randomUUID();
  const account = await pool!.query(
    `INSERT INTO accounts (email,password_hash,full_name,role_id)
     SELECT $1,'not-a-login-hash','Cafe Test Manager',id FROM roles WHERE name='manager'
     RETURNING id`,
    [`cafe-manager-${suffix}@example.test`],
  );
  const accountId = String(account.rows[0].id);
  const token = signToken({
    id: accountId,
    email: `cafe-manager-${suffix}@example.test`,
    fullName: "Cafe Test Manager",
    role: "manager",
    permissions: ["bar.manage"],
  });
  const table = await pool!.query(
    "INSERT INTO cafeteria_tables (table_number,seats) VALUES ($1,2) RETURNING id",
    [`T-${suffix.slice(0, 8)}`],
  );
  const tableId = String(table.rows[0].id);
  const menu = await pool!.query(
    "INSERT INTO cafeteria_menu_items (name,category,price) VALUES ($1,'Test',75) RETURNING id",
    [`Cafe integration ${suffix.slice(0, 8)}`],
  );
  const menuItemId = String(menu.rows[0].id);
  let tabId = "";
  let orderId = "";
  try {
    const tab = await request(app)
      .post("/api/v1/cafeteria/tabs")
      .set("Authorization", `Bearer ${token}`)
      .send({ tableId, guestName: "Cafe Guest" })
      .expect(201);
    tabId = String(tab.body.data.id);
    assert.equal((await pool!.query("SELECT status FROM cafeteria_tables WHERE id=$1", [tableId])).rows[0].status, "occupied");

    await request(app)
      .patch(`/api/v1/cafeteria/tables/${tableId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "available" })
      .expect(409);

    const order = await request(app)
      .post("/api/v1/cafeteria/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ tabId, tableId, guestName: "Cafe Guest", items: [{ menuItemId, quantity: 2 }] })
      .expect(201);
    orderId = String(order.body.data.id);
    const openTabs = await request(app)
      .get("/api/v1/cafeteria/tabs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    assert.equal(Number(openTabs.body.data.find((row: { id: string }) => row.id === tabId).balance), 150);

    await request(app)
      .post(`/api/v1/cafeteria/tabs/${tabId}/settle`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", randomUUID())
      .send({ method: "card" })
      .expect(200);
    assert.equal((await pool!.query("SELECT status FROM customer_tabs WHERE id=$1", [tabId])).rows[0].status, "settled");
    assert.equal((await pool!.query("SELECT status FROM cafeteria_tables WHERE id=$1", [tableId])).rows[0].status, "available");
  } finally {
    if (tabId) {
      await pool!.query("DELETE FROM receipt_records WHERE source_id=$1", [tabId]);
      await pool!.query("DELETE FROM cafeteria_payments WHERE tab_id=$1", [tabId]);
    }
    if (orderId) {
      await pool!.query("DELETE FROM cafeteria_order_items WHERE order_id=$1", [orderId]);
      await pool!.query("DELETE FROM cafeteria_orders WHERE id=$1", [orderId]);
    }
    if (tabId) await pool!.query("DELETE FROM customer_tabs WHERE id=$1", [tabId]);
    await pool!.query("DELETE FROM cafeteria_menu_items WHERE id=$1", [menuItemId]);
    await pool!.query("DELETE FROM cafeteria_tables WHERE id=$1", [tableId]);
    await pool!.query("DELETE FROM accounts WHERE id=$1", [accountId]);
  }
});
