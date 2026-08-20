import assert from "node:assert/strict";
import test from "node:test";
import { canonicalGatewayPayload, validateMemberMessage, verifyGatewaySignature, type MemberOrderMessage } from "../engine/memberGateway";

const message = (overrides: Partial<MemberOrderMessage> = {}): MemberOrderMessage => ({ messageType: "D", memberId: "MEMB01", sessionId: "SESSION-0001", sequence: 1, clientOrderId: "CLIENT-1", symbol: "005930", side: "BUY", orderType: "LIMIT", timeInForce: "GTC", price: 70000, quantity: 10, sentAt: new Date(1_800_000_000_000).toISOString(), ...overrides });

test("member gateway requires contiguous inbound sequence", () => {
  const result = validateMemberMessage(message({ sequence: 3 }), 2, 1_800_000_000_000);
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.code, "SEQUENCE_GAP"); assert.equal(result.expectedSequence, 2); }
});

test("member gateway rejects stale timestamps", () => {
  const result = validateMemberMessage(message({ sentAt: new Date(1_799_999_900_000).toISOString() }), 1, 1_800_000_000_000);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "CLOCK_SKEW");
});

test("member gateway verifies canonical HMAC signatures", async () => {
  const payload = message();
  const secret = "certification-member-secret";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonicalGatewayPayload(payload))))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  assert.equal(await verifyGatewaySignature(payload, signature, secret), true);
  assert.equal(await verifyGatewaySignature({ ...payload, quantity: 11 }, signature, secret), false);
});
