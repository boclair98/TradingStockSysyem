import { addAudit, deleteBrokerConnection, listBrokerConnections, saveBrokerConnection } from "../db/trading";
import { consumeLiveOrderPreview, createLiveOrderPreview, createPendingLiveOrder, deleteBrokerToken, getBrokerConnectionSecret, getBrokerToken, getLiveOrder, getLiveRiskPolicy, getLiveRiskUsage, listLiveOrders, listLiveOrdersForConnection, saveBrokerToken, updateBrokerConnectionState, updateLiveOrderBrokerState, type LiveOrderRequestRecord } from "../db/liveTrading";
import { credentialFingerprint, decryptCredential, encryptCredential, maskAccount } from "./credentialVault";
import { cancelKisOrder, getKisAccount, getKisDailyOrders, getKisQuote, issueKisToken, KisApiError, submitKisCashOrder, type KisCredentials, type KisMode } from "./koreaInvestmentClient";
import { cancelKiwoomOrder, getKiwoomAccount, getKiwoomAccountNumber, getKiwoomOrders, getKiwoomQuote, issueKiwoomToken, KiwoomApiError, submitKiwoomCashOrder, type KiwoomCredentials, type KiwoomMode } from "./kiwoomClient";
import { cancelTossOrder, getTossAccount, getTossAccounts, getTossOrders, getTossQuote, getTossSellableQuantity, issueTossToken, submitTossCashOrder, TossApiError, type TossCredentials } from "./tossInvestmentClient";

const LIVE_CONFIRMATION = "실거래 주문 실행";
const EGRESS_READY = () => process.env.LIVE_TRADING_EGRESS_READY === "true";
const GLOBAL_LIVE_ENABLED = () => process.env.LIVE_TRADING_ENABLED === "true" && EGRESS_READY();

type StoredConnection = NonNullable<Awaited<ReturnType<typeof getBrokerConnectionSecret>>>;
type KisBundle = { provider: "korea_investment"; connection: StoredConnection; credentials: KisCredentials };
type TossBundle = { provider: "toss_investment"; connection: StoredConnection; credentials: TossCredentials };
type KiwoomBundle = { provider: "kiwoom"; connection: StoredConnection; credentials: KiwoomCredentials };
type ConnectionBundle = KisBundle | TossBundle | KiwoomBundle;

function validateKis(credentials: KisCredentials) {
  if (credentials.appKey.trim().length < 10) throw new Error("App Key 형식을 확인하세요.");
  if (credentials.appSecret.trim().length < 10) throw new Error("App Secret 형식을 확인하세요.");
  if (!/^\d{8}$/.test(credentials.accountNumber)) throw new Error("계좌번호 앞 8자리를 입력하세요.");
  if (!/^\d{2}$/.test(credentials.productCode)) throw new Error("계좌상품코드 2자리를 입력하세요.");
}

function validateToss(credentials: TossCredentials) {
  if (credentials.clientId.trim().length < 8) throw new Error("토스증권 Client ID 형식을 확인하세요.");
  if (credentials.clientSecret.trim().length < 8) throw new Error("토스증권 Client Secret 형식을 확인하세요.");
  if (!Number.isSafeInteger(credentials.accountSeq) || credentials.accountSeq <= 0) throw new Error("토스증권 계좌 식별값을 확인하세요.");
  if (!credentials.accountNo.trim()) throw new Error("토스증권 계좌번호를 확인할 수 없습니다.");
}

function validateKiwoom(credentials: KiwoomCredentials) {
  if (credentials.appKey.trim().length < 8) throw new Error("키움증권 App Key 형식을 확인하세요.");
  if (credentials.secretKey.trim().length < 8) throw new Error("키움증권 Secret Key 형식을 확인하세요.");
  if (!/^\d{10}$/.test(credentials.accountNo)) throw new Error("키움증권 계좌번호를 확인할 수 없습니다.");
}

function validateOrder(request: LiveOrderRequestRecord) {
  if (!/^\d{6}$/.test(request.symbol)) throw new Error("국내주식 종목코드 6자리를 입력하세요.");
  if (!["BUY", "SELL"].includes(request.side)) throw new Error("매수·매도 구분을 확인하세요.");
  if (!["LIMIT", "MARKET"].includes(request.orderType)) throw new Error("주문유형을 확인하세요.");
  if (!["DAY", "IOC", "FOK"].includes(request.timeInForce)) throw new Error("주문 유효조건을 확인하세요.");
  if (!["KRX", "NXT", "SOR"].includes(request.venue)) throw new Error("주문 라우팅 시장을 확인하세요.");
  if (!request.connectionId) throw new Error("증권계좌 연결을 확인하세요.");
  if (!Number.isSafeInteger(request.quantity) || request.quantity <= 0) throw new Error("주문수량은 양의 정수여야 합니다.");
  if (request.orderType === "LIMIT" && (!Number.isSafeInteger(request.price) || (request.price ?? 0) <= 0 || (request.price ?? 0) > 100_000_000)) throw new Error("지정가 주문가격을 확인하세요.");
  if (request.orderType === "MARKET" && request.price != null) throw new Error("시장가 주문에는 가격을 입력하지 않습니다.");
}

async function connectionBundle(userId: string, connectionId: string): Promise<ConnectionBundle> {
  const connection = await getBrokerConnectionSecret(userId, connectionId);
  if (!connection?.credentialCiphertext) throw new Error("증권계좌 연결을 찾을 수 없습니다.");
  if (connection.status === "disabled") throw new Error("비활성화된 증권계좌입니다.");
  if (connection.provider === "korea_investment") {
    const credentials = await decryptCredential<KisCredentials>(connection.credentialCiphertext, userId, connection.id);
    validateKis(credentials);
    return { provider: "korea_investment", connection, credentials };
  }
  if (connection.provider === "toss_investment") {
    const credentials = await decryptCredential<TossCredentials>(connection.credentialCiphertext, userId, connection.id);
    validateToss(credentials);
    return { provider: "toss_investment", connection, credentials };
  }
  if (connection.provider === "kiwoom") {
    const credentials = await decryptCredential<KiwoomCredentials>(connection.credentialCiphertext, userId, connection.id);
    validateKiwoom(credentials);
    return { provider: "kiwoom", connection, credentials };
  }
  throw new Error("지원하지 않는 증권사 연결입니다.");
}

async function accessToken(bundle: ConnectionBundle) {
  const cached = await getBrokerToken(bundle.connection.id);
  if (cached && Date.parse(cached.expiresAt) - Date.now() > 5 * 60_000) {
    try {
      const token = await decryptCredential<{ accessToken: string }>(cached.tokenCiphertext, bundle.connection.userId, `token:${bundle.connection.id}`);
      if (token.accessToken) return token.accessToken;
    } catch { await deleteBrokerToken(bundle.connection.id); }
  }
  const issued = bundle.provider === "korea_investment"
    ? await issueKisToken(bundle.credentials, bundle.connection.mode as KisMode)
    : bundle.provider === "kiwoom"
      ? await issueKiwoomToken(bundle.credentials, bundle.connection.mode as KiwoomMode)
      : await issueTossToken(bundle.credentials);
  const sealed = await encryptCredential({ accessToken: issued.accessToken }, bundle.connection.userId, `token:${bundle.connection.id}`);
  await saveBrokerToken(bundle.connection.id, sealed, issued.expiresAt);
  return issued.accessToken;
}

function brokerFailure(error: unknown, fallback: string) {
  if (error instanceof KisApiError || error instanceof TossApiError || error instanceof KiwoomApiError) return error;
  return new KisApiError(fallback, error instanceof Error ? error.message : "증권사 요청에 실패했습니다.");
}

export function getLiveServiceReadiness() {
  return {
    globalLiveEnabled: GLOBAL_LIVE_ENABLED(),
    egressReady: EGRESS_READY(),
    providers: ["toss_investment", "korea_investment", "kiwoom"],
    providerCapabilities: {
      toss_investment: { production: true, sandbox: false, venues: ["SOR"], timeInForce: ["DAY"] },
      korea_investment: { production: true, sandbox: true, venues: ["KRX", "NXT", "SOR"], timeInForce: ["DAY", "IOC", "FOK"] },
      kiwoom: { production: true, sandbox: true, venues: ["KRX", "NXT", "SOR"], sandboxVenues: ["KRX"], timeInForce: ["DAY", "IOC", "FOK"] },
    },
    productionOrderEndpoint: "broker-adapter/order-cash",
    executionReconciliation: "broker order history reconciliation",
    safeguards: ["per-user encrypted credentials", "server + egress + user + order four-stage arming", "one-time 60 second preview", "idempotent local order journal", "unknown-state reconciliation", "kill switch", "cash-only risk limits"],
  };
}

export async function connectKoreaInvestment(userId: string, input: { mode: KisMode; accountLabel: string; credentials: KisCredentials }) {
  validateKis(input.credentials);
  const fingerprint = await credentialFingerprint(`${input.credentials.accountNumber}:${input.credentials.productCode}:${input.credentials.appKey}`);
  const accountRef = `${maskAccount(input.credentials.accountNumber, input.credentials.productCode)}#${fingerprint}`;
  const existing = (await listBrokerConnections(userId)).find((item) => item.provider === "korea_investment" && item.accountRef === accountRef);
  const id = existing?.id ?? `KIS-${crypto.randomUUID()}`;
  const sealed = await encryptCredential(input.credentials, userId, id);
  await saveBrokerConnection({ id, userId, provider: "korea_investment", mode: input.mode, accountLabel: input.accountLabel.trim() || "한국투자증권", accountRef, credentialCiphertext: sealed, status: "pending" });
  try {
    const account = await getLiveAccount(userId, id);
    await updateBrokerConnectionState(userId, id, "connected", null);
    await addAudit(userId, "LIVE_BROKER_CONNECTED", id, { provider: "korea_investment", mode: input.mode, accountRef });
    return { connection: (await listBrokerConnections(userId)).find((item) => item.id === id), account };
  } catch (error) {
    const message = brokerFailure(error, "CONNECTION_FAILED").message;
    await updateBrokerConnectionState(userId, id, "error", message.slice(0, 300));
    await addAudit(userId, "LIVE_BROKER_CONNECTION_FAILED", id, { provider: "korea_investment", error: message.slice(0, 120) });
    throw error;
  }
}

export async function connectTossInvestment(userId: string, input: { accountLabel: string; clientId: string; clientSecret: string; accountSeq?: number }) {
  const client = { clientId: input.clientId.trim(), clientSecret: input.clientSecret.trim() };
  if (client.clientId.length < 8 || client.clientSecret.length < 8) throw new Error("토스증권 Client ID와 Client Secret을 확인하세요.");
  const issued = await issueTossToken(client);
  const accounts = await getTossAccounts(issued.accessToken);
  const account = input.accountSeq ? accounts.find((item) => item.accountSeq === input.accountSeq) : accounts.find((item) => item.accountType === "BROKERAGE") ?? accounts[0];
  if (!account) throw new Error("토스증권에서 거래 가능한 국내주식 계좌를 찾지 못했습니다.");
  const credentials: TossCredentials = { ...client, accountSeq: account.accountSeq, accountNo: account.accountNo };
  validateToss(credentials);
  const fingerprint = await credentialFingerprint(`${credentials.accountSeq}:${credentials.accountNo}:${credentials.clientId}`);
  const accountRef = `••••-${credentials.accountNo.slice(-4)}#${fingerprint}`;
  const existing = (await listBrokerConnections(userId)).find((item) => item.provider === "toss_investment" && item.accountRef === accountRef);
  const id = existing?.id ?? `TOSS-${crypto.randomUUID()}`;
  const sealed = await encryptCredential(credentials, userId, id);
  await saveBrokerConnection({ id, userId, provider: "toss_investment", mode: "production", accountLabel: input.accountLabel.trim() || "토스증권", accountRef, credentialCiphertext: sealed, status: "pending" });
  const tokenSealed = await encryptCredential({ accessToken: issued.accessToken }, userId, `token:${id}`);
  await saveBrokerToken(id, tokenSealed, issued.expiresAt);
  try {
    const snapshot = await getLiveAccount(userId, id);
    await updateBrokerConnectionState(userId, id, "connected", null);
    await addAudit(userId, "LIVE_BROKER_CONNECTED", id, { provider: "toss_investment", accountRef });
    return { connection: (await listBrokerConnections(userId)).find((item) => item.id === id), account: snapshot };
  } catch (error) {
    const message = brokerFailure(error, "CONNECTION_FAILED").message;
    await updateBrokerConnectionState(userId, id, "error", message.slice(0, 300));
    await addAudit(userId, "LIVE_BROKER_CONNECTION_FAILED", id, { provider: "toss_investment", error: message.slice(0, 120) });
    throw error;
  }
}

export async function connectKiwoom(userId: string, input: { mode: KiwoomMode; accountLabel: string; appKey: string; secretKey: string }) {
  const client = { appKey: input.appKey.trim(), secretKey: input.secretKey.trim() };
  if (client.appKey.length < 8 || client.secretKey.length < 8) throw new Error("키움증권 App Key와 Secret Key를 확인하세요.");
  const issued = await issueKiwoomToken(client, input.mode);
  const accountNo = await getKiwoomAccountNumber(input.mode, issued.accessToken);
  const credentials: KiwoomCredentials = { ...client, accountNo };
  validateKiwoom(credentials);
  const fingerprint = await credentialFingerprint(`${accountNo}:${client.appKey}`);
  const accountRef = `${maskAccount(accountNo.slice(0, 8), accountNo.slice(8))}#${fingerprint}`;
  const existing = (await listBrokerConnections(userId)).find((item) => item.provider === "kiwoom" && item.accountRef === accountRef);
  const id = existing?.id ?? `KIWOOM-${crypto.randomUUID()}`;
  const sealed = await encryptCredential(credentials, userId, id);
  await saveBrokerConnection({ id, userId, provider: "kiwoom", mode: input.mode, accountLabel: input.accountLabel.trim() || "키움증권", accountRef, credentialCiphertext: sealed, status: "pending" });
  const tokenSealed = await encryptCredential({ accessToken: issued.accessToken }, userId, `token:${id}`);
  await saveBrokerToken(id, tokenSealed, issued.expiresAt);
  try {
    const account = await getLiveAccount(userId, id);
    await updateBrokerConnectionState(userId, id, "connected", null);
    await addAudit(userId, "LIVE_BROKER_CONNECTED", id, { provider: "kiwoom", mode: input.mode, accountRef });
    return { connection: (await listBrokerConnections(userId)).find((item) => item.id === id), account };
  } catch (error) {
    const message = brokerFailure(error, "CONNECTION_FAILED").message;
    await updateBrokerConnectionState(userId, id, "error", message.slice(0, 300));
    await addAudit(userId, "LIVE_BROKER_CONNECTION_FAILED", id, { provider: "kiwoom", error: message.slice(0, 120) });
    throw error;
  }
}

export async function disconnectLiveBroker(userId: string, connectionId: string) {
  await deleteBrokerToken(connectionId);
  const deleted = await deleteBrokerConnection(userId, connectionId);
  if (deleted) await addAudit(userId, "LIVE_BROKER_DISCONNECTED", connectionId, {});
  return deleted;
}

export async function getLiveAccount(userId: string, connectionId: string) {
  const bundle = await connectionBundle(userId, connectionId);
  const token = await accessToken(bundle);
  const account = bundle.provider === "korea_investment"
    ? await getKisAccount(bundle.credentials, bundle.connection.mode as KisMode, token)
    : bundle.provider === "kiwoom"
      ? await getKiwoomAccount(bundle.credentials, bundle.connection.mode as KiwoomMode, token)
      : await getTossAccount(bundle.credentials, token);
  await updateBrokerConnectionState(userId, connectionId, "connected", null);
  return account;
}

export async function getLiveQuote(userId: string, connectionId: string, symbol: string, venue: "KRX" | "NXT" | "SOR" = "SOR") {
  const bundle = await connectionBundle(userId, connectionId);
  const token = await accessToken(bundle);
  return bundle.provider === "korea_investment"
    ? getKisQuote(bundle.credentials, bundle.connection.mode as KisMode, token, symbol, venue === "KRX" ? "KRX" : venue === "NXT" ? "NXT" : "UNIFIED")
    : bundle.provider === "kiwoom"
      ? getKiwoomQuote(bundle.credentials, bundle.connection.mode as KiwoomMode, token, symbol, venue)
      : getTossQuote(bundle.credentials, token, symbol);
}

async function requestHash(value: unknown) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function previewLiveOrder(userId: string, request: LiveOrderRequestRecord) {
  validateOrder(request);
  const bundle = await connectionBundle(userId, request.connectionId);
  if (bundle.connection.mode !== "production") throw new Error("실거래 주문은 production 계좌 연결에서만 가능합니다.");
  if (bundle.provider === "toss_investment" && (request.venue !== "SOR" || request.timeInForce !== "DAY")) throw new Error("토스증권 국내주식은 SOR·DAY 주문만 지원합니다.");
  const policy = await getLiveRiskPolicy(userId);
  if (!policy.liveEnabled) throw new Error("사용자 실거래 허용이 꺼져 있습니다.");
  if (policy.killSwitch) throw new Error("사용자 비상정지가 활성화되어 있습니다.");
  if (request.quantity > policy.maxOrderQuantity) throw new Error(`주문당 최대수량 ${policy.maxOrderQuantity}주를 초과했습니다.`);
  if (policy.allowedSymbols.length && !policy.allowedSymbols.includes(request.symbol)) throw new Error("허용 종목 목록에 없는 종목입니다.");
  const quote = await getLiveQuote(userId, request.connectionId, request.symbol, request.venue);
  const referencePrice = request.orderType === "LIMIT" ? request.price ?? 0 : Math.ceil((request.side === "BUY" ? quote.bestAsk ?? quote.lastPrice : quote.bestBid ?? quote.lastPrice) * (request.side === "BUY" ? 1.03 : 1));
  const estimatedNotional = referencePrice * request.quantity;
  if (estimatedNotional > policy.maxOrderNotional) throw new Error(`주문당 최대금액 ${policy.maxOrderNotional.toLocaleString("ko-KR")}원을 초과했습니다.`);
  const usage = await getLiveRiskUsage(userId);
  if (usage.dailyNotional + estimatedNotional > policy.maxDailyNotional) throw new Error("일일 주문금액 한도를 초과합니다.");
  if (usage.openOrders >= policy.maxOpenOrders) throw new Error("미체결 주문 한도를 초과합니다.");
  const account = await getLiveAccount(userId, request.connectionId);
  if (request.side === "BUY" && account.deposit < estimatedNotional) throw new Error("주문가능 현금이 부족합니다.");
  if (request.side === "SELL") {
    const available = bundle.provider === "toss_investment"
      ? await getTossSellableQuantity(bundle.credentials, await accessToken(bundle), request.symbol)
      : account.positions.find((item) => item.symbol === request.symbol)?.availableQuantity ?? 0;
    if (available < request.quantity) throw new Error("매도가능 수량이 부족합니다.");
  }
  const preview = await createLiveOrderPreview({ userId, connectionId: request.connectionId, requestHash: await requestHash(request), request, quotePrice: quote.lastPrice, estimatedNotional });
  await addAudit(userId, "LIVE_ORDER_PREVIEWED", preview.id, { provider: bundle.provider, symbol: request.symbol, side: request.side, quantity: request.quantity, estimatedNotional, venue: request.venue });
  return { ...preview, quote, confirmationText: LIVE_CONFIRMATION, globalLiveEnabled: GLOBAL_LIVE_ENABLED(), risk: { dailyNotional: usage.dailyNotional, dailyLimit: policy.maxDailyNotional } };
}

export async function submitPreviewedLiveOrder(userId: string, previewId: string, confirmationText: string) {
  if (!GLOBAL_LIVE_ENABLED()) throw new Error("서버 실거래 스위치 또는 고정 출발 IP 준비가 잠겨 있습니다.");
  if (confirmationText.trim() !== LIVE_CONFIRMATION) throw new Error(`확인 문구 '${LIVE_CONFIRMATION}'을 정확히 입력하세요.`);
  const preview = await consumeLiveOrderPreview(userId, previewId);
  if (!preview) throw new Error("주문 미리보기가 만료되었거나 이미 사용되었습니다.");
  const policy = await getLiveRiskPolicy(userId);
  if (!policy.liveEnabled || policy.killSwitch) throw new Error("실거래가 잠겨 있습니다.");
  const connection = await getBrokerConnectionSecret(userId, preview.connectionId);
  if (!connection || connection.mode !== "production" || connection.status !== "connected") throw new Error("연결된 실전 계좌를 확인하세요.");
  const clientOrderId = `LIVE-${previewId}`;
  const orderId = `LORD-${crypto.randomUUID()}`;
  const pending = await createPendingLiveOrder({ id: orderId, userId, connectionId: preview.connectionId, clientOrderId, request: preview.request });
  if (!pending) {
    const existing = (await listLiveOrders(userId, 200)).find((item) => item.clientOrderId === clientOrderId);
    if (existing) return existing;
    throw new Error("실전 주문 원장을 생성할 수 없습니다.");
  }
  const bundle = await connectionBundle(userId, preview.connectionId);
  try {
    const token = await accessToken(bundle);
    const receipt = bundle.provider === "korea_investment"
      ? await submitKisCashOrder(bundle.credentials, bundle.connection.mode as KisMode, token, preview.request)
      : bundle.provider === "kiwoom"
        ? await submitKiwoomCashOrder(bundle.credentials, bundle.connection.mode as KiwoomMode, token, preview.request)
        : await submitTossCashOrder(bundle.credentials, token, { ...preview.request, clientOrderId });
    if (!receipt.brokerOrderId) throw new KisApiError("ORDER_ID_MISSING", "증권사 주문번호가 반환되지 않아 대사가 필요합니다.", 502, true);
    const updated = await updateLiveOrderBrokerState(userId, orderId, { brokerOrderId: receipt.brokerOrderId, brokerOrgNo: receipt.brokerOrgNo || null, status: "SUBMITTED", brokerCode: receipt.code, brokerMessage: receipt.message });
    await addAudit(userId, "LIVE_ORDER_SUBMITTED", orderId, { provider: bundle.provider, brokerOrderId: receipt.brokerOrderId, symbol: preview.request.symbol, side: preview.request.side, quantity: preview.request.quantity, venue: preview.request.venue });
    return updated;
  } catch (error) {
    const failure = brokerFailure(error, "ORDER_FAILED");
    const status = failure.uncertain ? "UNKNOWN" : "REJECTED";
    await updateLiveOrderBrokerState(userId, orderId, { status, brokerCode: failure.code, brokerMessage: failure.message });
    await addAudit(userId, status === "UNKNOWN" ? "LIVE_ORDER_UNCERTAIN" : "LIVE_ORDER_REJECTED", orderId, { code: failure.code, reason: failure.message });
    throw failure;
  }
}

export async function cancelLiveOrder(userId: string, orderId: string) {
  if (!GLOBAL_LIVE_ENABLED()) throw new Error("서버 실거래 스위치 또는 고정 출발 IP 준비가 잠겨 있습니다.");
  const order = await getLiveOrder(userId, orderId);
  if (!order?.brokerOrderId) throw new Error("취소할 증권사 주문을 찾을 수 없습니다.");
  if (!["SUBMITTED", "PARTIAL", "UNKNOWN"].includes(order.status)) throw new Error("현재 상태에서는 취소할 수 없습니다.");
  const bundle = await connectionBundle(userId, order.connectionId);
  if (bundle.provider === "korea_investment" && !order.brokerOrgNo) throw new Error("한국투자증권 주문 원기관번호가 없어 체결대사가 필요합니다.");
  try {
    const token = await accessToken(bundle);
    const receipt = bundle.provider === "korea_investment"
      ? await cancelKisOrder(bundle.credentials, bundle.connection.mode as KisMode, token, { brokerOrderId: order.brokerOrderId, brokerOrgNo: order.brokerOrgNo!, quantity: Math.max(1, order.quantity - order.executedQuantity), venue: order.venue })
      : bundle.provider === "kiwoom"
        ? await cancelKiwoomOrder(bundle.credentials, bundle.connection.mode as KiwoomMode, token, { brokerOrderId: order.brokerOrderId, symbol: order.symbol, venue: order.venue })
        : await cancelTossOrder(bundle.credentials, token, order.brokerOrderId);
    const updated = await updateLiveOrderBrokerState(userId, orderId, { status: "CANCEL_REQUESTED", brokerCode: receipt.code, brokerMessage: receipt.message });
    await addAudit(userId, "LIVE_ORDER_CANCEL_REQUESTED", orderId, { provider: bundle.provider, brokerOrderId: order.brokerOrderId });
    return updated;
  } catch (error) {
    const failure = brokerFailure(error, "CANCEL_FAILED");
    if (failure.uncertain) await updateLiveOrderBrokerState(userId, orderId, { status: "UNKNOWN", brokerCode: failure.code, brokerMessage: failure.message });
    throw failure;
  }
}

function kstDate() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", ""); }
function numeric(value: unknown) { const parsed = Number(String(value ?? "0").replaceAll(",", "")); return Number.isFinite(parsed) ? parsed : 0; }

export async function reconcileLiveOrders(userId: string, connectionId: string) {
  const bundle = await connectionBundle(userId, connectionId);
  const token = await accessToken(bundle);
  const localOrders = await listLiveOrdersForConnection(userId, connectionId);
  let updatedCount = 0;
  let brokerRows = 0;
  if (bundle.provider === "toss_investment") {
    const orders = await getTossOrders(bundle.credentials, token);
    brokerRows = orders.length;
    for (const local of localOrders) {
      const broker = orders.find((item) => item.orderId === local.brokerOrderId);
      if (!broker) continue;
      const statusMap: Record<string, string> = { PENDING: "SUBMITTED", PENDING_CANCEL: "CANCEL_REQUESTED", PARTIAL_FILLED: "PARTIAL", FILLED: "FILLED", CANCELED: "CANCELLED", REJECTED: "REJECTED", CANCEL_REJECTED: "SUBMITTED", REPLACE_REJECTED: "SUBMITTED", REPLACED: "CANCELLED" };
      const status = statusMap[broker.status] ?? "UNKNOWN";
      if (status !== local.status || broker.filledQuantity !== local.executedQuantity || broker.averageFilledPrice !== local.averagePrice) {
        await updateLiveOrderBrokerState(userId, local.id, { status, executedQuantity: broker.filledQuantity, averagePrice: broker.averageFilledPrice, brokerCode: "RECONCILED", brokerMessage: "토스증권 주문체결조회 대사 완료" });
        updatedCount += 1;
      }
    }
  } else if (bundle.provider === "kiwoom") {
    const orders = await getKiwoomOrders(bundle.credentials, bundle.connection.mode as KiwoomMode, token);
    brokerRows = orders.length;
    for (const local of localOrders) {
      const broker = orders.find((item) => item.orderId === local.brokerOrderId);
      if (!broker) continue;
      const cancelled = /취소|CANCEL/i.test(broker.status);
      const rejected = /거부|REJECT/i.test(broker.status);
      const status = rejected ? "REJECTED" : cancelled ? "CANCELLED" : broker.filledQuantity >= local.quantity ? "FILLED" : broker.filledQuantity > 0 ? "PARTIAL" : broker.remainingQuantity === 0 && local.status === "CANCEL_REQUESTED" ? "CANCELLED" : "SUBMITTED";
      if (status !== local.status || broker.filledQuantity !== local.executedQuantity || broker.averageFilledPrice !== local.averagePrice) {
        await updateLiveOrderBrokerState(userId, local.id, { status, executedQuantity: broker.filledQuantity, averagePrice: broker.averageFilledPrice, brokerCode: "RECONCILED", brokerMessage: "키움증권 주문체결조회 대사 완료" });
        updatedCount += 1;
      }
    }
  } else {
    const orders = await getKisDailyOrders(bundle.credentials, bundle.connection.mode as KisMode, token, kstDate());
    brokerRows = orders.length;
    for (const local of localOrders) {
      if (!local.brokerOrderId) continue;
      const broker = orders.find((item) => String(item.odno ?? item.ODNO ?? "") === local.brokerOrderId);
      if (!broker) continue;
      const executedQuantity = numeric(broker.tot_ccld_qty ?? broker.TOT_CCLD_QTY);
      const remaining = numeric(broker.rmn_qty ?? broker.RMN_QTY);
      const cancelled = String(broker.cncl_yn ?? broker.CNCL_YN ?? "N") === "Y";
      const averagePrice = numeric(broker.avg_prvs ?? broker.AVG_PRVS) || (executedQuantity > 0 ? Math.round(numeric(broker.tot_ccld_amt ?? broker.TOT_CCLD_AMT) / executedQuantity) : 0);
      const status = cancelled ? "CANCELLED" : executedQuantity >= local.quantity ? "FILLED" : executedQuantity > 0 ? "PARTIAL" : remaining === 0 && local.status === "CANCEL_REQUESTED" ? "CANCELLED" : "SUBMITTED";
      if (status !== local.status || executedQuantity !== local.executedQuantity || (averagePrice || null) !== local.averagePrice) {
        await updateLiveOrderBrokerState(userId, local.id, { status, executedQuantity, averagePrice: averagePrice || null, brokerCode: "RECONCILED", brokerMessage: "한국투자증권 주문체결조회 대사 완료" });
        updatedCount += 1;
      }
    }
  }
  await addAudit(userId, "LIVE_ORDERS_RECONCILED", connectionId, { provider: bundle.provider, brokerRows, localRows: localOrders.length, updated: updatedCount });
  return { checked: localOrders.length, brokerRows, updated: updatedCount, orders: await listLiveOrders(userId) };
}

export { listLiveOrders, LIVE_CONFIRMATION };
