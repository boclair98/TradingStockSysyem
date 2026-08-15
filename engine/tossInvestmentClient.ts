export type TossCredentials = {
  clientId: string;
  clientSecret: string;
  accountSeq: number;
  accountNo: string;
};

export type TossAccount = { accountNo: string; accountSeq: number; accountType: string };
export type TossToken = { accessToken: string; expiresAt: string };
export type TossQuote = {
  symbol: string;
  market: "UNIFIED";
  lastPrice: number;
  bestBid: number | null;
  bestAsk: number | null;
  changeRate: number | null;
  volume: number | null;
  receivedAt: string;
};
export type TossPosition = {
  symbol: string;
  name: string;
  quantity: number;
  availableQuantity: number;
  averagePrice: number;
  currentPrice: number;
  evaluationAmount: number;
  profitLoss: number;
};
export type TossAccountSnapshot = {
  deposit: number;
  totalEvaluation: number;
  netAsset: number;
  purchaseAmount: number;
  profitLoss: number;
  positions: TossPosition[];
  receivedAt: string;
};
export type TossOrderRequest = {
  clientOrderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET";
  timeInForce: "DAY" | "IOC" | "FOK";
  venue: "KRX" | "NXT" | "SOR";
  quantity: number;
  price: number | null;
};
export type TossOrderReceipt = { brokerOrderId: string; brokerOrgNo: string; orderTime: string; code: string; message: string };
export type TossOrderSnapshot = {
  orderId: string;
  status: string;
  filledQuantity: number;
  averageFilledPrice: number | null;
};

const BASE_URL = "https://openapi.tossinvest.com";

export class TossApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly httpStatus = 502, public readonly uncertain = false) {
    super(message);
    this.name = "TossApiError";
  }
}

function numeric(value: unknown) {
  const parsed = Number(String(value ?? "0").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function timeoutSignal(timeoutMs = 8_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function parseApiResponse(response: Response, mutation = false) {
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !payload) {
    const error = record(payload?.error);
    const code = String(error.code ?? `HTTP_${response.status}`);
    const message = String(error.message ?? "토스증권 응답을 확인할 수 없습니다.");
    throw new TossApiError(code, message, response.status || 502, mutation && response.status >= 500);
  }
  return payload;
}

export async function issueTossToken(credentials: Pick<TossCredentials, "clientId" | "clientSecret">): Promise<TossToken> {
  const timer = timeoutSignal(10_000);
  try {
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: credentials.clientId, client_secret: credentials.clientSecret });
    const response = await fetch(`${BASE_URL}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: timer.signal,
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !payload) throw new TossApiError(String(payload?.error ?? `HTTP_${response.status}`), String(payload?.error_description ?? "토스증권 인증에 실패했습니다."), response.status || 502);
    const accessToken = String(payload.access_token ?? "");
    if (!accessToken) throw new TossApiError("TOKEN_MISSING", "토스증권 접근토큰이 반환되지 않았습니다.");
    const expiresIn = Math.max(300, numeric(payload.expires_in) || 86_400);
    return { accessToken, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
  } catch (error) {
    if (error instanceof TossApiError) throw error;
    if ((error as Error).name === "AbortError") throw new TossApiError("BROKER_TIMEOUT", "토스증권 인증 시간이 초과되었습니다.", 504);
    throw new TossApiError("BROKER_NETWORK", "토스증권 인증 서버에 연결할 수 없습니다.");
  } finally {
    timer.clear();
  }
}

async function tossRequest(input: { token: string; path: string; accountSeq?: number; method?: "GET" | "POST"; query?: Record<string, string>; body?: Record<string, unknown>; mutation?: boolean; timeoutMs?: number }) {
  const method = input.method ?? "GET";
  const url = new URL(`${BASE_URL}${input.path}`);
  for (const [key, value] of Object.entries(input.query ?? {})) url.searchParams.set(key, value);
  const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${input.token}` };
  if (input.accountSeq !== undefined) headers["X-Tossinvest-Account"] = String(input.accountSeq);
  if (method === "POST") headers["Content-Type"] = "application/json";
  const timer = timeoutSignal(input.timeoutMs ?? 8_000);
  try {
    const response = await fetch(url, { method, headers, body: method === "POST" ? JSON.stringify(input.body ?? {}) : undefined, signal: timer.signal });
    return await parseApiResponse(response, Boolean(input.mutation));
  } catch (error) {
    if (error instanceof TossApiError) throw error;
    const uncertain = Boolean(input.mutation);
    if ((error as Error).name === "AbortError") throw new TossApiError("BROKER_TIMEOUT", uncertain ? "주문 응답이 지연되어 체결 여부 대사가 필요합니다." : "토스증권 조회 시간이 초과되었습니다.", 504, uncertain);
    throw new TossApiError("BROKER_NETWORK", uncertain ? "주문 전송 결과가 불확실하여 체결 여부 대사가 필요합니다." : "토스증권 서버에 연결할 수 없습니다.", 502, uncertain);
  } finally {
    timer.clear();
  }
}

export async function getTossAccounts(token: string): Promise<TossAccount[]> {
  const payload = await tossRequest({ token, path: "/api/v1/accounts" });
  const rows = Array.isArray(payload.result) ? payload.result : [];
  return rows.map((item) => record(item)).map((item) => ({ accountNo: String(item.accountNo ?? ""), accountSeq: numeric(item.accountSeq), accountType: String(item.accountType ?? "UNKNOWN") })).filter((item) => item.accountNo && item.accountSeq > 0);
}

export async function getTossQuote(credentials: TossCredentials, token: string, symbol: string): Promise<TossQuote> {
  const [pricePayload, bookPayload] = await Promise.all([
    tossRequest({ token, path: "/api/v1/prices", query: { symbols: symbol } }),
    tossRequest({ token, path: "/api/v1/orderbook", query: { symbol } }),
  ]);
  const price = record(Array.isArray(pricePayload.result) ? pricePayload.result[0] : null);
  const book = record(bookPayload.result);
  const asks = Array.isArray(book.asks) ? book.asks.map(record) : [];
  const bids = Array.isArray(book.bids) ? book.bids.map(record) : [];
  return {
    symbol,
    market: "UNIFIED",
    lastPrice: numeric(price.lastPrice),
    bestBid: numeric(bids[0]?.price) || null,
    bestAsk: numeric(asks[0]?.price) || null,
    changeRate: null,
    volume: null,
    receivedAt: String(price.timestamp ?? book.timestamp ?? new Date().toISOString()),
  };
}

export async function getTossSellableQuantity(credentials: TossCredentials, token: string, symbol: string) {
  const payload = await tossRequest({ token, path: "/api/v1/sellable-quantity", accountSeq: credentials.accountSeq, query: { symbol } });
  return numeric(record(payload.result).sellableQuantity);
}

export async function getTossAccount(credentials: TossCredentials, token: string): Promise<TossAccountSnapshot> {
  const [holdingsPayload, buyingPowerPayload] = await Promise.all([
    tossRequest({ token, path: "/api/v1/holdings", accountSeq: credentials.accountSeq }),
    tossRequest({ token, path: "/api/v1/buying-power", accountSeq: credentials.accountSeq, query: { currency: "KRW" } }),
  ]);
  const holdings = record(holdingsPayload.result);
  const marketValue = record(record(holdings.marketValue).amount);
  const totalPurchase = record(holdings.totalPurchaseAmount);
  const profitLoss = record(record(holdings.profitLoss).amount);
  const buyingPower = numeric(record(buyingPowerPayload.result).cashBuyingPower);
  const items = Array.isArray(holdings.items) ? holdings.items.map(record) : [];
  const positions = items.filter((item) => String(item.marketCountry ?? "") === "KR").map((item) => {
    const itemMarketValue = record(item.marketValue);
    const itemProfitLoss = record(item.profitLoss);
    const quantity = numeric(item.quantity);
    return {
      symbol: String(item.symbol ?? ""),
      name: String(item.name ?? ""),
      quantity,
      availableQuantity: quantity,
      averagePrice: numeric(item.averagePurchasePrice),
      currentPrice: numeric(item.lastPrice),
      evaluationAmount: numeric(itemMarketValue.amount),
      profitLoss: numeric(itemProfitLoss.amount),
    };
  });
  const positionValue = numeric(marketValue.krw);
  return {
    deposit: buyingPower,
    totalEvaluation: buyingPower + positionValue,
    netAsset: buyingPower + positionValue,
    purchaseAmount: numeric(totalPurchase.krw),
    profitLoss: numeric(profitLoss.krw),
    positions,
    receivedAt: new Date().toISOString(),
  };
}

export async function submitTossCashOrder(credentials: TossCredentials, token: string, order: TossOrderRequest): Promise<TossOrderReceipt> {
  if (order.venue !== "SOR") throw new TossApiError("TOSS_SOR_REQUIRED", "토스증권 국내주식 주문은 통합(SOR) 라우팅만 지원합니다.", 422);
  if (order.timeInForce !== "DAY") throw new TossApiError("TOSS_TIF_UNSUPPORTED", "토스증권 국내주식은 DAY 주문만 지원합니다.", 422);
  const body: Record<string, unknown> = {
    clientOrderId: order.clientOrderId.slice(0, 36), symbol: order.symbol, side: order.side,
    orderType: order.orderType, timeInForce: "DAY", quantity: String(order.quantity),
    confirmHighValueOrder: false,
  };
  if (order.orderType === "LIMIT") body.price = String(order.price ?? 0);
  const payload = await tossRequest({ token, path: "/api/v1/orders", accountSeq: credentials.accountSeq, method: "POST", body, mutation: true, timeoutMs: 10_000 });
  const result = record(payload.result);
  const orderId = String(result.orderId ?? "");
  return { brokerOrderId: orderId, brokerOrgNo: "", orderTime: new Date().toISOString(), code: "0", message: orderId ? "토스증권 주문 접수" : "주문번호 확인 필요" };
}

export async function cancelTossOrder(credentials: TossCredentials, token: string, brokerOrderId: string): Promise<TossOrderReceipt> {
  const payload = await tossRequest({ token, path: `/api/v1/orders/${encodeURIComponent(brokerOrderId)}/cancel`, accountSeq: credentials.accountSeq, method: "POST", body: {}, mutation: true, timeoutMs: 10_000 });
  const cancelOperationId = String(record(payload.result).orderId ?? "");
  return { brokerOrderId, brokerOrgNo: cancelOperationId, orderTime: new Date().toISOString(), code: "0", message: "토스증권 취소 접수" };
}

export async function getTossOrders(credentials: TossCredentials, token: string): Promise<TossOrderSnapshot[]> {
  const [openPayload, closedPayload] = await Promise.all([
    tossRequest({ token, path: "/api/v1/orders", accountSeq: credentials.accountSeq, query: { status: "OPEN" } }),
    tossRequest({ token, path: "/api/v1/orders", accountSeq: credentials.accountSeq, query: { status: "CLOSED", limit: "100" } }),
  ]);
  const all = [...(Array.isArray(record(openPayload.result).orders) ? record(openPayload.result).orders as unknown[] : []), ...(Array.isArray(record(closedPayload.result).orders) ? record(closedPayload.result).orders as unknown[] : [])];
  const unique = new Map<string, TossOrderSnapshot>();
  for (const value of all) {
    const order = record(value);
    const execution = record(order.execution);
    const orderId = String(order.orderId ?? "");
    if (!orderId) continue;
    unique.set(orderId, { orderId, status: String(order.status ?? "UNKNOWN"), filledQuantity: numeric(execution.filledQuantity), averageFilledPrice: numeric(execution.averageFilledPrice) || null });
  }
  return [...unique.values()];
}
