export type KiwoomMode = "sandbox" | "production";
export type KiwoomVenue = "KRX" | "NXT" | "SOR";

export type KiwoomCredentials = {
  appKey: string;
  secretKey: string;
  accountNo: string;
};

export type KiwoomToken = { accessToken: string; expiresAt: string };
export type KiwoomAccountSnapshot = {
  deposit: number;
  totalEvaluation: number;
  netAsset: number;
  purchaseAmount: number;
  profitLoss: number;
  positions: Array<{
    symbol: string;
    name: string;
    quantity: number;
    availableQuantity: number;
    averagePrice: number;
    currentPrice: number;
    evaluationAmount: number;
    profitLoss: number;
  }>;
  receivedAt: string;
};

export type KiwoomOrderRequest = {
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET";
  timeInForce: "DAY" | "IOC" | "FOK";
  venue: KiwoomVenue;
  quantity: number;
  price: number | null;
};

export type KiwoomOrderReceipt = { brokerOrderId: string; brokerOrgNo: string; orderTime: string; code: string; message: string };
export type KiwoomOrderSnapshot = { orderId: string; status: string; filledQuantity: number; remainingQuantity: number; averageFilledPrice: number | null };

const BASE_URLS: Record<KiwoomMode, string> = {
  production: "https://api.kiwoom.com",
  sandbox: "https://mockapi.kiwoom.com",
};

export class KiwoomApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly httpStatus = 502, public readonly uncertain = false) {
    super(message);
    this.name = "KiwoomApiError";
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function numeric(value: unknown) {
  const parsed = Number(String(value ?? "0").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function priceValue(value: unknown) {
  return Math.abs(numeric(value));
}

function timeoutSignal(timeoutMs = 8_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function tokenExpiry(value: unknown) {
  const raw = String(value ?? "");
  if (/^\d{14}$/.test(raw)) {
    const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}+09:00`;
    if (Number.isFinite(Date.parse(iso))) return new Date(iso).toISOString();
  }
  return new Date(Date.now() + 23 * 60 * 60_000).toISOString();
}

function marketSymbol(symbol: string, venue: KiwoomVenue) {
  return venue === "NXT" ? `${symbol}_NX` : venue === "SOR" ? `${symbol}_AL` : symbol;
}

async function parseResponse(response: Response, mutation = false) {
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !payload) throw new KiwoomApiError(`HTTP_${response.status}`, "키움증권 응답을 확인할 수 없습니다.", response.status || 502, mutation && response.status >= 500);
  if (payload.return_code !== undefined && numeric(payload.return_code) !== 0) {
    throw new KiwoomApiError(String(payload.return_code), String(payload.return_msg ?? "키움증권 요청이 거부되었습니다."), 422);
  }
  return payload;
}

export async function issueKiwoomToken(credentials: Pick<KiwoomCredentials, "appKey" | "secretKey">, mode: KiwoomMode): Promise<KiwoomToken> {
  const timer = timeoutSignal(10_000);
  try {
    const response = await fetch(`${BASE_URLS[mode]}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8" },
      body: JSON.stringify({ grant_type: "client_credentials", appkey: credentials.appKey, secretkey: credentials.secretKey }),
      signal: timer.signal,
    });
    const payload = await parseResponse(response);
    const accessToken = String(payload.token ?? "");
    if (!accessToken) throw new KiwoomApiError("TOKEN_MISSING", "키움증권 접근토큰이 반환되지 않았습니다.");
    return { accessToken, expiresAt: tokenExpiry(payload.expires_dt) };
  } catch (error) {
    if (error instanceof KiwoomApiError) throw error;
    if ((error as Error).name === "AbortError") throw new KiwoomApiError("BROKER_TIMEOUT", "키움증권 인증 시간이 초과되었습니다.", 504);
    throw new KiwoomApiError("BROKER_NETWORK", "키움증권 인증 서버에 연결할 수 없습니다.");
  } finally {
    timer.clear();
  }
}

async function kiwoomRequest(input: { mode: KiwoomMode; token: string; path: string; apiId: string; body?: Record<string, unknown>; mutation?: boolean; timeoutMs?: number }) {
  const timer = timeoutSignal(input.timeoutMs ?? 8_000);
  try {
    const response = await fetch(`${BASE_URLS[input.mode]}${input.path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        authorization: `Bearer ${input.token}`,
        "api-id": input.apiId,
        "cont-yn": "N",
        "next-key": "",
      },
      body: JSON.stringify(input.body ?? {}),
      signal: timer.signal,
    });
    return await parseResponse(response, Boolean(input.mutation));
  } catch (error) {
    if (error instanceof KiwoomApiError) throw error;
    const uncertain = Boolean(input.mutation);
    if ((error as Error).name === "AbortError") throw new KiwoomApiError("BROKER_TIMEOUT", uncertain ? "주문 응답이 지연되어 키움증권 체결 대사가 필요합니다." : "키움증권 조회 시간이 초과되었습니다.", 504, uncertain);
    throw new KiwoomApiError("BROKER_NETWORK", uncertain ? "주문 전송 결과가 불확실하여 키움증권 체결 대사가 필요합니다." : "키움증권 서버에 연결할 수 없습니다.", 502, uncertain);
  } finally {
    timer.clear();
  }
}

export async function getKiwoomAccountNumber(mode: KiwoomMode, token: string) {
  const payload = await kiwoomRequest({ mode, token, path: "/api/dostk/acnt", apiId: "ka00001" });
  const accountNo = String(payload.acctNo ?? "").replaceAll("-", "");
  if (!/^\d{10}$/.test(accountNo)) throw new KiwoomApiError("ACCOUNT_MISSING", "키움증권 계좌번호를 확인할 수 없습니다.");
  return accountNo;
}

export async function getKiwoomQuote(_credentials: KiwoomCredentials, mode: KiwoomMode, token: string, symbol: string, venue: KiwoomVenue) {
  if (mode === "sandbox" && venue !== "KRX") throw new KiwoomApiError("MOCK_KRX_ONLY", "키움 모의투자는 KRX 주문만 지원합니다.", 422);
  const stkCd = marketSymbol(symbol, venue);
  const [price, book] = await Promise.all([
    kiwoomRequest({ mode, token, path: "/api/dostk/mrkcond", apiId: "ka10001", body: { stk_cd: stkCd } }),
    kiwoomRequest({ mode, token, path: "/api/dostk/mrkcond", apiId: "ka10004", body: { stk_cd: stkCd } }),
  ]);
  return {
    symbol,
    market: venue === "SOR" ? "UNIFIED" as const : venue,
    lastPrice: priceValue(price.cur_prc),
    bestBid: priceValue(book.buy_fpr_bid) || null,
    bestAsk: priceValue(book.sel_fpr_bid) || null,
    changeRate: numeric(price.flu_rt) || null,
    volume: numeric(price.trde_qty) || null,
    receivedAt: new Date().toISOString(),
  };
}

export async function getKiwoomAccount(_credentials: KiwoomCredentials, mode: KiwoomMode, token: string): Promise<KiwoomAccountSnapshot> {
  const [depositPayload, balancePayload] = await Promise.all([
    kiwoomRequest({ mode, token, path: "/api/dostk/acnt", apiId: "kt00001", body: { qry_tp: "3" } }),
    kiwoomRequest({ mode, token, path: "/api/dostk/acnt", apiId: "kt00018", body: { qry_tp: "1", dmst_stex_tp: "KRX" } }),
  ]);
  const rows = Array.isArray(balancePayload.acnt_evlt_remn_indv_tot) ? balancePayload.acnt_evlt_remn_indv_tot.map(record) : [];
  const positions = rows.filter((item) => numeric(item.rmnd_qty) > 0).map((item) => ({
    symbol: String(item.stk_cd ?? "").replace(/^[AJQ]/, "").replace(/_(NX|AL)$/, ""),
    name: String(item.stk_nm ?? ""),
    quantity: numeric(item.rmnd_qty),
    availableQuantity: numeric(item.trde_able_qty),
    averagePrice: priceValue(item.pur_pric),
    currentPrice: priceValue(item.cur_prc),
    evaluationAmount: numeric(item.evlt_amt),
    profitLoss: numeric(item.evltv_prft),
  }));
  const deposit = Math.max(0, numeric(depositPayload.ord_alow_amt));
  const totalEvaluation = numeric(balancePayload.tot_evlt_amt) || positions.reduce((sum, item) => sum + item.evaluationAmount, 0);
  const netAsset = numeric(balancePayload.prsm_dpst_aset_amt) || deposit + totalEvaluation;
  return {
    deposit,
    totalEvaluation,
    netAsset,
    purchaseAmount: numeric(balancePayload.tot_pur_amt),
    profitLoss: numeric(balancePayload.tot_evlt_pl),
    positions,
    receivedAt: new Date().toISOString(),
  };
}

function tradeType(order: KiwoomOrderRequest) {
  if (order.orderType === "LIMIT") return order.timeInForce === "IOC" ? "10" : order.timeInForce === "FOK" ? "20" : "0";
  return order.timeInForce === "IOC" ? "13" : order.timeInForce === "FOK" ? "23" : "3";
}

export async function submitKiwoomCashOrder(_credentials: KiwoomCredentials, mode: KiwoomMode, token: string, order: KiwoomOrderRequest): Promise<KiwoomOrderReceipt> {
  if (mode === "sandbox" && order.venue !== "KRX") throw new KiwoomApiError("MOCK_KRX_ONLY", "키움 모의투자는 KRX 주문만 지원합니다.", 422);
  const payload = await kiwoomRequest({
    mode,
    token,
    path: "/api/dostk/ordr",
    apiId: order.side === "BUY" ? "kt10000" : "kt10001",
    body: { dmst_stex_tp: order.venue, stk_cd: order.symbol, ord_qty: String(order.quantity), ord_uv: order.orderType === "MARKET" ? "" : String(order.price ?? 0), trde_tp: tradeType(order), cond_uv: "" },
    mutation: true,
    timeoutMs: 10_000,
  });
  return { brokerOrderId: String(payload.ord_no ?? ""), brokerOrgNo: "", orderTime: new Date().toISOString(), code: String(payload.return_code ?? "0"), message: String(payload.return_msg ?? "키움증권 주문 접수") };
}

export async function cancelKiwoomOrder(_credentials: KiwoomCredentials, mode: KiwoomMode, token: string, order: { brokerOrderId: string; symbol: string; venue: KiwoomVenue }): Promise<KiwoomOrderReceipt> {
  const payload = await kiwoomRequest({ mode, token, path: "/api/dostk/ordr", apiId: "kt10003", body: { dmst_stex_tp: order.venue, orig_ord_no: order.brokerOrderId, stk_cd: order.symbol, cncl_qty: "0" }, mutation: true, timeoutMs: 10_000 });
  return { brokerOrderId: order.brokerOrderId, brokerOrgNo: String(payload.ord_no ?? ""), orderTime: new Date().toISOString(), code: String(payload.return_code ?? "0"), message: String(payload.return_msg ?? "키움증권 취소 접수") };
}

export async function getKiwoomOrders(_credentials: KiwoomCredentials, mode: KiwoomMode, token: string): Promise<KiwoomOrderSnapshot[]> {
  const payload = await kiwoomRequest({ mode, token, path: "/api/dostk/acnt", apiId: "ka10076", body: { stk_cd: "", qry_tp: "0", sell_tp: "0", ord_no: "", stex_tp: "0" } });
  const rows = Array.isArray(payload.cntr) ? payload.cntr.map(record) : [];
  const grouped = new Map<string, KiwoomOrderSnapshot & { filledNotional: number }>();
  for (const row of rows) {
    const orderId = String(row.ord_no ?? "");
    if (!orderId) continue;
    const fillQuantity = numeric(row.cntr_qty);
    const fillPrice = priceValue(row.cntr_pric);
    const current = grouped.get(orderId) ?? { orderId, status: String(row.ord_stt ?? ""), filledQuantity: 0, remainingQuantity: numeric(row.oso_qty), averageFilledPrice: null, filledNotional: 0 };
    current.status = String(row.ord_stt ?? current.status);
    current.remainingQuantity = numeric(row.oso_qty);
    current.filledQuantity += fillQuantity;
    current.filledNotional += fillQuantity * fillPrice;
    current.averageFilledPrice = current.filledQuantity > 0 ? Math.round(current.filledNotional / current.filledQuantity) : null;
    grouped.set(orderId, current);
  }
  return [...grouped.values()].map((order) => ({ orderId: order.orderId, status: order.status, filledQuantity: order.filledQuantity, remainingQuantity: order.remainingQuantity, averageFilledPrice: order.averageFilledPrice }));
}
