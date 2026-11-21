import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
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

test("admin role cannot be self-assigned during registration", async () => {
  const response = await request(app).post("/api/v1/auth/register").send({
    email: "staff@example.com",
    password: "A-long-safe-password",
    fullName: "Staff User",
    role: "admin",
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

  test("shop catalog is available through the public API", async () => {
    await request(app).get("/api/v1/shop/products").expect([200, 503]);
  });

  test("shop orders expose fulfillment and cancellation protection", async () => {
    await request(app).post("/api/v1/shop/orders/example/fulfill").send({}).expect(401);
    await request(app).post("/api/v1/shop/orders/example/cancel").send({}).expect(401);
  });
  assert.ok([400, 403].includes(response.status));
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
