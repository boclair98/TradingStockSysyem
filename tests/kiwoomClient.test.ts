import assert from "node:assert/strict";
import test from "node:test";
import { cancelKiwoomOrder, getKiwoomAccount, getKiwoomAccountNumber, getKiwoomOrders, getKiwoomQuote, issueKiwoomToken, KiwoomApiError, submitKiwoomCashOrder, type KiwoomCredentials } from "../engine/kiwoomClient";

const credentials: KiwoomCredentials = { appKey: "kiwoom-app-key", secretKey: "kiwoom-secret-key", accountNo: "1234567890" };

test("Kiwoom adapter maps official token, account, quote and holdings fields", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ apiId: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = init?.headers as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ apiId: headers?.["api-id"] ?? "token", body });
    if (url.endsWith("/oauth2/token")) return Response.json({ token: "kw-token", expires_dt: "20260816090000", return_code: 0 });
    if (headers["api-id"] === "ka00001") return Response.json({ acctNo: "1234567890", return_code: 0 });
    if (headers["api-id"] === "ka10001") return Response.json({ cur_prc: "+71000", flu_rt: "+1.40", trde_qty: "123456", return_code: 0 });
    if (headers["api-id"] === "ka10004") return Response.json({ buy_fpr_bid: "+70900", sel_fpr_bid: "+71100", return_code: 0 });
    if (headers["api-id"] === "kt00001") return Response.json({ ord_alow_amt: "000000000500000", return_code: 0 });
    if (headers["api-id"] === "kt00018") return Response.json({ tot_pur_amt: "140000", tot_evlt_amt: "142000", tot_evlt_pl: "+2000", prsm_dpst_aset_amt: "642000", acnt_evlt_remn_indv_tot: [{ stk_cd: "A005930", stk_nm: "삼성전자", rmnd_qty: "2", trde_able_qty: "2", pur_pric: "70000", cur_prc: "+71000", evlt_amt: "142000", evltv_prft: "+2000" }], return_code: 0 });
    throw new Error(`unexpected mocked request: ${url}`);
  };
  try {
    const token = await issueKiwoomToken(credentials, "production");
    assert.equal(token.accessToken, "kw-token");
    assert.equal(await getKiwoomAccountNumber("production", token.accessToken), "1234567890");
    const quote = await getKiwoomQuote(credentials, "production", token.accessToken, "005930", "SOR");
    assert.equal(quote.lastPrice, 71000); assert.equal(quote.bestBid, 70900); assert.equal(quote.bestAsk, 71100);
    const account = await getKiwoomAccount(credentials, "production", token.accessToken);
    assert.equal(account.deposit, 500000); assert.equal(account.positions[0]?.symbol, "005930"); assert.equal(account.positions[0]?.availableQuantity, 2);
    assert.deepEqual(calls.find((call) => call.apiId === "ka10001")?.body, { stk_cd: "005930_AL" });
  } finally { globalThis.fetch = originalFetch; }
});

test("Kiwoom adapter maps cash orders, cancellation and reconciliation", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ apiId: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (_input, init) => {
    const headers = init?.headers as Record<string, string>;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ apiId: headers["api-id"], body });
    if (headers["api-id"] === "kt10000") return Response.json({ ord_no: "10001", return_code: 0, return_msg: "정상" });
    if (headers["api-id"] === "kt10003") return Response.json({ ord_no: "10002", base_orig_ord_no: "10001", return_code: 0 });
    if (headers["api-id"] === "ka10076") return Response.json({ cntr: [{ ord_no: "10001", ord_stt: "일부체결", cntr_qty: "1", oso_qty: "1", cntr_pric: "+71000" }, { ord_no: "10001", ord_stt: "체결", cntr_qty: "1", oso_qty: "0", cntr_pric: "+71100" }], return_code: 0 });
    throw new Error(`unexpected mocked api: ${headers["api-id"]}`);
  };
  try {
    const receipt = await submitKiwoomCashOrder(credentials, "production", "token", { symbol: "005930", side: "BUY", orderType: "LIMIT", timeInForce: "IOC", venue: "SOR", quantity: 2, price: 71000 });
    assert.equal(receipt.brokerOrderId, "10001");
    assert.deepEqual(calls[0]?.body, { dmst_stex_tp: "SOR", stk_cd: "005930", ord_qty: "2", ord_uv: "71000", trde_tp: "10", cond_uv: "" });
    const cancelled = await cancelKiwoomOrder(credentials, "production", "token", { brokerOrderId: "10001", symbol: "005930", venue: "SOR" });
    assert.equal(cancelled.brokerOrgNo, "10002"); assert.equal(calls[1]?.body.cncl_qty, "0");
    const orders = await getKiwoomOrders(credentials, "production", "token");
    assert.equal(orders[0]?.filledQuantity, 2); assert.equal(orders[0]?.averageFilledPrice, 71050); assert.equal(orders[0]?.remainingQuantity, 0);
    await assert.rejects(() => submitKiwoomCashOrder(credentials, "sandbox", "token", { symbol: "005930", side: "BUY", orderType: "MARKET", timeInForce: "DAY", venue: "NXT", quantity: 1, price: null }), (error: unknown) => error instanceof KiwoomApiError && error.code === "MOCK_KRX_ONLY");
  } finally { globalThis.fetch = originalFetch; }
});
