import assert from "node:assert/strict";
import test from "node:test";
import { getNextradeReadiness } from "../engine/nextradeGateway.ts";

test("NEXTRADE defaults to paper-only mode without credentials", () => {
  const readiness = getNextradeReadiness({});
  assert.equal(readiness.mode, "disabled");
  assert.equal(readiness.status, "paper_only");
  assert.equal(readiness.configured, false);
  assert.deepEqual(readiness.missing, []);
});

test("NEXTRADE sandbox reports missing connection settings without exposing secrets", () => {
  const readiness = getNextradeReadiness({ NEXTRADE_MODE: "sandbox", NEXTRADE_API_KEY: "test-key" });
  assert.equal(readiness.status, "blocked");
  assert.equal(readiness.configured, false);
  assert.equal(readiness.missing.includes("NEXTRADE_API_KEY"), false);
  assert.equal(readiness.missing.includes("NEXTRADE_API_SECRET"), true);
});
