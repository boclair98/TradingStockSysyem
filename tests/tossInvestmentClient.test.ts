import assert from "node:assert/strict";
import test from "node:test";
import { cancelTossOrder, getTossAccount, getTossAccounts, getTossOrders, getTossQuote, issueTossToken, submitTossCashOrder, TossApiError, type TossCredentials } from "../engine/tossInvestmentClient";

const credentials: TossCredentials = { clientId: "client-id-12345", clientSecret: "client-secret-12345", accountSeq: 7, accountNo: "1234567890" };

test("Toss adapter maps token, account, quote and holdings without network access", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push({ url, init });
    if (url.endsWith("/oauth2/token")) return Response.json({ access_token: "toss-token", expires_in: 3600 });
    if (url.endsWith("/api/v1/accounts")) return Response.json({ result: [{ accountNo: "1234567890", accountSeq: 7, accountType: "BROKERAGE" }] });
    if (url.includes("/api/v1/prices")) return Response.json({ result: [{ symbol: "005930", lastPrice: "71000", timestamp: "2026-08-15T09:00:00+09:00" }] });
    if (url.includes("/api/v1/orderbook")) return Response.json({ result: { asks: [{ price: "71100" }], bids: [{ price: "70900" }] } });
    if (url.endsWith("/api/v1/holdings")) return Response.json({ result: { marketValue: { amount: { krw: "142000" } }, totalPurchaseAmount: { krw: "140000" }, profitLoss: { amount: { krw: "2000" } }, items: [{ marketCountry: "KR", symbol: "005930", name: "삼성전자", quantity: "2", averagePurchasePrice: "70000", lastPrice: "71000", marketValue: { amount: "142000" }, profitLoss: { amount: "2000" } }] } });
    if (url.includes("/api/v1/buying-power")) return Response.json({ result: { cashBuyingPower: "500000" } });
    throw new Error(`unexpected mocked request: ${url}`);
  };
  try {
    const token = await issueTossToken(credentials);
    assert.equal(token.accessToken, "toss-token");
    assert.equal((await getTossAccounts(token.accessToken))[0]?.accountSeq, 7);
    const quote = await getTossQuote(credentials, token.accessToken, "005930");
    assert.equal(quote.lastPrice, 71000); assert.equal(quote.bestAsk, 71100);
    const account = await getTossAccount(credentials, token.accessToken);
    assert.equal(account.deposit, 500000); assert.equal(account.positions[0]?.quantity, 2);
    assert.ok(calls.some((call) => (call.init?.headers as Record<string, string>)?.["X-Tossinvest-Account"] === "7"));
  } finally { globalThis.fetch = originalFetch; }
});

test("Toss order adapter enforces SOR and DAY, maps submit, cancel and reconciliation", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, body });
    if (url.endsWith("/api/v1/orders")) return Response.json({ result: { orderId: "ORDER-1" } });
    if (url.endsWith("/api/v1/orders/ORDER-1/cancel")) return Response.json({ result: { orderId: "CANCEL-1" } });
    if (url.includes("status=OPEN")) return Response.json({ result: { orders: [{ orderId: "ORDER-1", status: "PARTIAL_FILLED", execution: { filledQuantity: "1", averageFilledPrice: "71000" } }] } });
    if (url.includes("status=CLOSED")) return Response.json({ result: { orders: [] } });
    throw new Error(`unexpected mocked request: ${url}`);
  };
  try {
    await assert.rejects(() => submitTossCashOrder(credentials, "token", { clientOrderId: "client", symbol: "005930", side: "BUY", orderType: "LIMIT", timeInForce: "DAY", venue: "NXT", quantity: 2, price: 71000 }), (error: unknown) => error instanceof TossApiError && error.code === "TOSS_SOR_REQUIRED");
    const receipt = await submitTossCashOrder(credentials, "token", { clientOrderId: "client", symbol: "005930", side: "BUY", orderType: "LIMIT", timeInForce: "DAY", venue: "SOR", quantity: 2, price: 71000 });
    assert.equal(receipt.brokerOrderId, "ORDER-1");
    assert.deepEqual(calls.find((call) => call.url.endsWith("/api/v1/orders"))?.body, { clientOrderId: "client", symbol: "005930", side: "BUY", orderType: "LIMIT", timeInForce: "DAY", quantity: "2", confirmHighValueOrder: false, price: "71000" });
    assert.equal((await cancelTossOrder(credentials, "token", "ORDER-1")).brokerOrgNo, "CANCEL-1");
    const orders = await getTossOrders(credentials, "token");
    assert.equal(orders[0]?.status, "PARTIAL_FILLED"); assert.equal(orders[0]?.filledQuantity, 1);
  } finally { globalThis.fetch = originalFetch; }
});
