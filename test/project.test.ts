import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";

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
