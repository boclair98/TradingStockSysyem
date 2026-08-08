import assert from "node:assert/strict";
import test from "node:test";
import { getBrokerReadiness, redactBrokerConfig, toBrokerOrderEnvelope } from "../engine/brokerGateway.ts";

test("broker gateway defaults to safe paper mode", () => {
  const readiness = getBrokerReadiness({});
  assert.equal(readiness.provider, "paper");
  assert.equal(readiness.mode, "paper");
  assert.equal(readiness.status, "paper_only");
  assert.equal(readiness.capabilities.orderSubmit, true);
  assert.equal(readiness.capabilities.realtimeQuotes, false);
});

test("selected securities company reports missing sandbox configuration", () => {
  const readiness = getBrokerReadiness({ BROKER_PROVIDER: "korea_investment", BROKER_MODE: "sandbox" });
  assert.equal(readiness.provider, "korea_investment");
  assert.equal(readiness.status, "blocked");
  assert.ok(readiness.missing.includes("BROKER_API_BASE_URL"));
  assert.ok(readiness.missing.includes("BROKER_APP_SECRET"));
});

test("configured broker reports adapter pending without exposing secrets", () => {
  const env = {
    BROKER_PROVIDER: "kiwoom",
    BROKER_MODE: "sandbox",
    BROKER_API_BASE_URL: "https://sandbox.example.test",
    BROKER_WEBSOCKET_URL: "wss://sandbox.example.test/quotes",
    BROKER_APP_KEY: "secret-key",
    BROKER_APP_SECRET: "secret-value",
    BROKER_ACCOUNT_ID: "00000000",
    BROKER_VENUE_PREFERENCE: "NEXTRADE",
  };
  const readiness = getBrokerReadiness(env);
  const redacted = redactBrokerConfig(env);
  assert.equal(readiness.status, "adapter_pending");
  assert.equal(readiness.venuePreference, "NEXTRADE");
  assert.equal(redacted.credentialsConfigured, true);
  assert.equal(JSON.stringify(redacted).includes("secret-value"), false);
});

test("normalized order envelope carries broker venue preference", () => {
  const envelope = toBrokerOrderEnvelope({
    id: "CLIENT-1",
    symbol: "005930",
    participantId: "paper-user",
    side: "BUY",
    type: "LIMIT",
    timeInForce: "GTC",
    price: 70000,
    quantity: 10,
    venuePreference: "AUTO",
    accountId: "ACCOUNT-1",
  });
  assert.equal(envelope.clientOrderId, "CLIENT-1");
  assert.equal(envelope.venuePreference, "AUTO");
  assert.equal(envelope.accountId, "ACCOUNT-1");
});
