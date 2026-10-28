import assert from "node:assert/strict";
import test from "node:test";
import { hashPaperOrderIntent, paperOrderIdFor, type PaperOrderIntent } from "../engine/paperOrderIdentity";

const intent: PaperOrderIntent = {
  symbol: "005930",
  side: "BUY",
  type: "LIMIT",
  timeInForce: "GTC",
  price: 70_000,
  stopPrice: null,
  quantity: 3,
};

test("paper order identity is stable across a normal idempotent retry", async () => {
  assert.equal(await paperOrderIdFor("user-a", "retry-key"), await paperOrderIdFor("user-a", "retry-key"));
  assert.equal(await hashPaperOrderIntent(intent), await hashPaperOrderIntent({ ...intent }));
});

test("paper order identity is isolated by user and semantic changes alter the request hash", async () => {
  assert.notEqual(await paperOrderIdFor("user-a", "shared-key"), await paperOrderIdFor("user-b", "shared-key"));
  assert.notEqual(await hashPaperOrderIntent(intent), await hashPaperOrderIntent({ ...intent, quantity: 4 }));
});
