import assert from "node:assert/strict";
import test from "node:test";
import { projectName } from "../src/server.js";

test("project identity is initialized", () => {
  assert.equal(projectName(), "PlayPulse");
});
