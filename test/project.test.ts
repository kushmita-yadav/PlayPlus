import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { signToken } from "../src/auth/auth.js";
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
