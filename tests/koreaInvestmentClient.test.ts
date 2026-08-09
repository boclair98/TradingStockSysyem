import assert from "node:assert/strict";
import test from "node:test";
import { getKisAccount, getKisQuote, issueKisToken, submitKisCashOrder, type KisCredentials } from "../engine/koreaInvestmentClient";

const credentials: KisCredentials = { appKey: "test-app-key-12345", appSecret: "test-app-secret-12345", accountNumber: "12345678", productCode: "01", htsId: "tester" };

test("KIS adapter maps token, quote and balance responses without network access", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push({ url, init });
    if (url.endsWith("/oauth2/tokenP")) return Response.json({ access_token: "mock-token", expires_in: 3600 });
    if (url.includes("/inquire-price")) return Response.json({ rt_cd: "0", output: { stck_prpr: "71000", bidp1: "70900", askp1: "71100", prdy_ctrt: "1.25", acml_vol: "123456" } });
    if (url.includes("/inquire-balance")) return Response.json({ rt_cd: "0", output1: [{ pdno: "005930", prdt_name: "삼성전자", hldg_qty: "2", ord_psbl_qty: "1", pchs_avg_pric: "70000", prpr: "71000", evlu_amt: "142000", evlu_pfls_amt: "2000" }], output2: [{ dnca_tot_amt: "500000", tot_evlu_amt: "642000", nass_amt: "642000", pchs_amt_smtl_amt: "140000", evlu_pfls_smtl_amt: "2000" }] });
    throw new Error(`unexpected mocked request: ${url}`);
  };
  try {
    const token = await issueKisToken(credentials, "sandbox");
    assert.equal(token.accessToken, "mock-token");
    const quote = await getKisQuote(credentials, "sandbox", token.accessToken, "005930", "UNIFIED");
    assert.equal(quote.lastPrice, 71000); assert.equal(quote.bestAsk, 71100);
    const account = await getKisAccount(credentials, "sandbox", token.accessToken);
    assert.equal(account.deposit, 500000); assert.equal(account.positions[0]?.availableQuantity, 1);
    assert.ok(calls.some((call) => call.url.includes("FID_COND_MRKT_DIV_CODE=UN")));
    assert.ok(calls.some((call) => call.init?.headers && (call.init.headers as Record<string, string>).tr_id === "VTTC8434R"));
  } finally { globalThis.fetch = originalFetch; }
});

test("cash-order mapping uses hashkey and the correct production buy transaction ID", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit; body?: Record<string, string> }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); const body = init?.body ? JSON.parse(String(init.body)) as Record<string, string> : undefined; calls.push({ url, init, body });
    if (url.endsWith("/uapi/hashkey")) return Response.json({ HASH: "mock-hash" });
    if (url.endsWith("/order-cash")) return Response.json({ rt_cd: "0", msg_cd: "0", msg1: "주문 접수", output: { ODNO: "0000123456", KRX_FWDG_ORD_ORGNO: "91234", ORD_TMD: "101530" } });
    throw new Error(`unexpected mocked request: ${url}`);
  };
  try {
    const receipt = await submitKisCashOrder(credentials, "production", "mock-token", { symbol: "005930", side: "BUY", orderType: "LIMIT", timeInForce: "IOC", venue: "SOR", quantity: 2, price: 71000 });
    assert.equal(receipt.brokerOrderId, "0000123456");
    const orderCall = calls.find((call) => call.url.endsWith("/order-cash"));
    assert.equal((orderCall?.init?.headers as Record<string, string>).tr_id, "TTTC0012U");
    assert.equal((orderCall?.init?.headers as Record<string, string>).hashkey, "mock-hash");
    assert.deepEqual({ ORD_DVSN: orderCall?.body?.ORD_DVSN, ORD_QTY: orderCall?.body?.ORD_QTY, ORD_UNPR: orderCall?.body?.ORD_UNPR, EXCG_ID_DVSN_CD: orderCall?.body?.EXCG_ID_DVSN_CD }, { ORD_DVSN: "11", ORD_QTY: "2", ORD_UNPR: "71000", EXCG_ID_DVSN_CD: "SOR" });
  } finally { globalThis.fetch = originalFetch; }
});
