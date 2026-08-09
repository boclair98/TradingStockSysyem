import assert from "node:assert/strict";
import test from "node:test";
import { computeAuditEntryHash } from "../db/trading.js";

test("audit entry hashes are deterministic and detect payload changes", async () => {
  const timestamp = "2026-08-09T00:00:00.000Z";
  const original = await computeAuditEntryHash("GENESIS", "user-1", "ORDER_ACCEPTED", "order-1", '{"quantity":10}', timestamp);
  const repeated = await computeAuditEntryHash("GENESIS", "user-1", "ORDER_ACCEPTED", "order-1", '{"quantity":10}', timestamp);
  const tampered = await computeAuditEntryHash("GENESIS", "user-1", "ORDER_ACCEPTED", "order-1", '{"quantity":11}', timestamp);
  assert.equal(original, repeated);
  assert.notEqual(original, tampered);
  assert.match(original, /^[a-f0-9]{64}$/);
});
