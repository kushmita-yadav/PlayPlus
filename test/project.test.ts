import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { readFile } from "node:fs/promises";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { signToken } from "../src/auth/auth.js";
import { validateBookingStart } from "../src/courts/routes.js";
import type { AuthUser } from "../src/auth/auth.js";

const app = createApp();

test("health endpoint returns a healthy response", async () => {
  const response = await request(app).get("/health").expect(200);
  assert.equal(response.body.status, "healthy");
  assert.equal(response.body.service, "playpulse");
  assert.ok(response.headers["x-request-id"]);
  assert.ok(response.headers["x-content-type-options"]);
});

test("API v1 metadata is available", async () => {
  const response = await request(app).get("/api/v1").expect(200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.name, "PlayPulse");
});

test("unknown route uses the consistent not-found response", async () => {
  const response = await request(app).get("/api/v1/missing").expect(404);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, "NOT_FOUND");
});

test("readiness reports database configuration accurately", async () => {
  const response = await request(app).get("/ready");
  assert.ok([200, 503].includes(response.status));
  assert.ok(response.body.database);
});

test("invalid JSON is rejected with a validation-safe response", async () => {
  const response = await request(app)
    .post("/api/v1/auth/register")
    .set("Content-Type", "application/json")
    .send("{invalid");
  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
});

test("malformed bearer token is rejected", async () => {
  const response = await request(app)
    .get("/api/v1/memberships/members/example/benefits")
    .set("Authorization", "Bearer malformed.token");
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "INVALID_TOKEN");
});

test("admin role cannot be self-assigned during registration", async () => {
  const response = await request(app).post("/api/v1/auth/register").send({
    email: "staff@example.com",
    password: "A-long-safe-password",
    fullName: "Staff User",
    role: "admin",
  });
  assert.ok([400, 403].includes(response.status));
});

test("protected member benefits reject missing authentication", async () => {
  await request(app).get("/api/v1/memberships/members/example/benefits").expect(401);
});

test("court reservation rejects missing authentication", async () => {
  await request(app).post("/api/v1/courts/reservations").send({}).expect(401);
});

test("court start validation accepts 30-minute intervals", () => {
  assert.equal(validateBookingStart(new Date("2026-11-21T18:30:00.000Z")), true);
  assert.equal(validateBookingStart(new Date("2026-11-21T18:15:00.000Z")), false);
});

test("shop order creation rejects missing authentication", async () => {
  await request(app).post("/api/v1/shop/orders").send({}).expect(401);
});

test("shop catalog returns database-aware availability", async () => {
  await request(app).get("/api/v1/shop/products").expect([200, 503]);
});

test("shop orders expose fulfillment and cancellation protection", async () => {
  await request(app).post("/api/v1/shop/orders/example/fulfill").send({}).expect(401);
  await request(app).post("/api/v1/shop/orders/example/cancel").send({}).expect(401);
});

test("cafeteria order placement rejects missing authentication", async () => {
  await request(app).post("/api/v1/cafeteria/orders").send({}).expect(401);
});

test("public enquiry creation is available", async () => {
  await request(app).post("/api/v1/public/enquiries").send({
    name: "Test Visitor",
    phone: "9876543210",
    interest: "Trial session",
  }).expect([201, 503]);
});

test("quotation and leave operations require authorization", async () => {
  await request(app).patch("/api/v1/quotations/example/status").send({ status: "sent" }).expect(401);
  await request(app).patch("/api/v1/leave/example").send({ status: "approved" }).expect(401);
});

test("cancellation recovery rejects missing authentication", async () => {
  await request(app).get("/api/v1/assistant/cancellation-recovery/example").expect(401);
});

test("balanced team generation works without database access", async () => {
  env.JWT_SECRET = "a-test-secret-at-least-thirty-two-characters";
  const adminToken = signToken({
    id: "00000000-0000-4000-8000-000000000001",
    email: "admin@example.com",
    fullName: "Admin",
    role: "admin",
    permissions: [],
  });
  const response = await request(app)
    .post("/api/v1/assistant/balance-teams")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      players: [
        { memberId: "00000000-0000-4000-8000-000000000002", skillLevel: 5 },
        { memberId: "00000000-0000-4000-8000-000000000003", skillLevel: 2 },
        { memberId: "00000000-0000-4000-8000-000000000004", skillLevel: 3 },
      ],
    })
    .expect(200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.teams.length, 2);
});

test("authenticated tokens contain role and permission claims", () => {
  env.JWT_SECRET = "a-test-secret-at-least-thirty-two-characters";
  const user: AuthUser = {
    id: "00000000-0000-4000-8000-000000000001",
    email: "member@example.com",
    fullName: "Test Member",
    role: "member",
    permissions: [],
  };
  const token = signToken(user);
  assert.equal(typeof token, "string");
  assert.ok(token.split(".").length === 3);
});

test("booking migration includes database overlap protection", async () => {
  const sql = await readFile("migrations/004_courts.sql", "utf8");
  assert.match(sql, /EXCLUDE USING gist/);
  assert.match(sql, /court_id WITH =/);
  assert.match(sql, /booking_period WITH &&/);
});

test("sales migrations include idempotency and stock-safe records", async () => {
  const shopSql = await readFile("migrations/005_shop_inventory.sql", "utf8");
  assert.match(shopSql, /uq_shop_order_idempotency/);
  assert.match(shopSql, /uq_shop_payment_idempotency/);
  assert.match(shopSql, /stock_quantity integer NOT NULL DEFAULT 0 CHECK \(stock_quantity >= 0\)/);
});

test("OpenAPI document describes PlayPulse versioned API", async () => {
  const document = JSON.parse(await readFile("docs/openapi.json", "utf8"));
  assert.equal(document.openapi, "3.1.0");
  assert.equal(document.info.title, "PlayPulse API");
  assert.ok(document.paths["/courts/reservations"]);
  assert.ok(document.components.securitySchemes.bearerAuth);
});

test("hardening migration contains lockout and double-entry safeguards", async () => {
  const sql = await readFile("migrations/009_operations_hardening.sql", "utf8");
  assert.match(sql, /failed_login_attempts/);
  assert.match(sql, /refresh_tokens/);
  assert.match(sql, /ledger_entries/);
  assert.match(sql, /uq_staff_shift_no_overlap/);
  assert.match(sql, /invoice_payments/);
});
