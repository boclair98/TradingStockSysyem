export type KisMode = "sandbox" | "production";
export type KisVenue = "KRX" | "NXT" | "SOR";
export type KisSide = "BUY" | "SELL";
export type KisOrderType = "LIMIT" | "MARKET";
export type KisTimeInForce = "DAY" | "IOC" | "FOK";

export type KisCredentials = {
  appKey: string;
  appSecret: string;
  accountNumber: string;
  productCode: string;
  htsId: string;
};

export type KisToken = { accessToken: string; expiresAt: string };

export type KisQuote = {
  symbol: string;
  market: "KRX" | "NXT" | "UNIFIED";
  lastPrice: number;
  bestBid: number | null;
  bestAsk: number | null;
  changeRate: number | null;
  volume: number | null;
  receivedAt: string;
};

export type KisPosition = {
  symbol: string;
  name: string;
  quantity: number;
  availableQuantity: number;
  averagePrice: number;
  currentPrice: number;
  evaluationAmount: number;
  profitLoss: number;
};

export type KisAccountSnapshot = {
  deposit: number;
  totalEvaluation: number;
  netAsset: number;
  purchaseAmount: number;
  profitLoss: number;
  positions: KisPosition[];
  receivedAt: string;
};

export type KisOrderRequest = {
  symbol: string;
  side: KisSide;
  orderType: KisOrderType;
  timeInForce: KisTimeInForce;
  venue: KisVenue;
  quantity: number;
  price: number | null;
};

export type KisOrderReceipt = {
  brokerOrderId: string;
  brokerOrgNo: string;
  orderTime: string;
  code: string;
  message: string;
};

type KisResponse = Record<string, unknown> & { rt_cd?: string; msg_cd?: string; msg1?: string };

const BASE_URLS: Record<KisMode, string> = {
  production: "https://openapi.koreainvestment.com:9443",
  sandbox: "https://openapivts.koreainvestment.com:29443",
};

export class KisApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly httpStatus = 502, public readonly uncertain = false) {
    super(message);
    this.name = "KisApiError";
  }
}

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? "0").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function timeoutSignal(timeoutMs = 8_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function parseResponse(response: Response): Promise<KisResponse> {
  const payload = await response.json().catch(() => null) as KisResponse | null;
  if (!response.ok || !payload) throw new KisApiError(`HTTP_${response.status}`, "증권사 응답을 확인할 수 없습니다.", response.status || 502);
  if (payload.rt_cd !== undefined && payload.rt_cd !== "0") throw new KisApiError(String(payload.msg_cd ?? "BROKER_REJECTED"), String(payload.msg1 ?? "증권사 요청이 거부되었습니다."), 422);
  return payload;
}

export async function issueKisToken(credentials: KisCredentials, mode: KisMode): Promise<KisToken> {
  const timer = timeoutSignal(10_000);
  try {
    const response = await fetch(`${BASE_URLS[mode]}/oauth2/tokenP`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", appkey: credentials.appKey, appsecret: credentials.appSecret }),
      signal: timer.signal,
    });
    const payload = await parseResponse(response);
    const token = String(payload.access_token ?? "");
    if (!token) throw new KisApiError("TOKEN_MISSING", "증권사 접근토큰이 반환되지 않았습니다.");
    const expiresIn = Math.max(300, numberValue(payload.expires_in) || 86_400);
    return { accessToken: token, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
  } catch (error) {
    if (error instanceof KisApiError) throw error;
    if ((error as Error).name === "AbortError") throw new KisApiError("BROKER_TIMEOUT", "증권사 인증 시간이 초과되었습니다.", 504);
    throw new KisApiError("BROKER_NETWORK", "증권사 인증 서버에 연결할 수 없습니다.");
  } finally {
    timer.clear();
  }
}

async function hashKey(credentials: KisCredentials, mode: KisMode, body: Record<string, string>) {
  const timer = timeoutSignal();
  try {
    const response = await fetch(`${BASE_URLS[mode]}/uapi/hashkey`, {
      method: "POST",
      headers: { "Content-Type": "application/json", appkey: credentials.appKey, appsecret: credentials.appSecret },
      body: JSON.stringify(body),
      signal: timer.signal,
    });
    const payload = await parseResponse(response);
    return String(payload.HASH ?? "");
  } finally {
    timer.clear();
  }
}

async function kisRequest(input: { credentials: KisCredentials; mode: KisMode; token: string; path: string; trId: string; method?: "GET" | "POST"; query?: Record<string, string>; body?: Record<string, string>; timeoutMs?: number; orderMutation?: boolean }) {
  const method = input.method ?? "GET";
  const url = new URL(`${BASE_URLS[input.mode]}${input.path}`);
  for (const [key, value] of Object.entries(input.query ?? {})) url.searchParams.set(key, value);
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    authorization: `Bearer ${input.token}`,
    appkey: input.credentials.appKey,
    appsecret: input.credentials.appSecret,
    tr_id: input.trId,
    custtype: "P",
  };
  if (method === "POST" && input.body) headers.hashkey = await hashKey(input.credentials, input.mode, input.body);
  const timer = timeoutSignal(input.timeoutMs ?? 8_000);
  try {
    const response = await fetch(url, { method, headers, body: method === "POST" ? JSON.stringify(input.body ?? {}) : undefined, signal: timer.signal });
    return await parseResponse(response);
  } catch (error) {
    if (error instanceof KisApiError) throw error;
    const uncertain = Boolean(input.orderMutation);
    if ((error as Error).name === "AbortError") throw new KisApiError("BROKER_TIMEOUT", uncertain ? "주문 응답이 지연되어 체결 여부 대사가 필요합니다." : "증권사 조회 시간이 초과되었습니다.", 504, uncertain);
    throw new KisApiError("BROKER_NETWORK", uncertain ? "주문 전송 결과가 불확실하여 체결 여부 대사가 필요합니다." : "증권사 서버에 연결할 수 없습니다.", 502, uncertain);
  } finally {
    timer.clear();
  }
}

export async function getKisQuote(credentials: KisCredentials, mode: KisMode, token: string, symbol: string, market: "KRX" | "NXT" | "UNIFIED" = "UNIFIED"): Promise<KisQuote> {
  const marketCode = market === "KRX" ? "J" : market === "NXT" ? "NX" : "UN";
  const payload = await kisRequest({ credentials, mode, token, path: "/uapi/domestic-stock/v1/quotations/inquire-price", trId: "FHKST01010100", query: { FID_COND_MRKT_DIV_CODE: marketCode, FID_INPUT_ISCD: symbol } });
  const output = (payload.output ?? {}) as Record<string, unknown>;
  return { symbol, market, lastPrice: numberValue(output.stck_prpr), bestBid: numberValue(output.bidp1) || null, bestAsk: numberValue(output.askp1) || null, changeRate: numberValue(output.prdy_ctrt) || null, volume: numberValue(output.acml_vol) || null, receivedAt: new Date().toISOString() };
}

export async function getKisAccount(credentials: KisCredentials, mode: KisMode, token: string): Promise<KisAccountSnapshot> {
  const payload = await kisRequest({
    credentials, mode, token, path: "/uapi/domestic-stock/v1/trading/inquire-balance",
    trId: mode === "production" ? "TTTC8434R" : "VTTC8434R",
    query: { CANO: credentials.accountNumber, ACNT_PRDT_CD: credentials.productCode, AFHR_FLPR_YN: "N", OFL_YN: "", INQR_DVSN: "02", UNPR_DVSN: "01", FUND_STTL_ICLD_YN: "N", FNCG_AMT_AUTO_RDPT_YN: "N", PRCS_DVSN: "00", CTX_AREA_FK100: "", CTX_AREA_NK100: "" },
  });
  const positions = (Array.isArray(payload.output1) ? payload.output1 : []) as Record<string, unknown>[];
  const summary = (Array.isArray(payload.output2) ? payload.output2[0] : payload.output2 ?? {}) as Record<string, unknown>;
  return {
    deposit: numberValue(summary.dnca_tot_amt), totalEvaluation: numberValue(summary.tot_evlu_amt), netAsset: numberValue(summary.nass_amt), purchaseAmount: numberValue(summary.pchs_amt_smtl_amt), profitLoss: numberValue(summary.evlu_pfls_smtl_amt),
    positions: positions.filter((item) => numberValue(item.hldg_qty) > 0).map((item) => ({ symbol: String(item.pdno ?? ""), name: String(item.prdt_name ?? ""), quantity: numberValue(item.hldg_qty), availableQuantity: numberValue(item.ord_psbl_qty), averagePrice: numberValue(item.pchs_avg_pric), currentPrice: numberValue(item.prpr), evaluationAmount: numberValue(item.evlu_amt), profitLoss: numberValue(item.evlu_pfls_amt) })),
    receivedAt: new Date().toISOString(),
  };
}

function orderDivision(orderType: KisOrderType, tif: KisTimeInForce) {
  if (orderType === "LIMIT") return tif === "IOC" ? "11" : tif === "FOK" ? "12" : "00";
  return tif === "IOC" ? "13" : tif === "FOK" ? "14" : "01";
}

export async function submitKisCashOrder(credentials: KisCredentials, mode: KisMode, token: string, order: KisOrderRequest): Promise<KisOrderReceipt> {
  const trId = mode === "production" ? (order.side === "BUY" ? "TTTC0012U" : "TTTC0011U") : (order.side === "BUY" ? "VTTC0012U" : "VTTC0011U");
  const body = { CANO: credentials.accountNumber, ACNT_PRDT_CD: credentials.productCode, PDNO: order.symbol, ORD_DVSN: orderDivision(order.orderType, order.timeInForce), ORD_QTY: String(order.quantity), ORD_UNPR: order.orderType === "MARKET" ? "0" : String(order.price ?? 0), EXCG_ID_DVSN_CD: order.venue, SLL_TYPE: order.side === "SELL" ? "01" : "", CNDT_PRIC: "" };
  const payload = await kisRequest({ credentials, mode, token, path: "/uapi/domestic-stock/v1/trading/order-cash", trId, method: "POST", body, timeoutMs: 10_000, orderMutation: true });
  const output = (payload.output ?? {}) as Record<string, unknown>;
  return { brokerOrderId: String(output.ODNO ?? output.odno ?? ""), brokerOrgNo: String(output.KRX_FWDG_ORD_ORGNO ?? output.krx_fwdg_ord_orgno ?? ""), orderTime: String(output.ORD_TMD ?? output.ord_tmd ?? ""), code: String(payload.msg_cd ?? "0"), message: String(payload.msg1 ?? "주문 접수") };
}

export async function cancelKisOrder(credentials: KisCredentials, mode: KisMode, token: string, order: { brokerOrderId: string; brokerOrgNo: string; quantity: number; venue: KisVenue }): Promise<KisOrderReceipt> {
  const body = { CANO: credentials.accountNumber, ACNT_PRDT_CD: credentials.productCode, KRX_FWDG_ORD_ORGNO: order.brokerOrgNo, ORGN_ODNO: order.brokerOrderId, ORD_DVSN: "00", RVSE_CNCL_DVSN_CD: "02", ORD_QTY: String(order.quantity), ORD_UNPR: "0", QTY_ALL_ORD_YN: "Y", EXCG_ID_DVSN_CD: order.venue };
  const payload = await kisRequest({ credentials, mode, token, path: "/uapi/domestic-stock/v1/trading/order-rvsecncl", trId: mode === "production" ? "TTTC0013U" : "VTTC0013U", method: "POST", body, timeoutMs: 10_000, orderMutation: true });
  const output = (payload.output ?? {}) as Record<string, unknown>;
  return { brokerOrderId: String(output.ODNO ?? order.brokerOrderId), brokerOrgNo: String(output.KRX_FWDG_ORD_ORGNO ?? order.brokerOrgNo), orderTime: String(output.ORD_TMD ?? ""), code: String(payload.msg_cd ?? "0"), message: String(payload.msg1 ?? "취소 접수") };
}

export async function getKisDailyOrders(credentials: KisCredentials, mode: KisMode, token: string, date: string) {
  const payload = await kisRequest({ credentials, mode, token, path: "/uapi/domestic-stock/v1/trading/inquire-daily-ccld", trId: mode === "production" ? "TTTC0081R" : "VTTC0081R", query: { CANO: credentials.accountNumber, ACNT_PRDT_CD: credentials.productCode, INQR_STRT_DT: date, INQR_END_DT: date, SLL_BUY_DVSN_CD: "00", PDNO: "", CCLD_DVSN: "00", INQR_DVSN: "00", INQR_DVSN_3: "00", ORD_GNO_BRNO: "", ODNO: "", INQR_DVSN_1: "", CTX_AREA_FK100: "", CTX_AREA_NK100: "", EXCG_ID_DVSN_CD: "ALL" } });
  return (Array.isArray(payload.output1) ? payload.output1 : []) as Record<string, unknown>[];
}
