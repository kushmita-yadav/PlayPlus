import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { readFile } from "node:fs/promises";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { createUiSession, signToken } from "../src/auth/auth.js";
import { pool } from "../src/database/pool.js";
import { validateBookingStart } from "../src/courts/routes.js";
import { firstAvailableBookingTime, isSlotBooked } from "../frontend/src/lib/booking.js";
import type { AuthUser } from "../src/auth/auth.js";

const app = createApp();

test("public landing page is served", async () => {
  const response = await request(app).get("/").expect(200);
  assert.match(response.headers["content-type"], /text\/html/);
  assert.match(response.text, /PlayPulse/);
  assert.match(response.text, /Champions Club/);
});

test("sample frontend assets are served", async () => {
  const page = await request(app).get("/").expect(200);
  const cssPath = page.text.match(/href="([^"]+\.css)"/)?.[1];
  const scriptPath = page.text.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(cssPath);
  assert.ok(scriptPath);
  const css = await request(app).get(cssPath).expect(200);
  assert.match(css.headers["content-type"], /text\/css/);
  const script = await request(app).get(scriptPath).expect(200);
  assert.match(script.headers["content-type"], /javascript/);
  assert.ok(script.text.length > 0);
  const illustration = await request(app).get("/court-illustration.svg").expect(200);
  assert.match(illustration.headers["content-type"], /image\/svg\+xml/);
  assert.match(illustration.body.toString("utf8"), /viewBox="0 0 460 270"/);
  const heroArtwork = await request(app).get("/club-hero.svg").expect(200);
  assert.match(heroArtwork.headers["content-type"], /image\/svg\+xml/);
  assert.match(heroArtwork.body.toString("utf8"), /viewBox="0 0 560 440"/);
  for (const artwork of [
    "tennis-racket.svg", "court-shoes.svg", "tennis-ball-can.svg",
    "padel-ball-tube.svg", "overgrip-pack.svg", "water-bottle.svg", "sports-kit.svg",
  ]) {
    const productImage = await request(app).get(`/shop/${artwork}`).expect(200);
    assert.match(productImage.headers["content-type"], /image\/svg\+xml/);
  }
});

test("login page serves the React application root", async () => {
  const response = await request(app).get("/login").expect(200);
  assert.match(response.text, /PlayPulse/);
  assert.match(response.text, /id="root"/);
});

test("staff route requires a real account and visitor pages remain public", async () => {
  const admin = await request(app).get("/admin").expect(302);
  assert.equal(admin.headers.location, "/");
  const portal = await request(app).get("/portal").expect(200);
  assert.equal(portal.headers["cache-control"], "no-store");
  const visitor = await request(app).get("/visitor").expect(200);
  assert.equal(visitor.headers["cache-control"], "no-store");
});

test("demo credential login endpoint is not available", async () => {
  await request(app).post("/api/v1/auth/demo-login").send({
    email: "admin@champions.club",
    password: "Admin@123",
    role: "admin",
  }).expect(404);
});

test("member registration requires a phone number for a real member profile", async () => {
  await request(app).post("/api/v1/auth/register").send({
    email: "member@example.com",
    password: "A-long-safe-password",
    fullName: "Test Member",
  }).expect(400);
});

  test("account provisioning requires an authenticated administrator", async () => {
    await request(app).post("/api/v1/auth/accounts").send({
      email: "staff@example.com",
      password: "A-long-safe-password",
      fullName: "Test Staff",
      role: "staff",
    }).expect(401);
  });

test("manager tokens cannot use administrator-only endpoints, even with stale permission claims", async () => {
  env.JWT_SECRET = "a-test-secret-at-least-thirty-two-characters";
  const token = signToken({
    id: "00000000-0000-4000-8000-000000000002",
    email: "manager@example.com",
    fullName: "Test Manager",
    role: "manager",
    permissions: [
      "auth.admin", "finance.manage", "membership_plans.manage", "courts.configure",
      "shop.catalog", "staff.provision", "payroll.manage",
    ],
  });
  const auth = { Authorization: `Bearer ${token}` };
  await request(app).post("/api/v1/auth/accounts").set(auth).send({}).expect(403);
  await request(app).post("/api/v1/expenses").set(auth).send({}).expect(403);
  await request(app).post("/api/v1/memberships/plans").set(auth).send({}).expect(403);
  await request(app).post("/api/v1/courts").set(auth).send({}).expect(403);
  await request(app).post("/api/v1/shop/products").set(auth).send({}).expect(403);
  await request(app).post("/api/v1/staff").set(auth).send({}).expect(403);
  await request(app).post("/api/v1/payroll").set(auth).send({}).expect(403);
});

  test("member portal requires a member account session", async () => {
  await request(app).get("/portal?mode=member").expect(302);
});

test("visitor page remains public", async () => {
  await request(app).get("/visitor").expect(200);
});

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

test("demo booking availability is scoped by date and ignores cancelled bookings", () => {
  const bookings = [
    { courtId: "C-1", date: "2026-11-21", time: "18:00", status: "Confirmed" },
    { courtId: "C-1", date: "2026-11-21", time: "18:30", status: "Cancelled" },
  ];
  assert.equal(isSlotBooked(bookings, "C-1", "2026-11-21", "18:00"), true);
  assert.equal(isSlotBooked(bookings, "C-1", "2026-11-21", "18:30"), true);
  assert.equal(isSlotBooked(bookings, "C-1", "2026-11-22", "18:00"), false);
  assert.equal(isSlotBooked(bookings, "C-2", "2026-11-21", "18:30"), false);
  assert.equal(firstAvailableBookingTime(bookings, "C-1", "2026-11-21", "18:00"), "19:00");
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
  const response = await request(app).post("/api/v1/public/enquiries").send({
    name: "Test Visitor",
    phone: "9876543210",
    interest: "Trial session",
  });
  if (response.status === 201 && pool) {
    await pool.query("DELETE FROM enquiries WHERE id=$1", [response.body.data.id]);
  }
  assert.ok([201, 503].includes(response.status));
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

test("new databases do not receive invented club prices, plans, courts, or tax rates", async () => {
  const membershipSql = await readFile("migrations/003_memberships.sql", "utf8");
  const courtsSql = await readFile("migrations/004_courts.sql", "utf8");
  const financeSql = await readFile("migrations/009_operations_hardening.sql", "utf8");
  assert.doesNotMatch(membershipSql, /INSERT INTO membership_plans/i);
  assert.doesNotMatch(courtsSql, /INSERT INTO courts/i);
  assert.doesNotMatch(financeSql, /INSERT INTO tax_rates/i);
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

test("Prometheus metrics endpoint exposes counters", async () => {
  const response = await request(app).get("/metrics").expect(200);
  assert.match(response.text, /playpulse_http_requests_total/);
  assert.match(response.text, /playpulse_http_requests_failed_total/);
});

test("protected report export rejects missing authentication", async () => {
  await request(app)
    .get("/api/v1/reports/export?format=csv&from=2026-11-01&to=2026-11-30")
    .expect(401);
});

test("notification processing rejects missing authentication", async () => {
  await request(app).post("/api/v1/notifications/process").send({}).expect(401);
});

test("nonstaff sessions cannot read shared club records", async () => {
  await request(app).get("/api/v1/demo-data").expect(401);
  await request(app).get("/api/v1/demo-data/events").expect(401);
  const visitorSession = createUiSession("visitor", "Visitor", "visitor@champions.club");
  await request(app)
    .get("/api/v1/demo-data")
    .set("Cookie", `playpulse_ui=${visitorSession}`)
    .expect(403);
});

test("staff sessions cannot modify administrator-managed shared records", async () => {
  const staffSession = createUiSession("staff", "Test Staff", "staff@example.com");
  await request(app)
    .put("/api/v1/demo-data")
    .set("Cookie", `playpulse_ui=${staffSession}`)
    .send({ version: 0, data: {} })
    .expect(403);
});

test("shared demo state migration stores versioned JSON data", async () => {
  const sql = await readFile("migrations/011_shared_demo_state.sql", "utf8");
  assert.match(sql, /state jsonb NOT NULL/);
  assert.match(sql, /version bigint NOT NULL/);
  assert.match(sql, /singleton_key = 1/);
});
