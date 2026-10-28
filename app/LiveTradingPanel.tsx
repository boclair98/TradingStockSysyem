"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { NEXTRADE_INSTRUMENTS } from "../engine/instrumentMaster";

type Connection = { id: string; provider: string; mode: "sandbox" | "production"; accountLabel: string; accountRef: string; status: "pending" | "connected" | "error" | "disabled"; hasCredentials: boolean; lastCheckedAt: string | null; lastError: string | null };
type Account = { deposit: number; totalEvaluation: number; netAsset: number; purchaseAmount: number; profitLoss: number; receivedAt: string; positions: Array<{ symbol: string; name: string; quantity: number; availableQuantity: number; averagePrice: number; currentPrice: number; evaluationAmount: number; profitLoss: number }> };
type Policy = { liveEnabled: boolean; automationEnabled: boolean; killSwitch: boolean; maxOrderQuantity: number; maxOrderNotional: number; maxDailyNotional: number; maxOpenOrders: number; allowedSymbols: string[]; acknowledgedAt: string | null; updatedAt: string; version: number };
type Usage = { dailyNotional: number; openOrders: number };
type Readiness = { ready: boolean; service: { globalLiveEnabled: boolean; liveTradingSwitch: boolean; egressReady: boolean; encryptionKeyConfigured: boolean; blockers: string[]; environment: string; liveMarket: boolean; providers: string[]; executionReconciliation: string }; productionConnection: Connection | null; policy: Policy; usage: Usage };
type LiveOrder = { id: string; connectionId: string; clientOrderId: string; brokerOrderId: string | null; symbol: string; side: "BUY" | "SELL"; orderType: "LIMIT" | "MARKET"; timeInForce: "DAY" | "IOC" | "FOK"; venue: "KRX" | "NXT" | "SOR"; price: number | null; quantity: number; executedQuantity: number; averagePrice: number | null; status: string; brokerMessage: string | null; submittedAt: string; updatedAt: string };
type PreviewRequest = { connectionId: string; symbol: string; side: "BUY" | "SELL"; orderType: "LIMIT" | "MARKET"; timeInForce: "DAY" | "IOC" | "FOK"; venue: "KRX" | "NXT" | "SOR"; quantity: number; price: number | null };
type Preview = { id: string; request: PreviewRequest; quotePrice: number; estimatedNotional: number; expiresAt: string; confirmationText: string; globalLiveEnabled: boolean; quote: { lastPrice: number; bestBid: number | null; bestAsk: number | null; changeRate: number | null; receivedAt: string } };

const money = (value: number | null | undefined) => `${new Intl.NumberFormat("ko-KR").format(value ?? 0)}원`;
const count = (value: number | null | undefined) => new Intl.NumberFormat("ko-KR").format(value ?? 0);
const time = (value: string | null | undefined) => value ? new Date(value).toLocaleString("ko-KR", { hour12: false }) : "—";
const providerLabel = (provider: string) => provider === "toss_investment" ? "토스증권" : provider === "korea_investment" ? "한국투자증권" : provider === "kiwoom" ? "키움증권" : provider;
const providerCode = (provider: string | undefined) => provider === "toss_investment" ? "TOSS" : provider === "korea_investment" ? "KIS" : provider === "kiwoom" ? "KIWOOM" : "BROKER";

function PreviewCountdown({ expiresAt }: { expiresAt: string }) {
  const [seconds, setSeconds] = useState(60);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSeconds(Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1_000)));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  return <time>{seconds ? `${seconds}초 남음` : "미리보기 만료"}</time>;
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `요청 실패 (${response.status})`);
  return payload;
}

export default function LiveTradingPanel({ authenticated }: { authenticated: boolean }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [account, setAccount] = useState<Account | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [usage, setUsage] = useState<Usage>({ dailyNotional: 0, openOrders: 0 });
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [orders, setOrders] = useState<LiveOrder[]>([]);
  const [message, setMessage] = useState("실계좌 연결을 확인하는 중");
  const [busy, setBusy] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [connectProvider, setConnectProvider] = useState<"toss_investment" | "korea_investment" | "kiwoom">("toss_investment");
  const [connectMode, setConnectMode] = useState<"sandbox" | "production">("production");
  const [connectForm, setConnectForm] = useState({ accountLabel: "토스증권 실전계좌", clientId: "", clientSecret: "", accountSeq: "", appKey: "", appSecret: "", accountNumber: "", productCode: "01", htsId: "" });
  const [acknowledgement, setAcknowledgement] = useState("");
  const [symbol, setSymbol] = useState(NEXTRADE_INSTRUMENTS[0].symbol);
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"LIMIT" | "MARKET">("LIMIT");
  const [timeInForce, setTimeInForce] = useState<"DAY" | "IOC" | "FOK">("DAY");
  const [venue, setVenue] = useState<"KRX" | "NXT" | "SOR">("SOR");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState(String(NEXTRADE_INSTRUMENTS[0].basePrice));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [previewExpired, setPreviewExpired] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [cancelCandidate, setCancelCandidate] = useState<LiveOrder | null>(null);
  const [orderFilter, setOrderFilter] = useState<"ALL" | "OPEN" | "DONE" | "ATTENTION">("ALL");

  const selectedConnection = useMemo(() => connections.find((item) => item.id === connectionId) ?? null, [connections, connectionId]);
  const tossSelected = selectedConnection?.provider === "toss_investment";
  const selectedInstrument = useMemo(() => NEXTRADE_INSTRUMENTS.find((item) => item.symbol === symbol) ?? null, [symbol]);
  const filteredOrders = useMemo(() => orders.filter((order) => {
    if (orderFilter === "OPEN") return ["PENDING", "SUBMITTED", "PARTIAL", "CANCEL_REQUESTED"].includes(order.status);
    if (orderFilter === "DONE") return ["FILLED", "CANCELLED", "REJECTED"].includes(order.status);
    if (orderFilter === "ATTENTION") return order.status === "UNKNOWN" || Boolean(order.brokerMessage && order.status === "REJECTED");
    return true;
  }), [orders, orderFilter]);

  const load = useCallback(async (quiet = false) => {
    if (!authenticated) return;
    try {
      const [brokerPayload, riskPayload, orderPayload, readinessPayload] = await Promise.all([
        jsonRequest<{ connections: Connection[] }>("/api/brokers"),
        jsonRequest<{ policy: Policy; usage: Usage }>("/api/live/risk"),
        jsonRequest<{ orders: LiveOrder[] }>("/api/live/orders"),
        jsonRequest<Readiness>("/api/live/readiness"),
      ]);
      setConnections(brokerPayload.connections);
      setPolicy(riskPayload.policy);
      setUsage(riskPayload.usage);
      setOrders(orderPayload.orders);
      setReadiness(readinessPayload);
      setLastUpdatedAt(new Date().toISOString());
      setConnectionId((current) => current || readinessPayload.productionConnection?.id || brokerPayload.connections.find((item) => item.status === "connected")?.id || "");
      if (!quiet) setMessage(readinessPayload.ready ? "실전 주문 게이트 준비 완료" : brokerPayload.connections.length ? `실전 주문 잠금 · ${readinessPayload.service.blockers[0] ?? "사용자 계좌·위험정책 확인 필요"}` : "토스·한국투자·키움 중 본인 실계좌를 먼저 연결하세요");
    } catch (error) {
      if (!quiet) setMessage(error instanceof Error ? error.message : "실거래 상태 확인 실패");
    }
  }, [authenticated]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);
  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setInterval(() => void load(true), 12_000);
    return () => window.clearInterval(timer);
  }, [authenticated, load]);
  useEffect(() => {
    if (!preview) return;
    const remainingMs = Math.max(0, new Date(preview.expiresAt).getTime() - Date.now());
    const timer = window.setTimeout(() => setPreviewExpired(true), remainingMs);
    return () => window.clearTimeout(timer);
  }, [preview]);

  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage("증권사 토큰과 실계좌 잔고를 조회해 연결을 검증하는 중");
    try {
      const result = await jsonRequest<{ connection: Connection; account: Account }>("/api/brokers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: connectProvider, mode: connectProvider === "toss_investment" ? "production" : connectMode, ...connectForm, accountSeq: connectForm.accountSeq ? Number(connectForm.accountSeq) : undefined }) });
      setAccount(result.account); setConnectionId(result.connection.id); setShowConnect(false);
      setConnectForm((current) => ({ ...current, clientId: "", clientSecret: "", appKey: "", appSecret: "", accountNumber: "" }));
      setMessage("실계좌 연결 검증 완료 · 비밀정보는 암호화 저장됨");
      await load(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "계좌 연결 실패"); }
    finally { setBusy(false); }
  }

  async function refreshAccount() {
    if (!connectionId) return;
    setBusy(true); setMessage("증권사 실시간 잔고 조회 중");
    try {
      const result = await jsonRequest<{ account: Account }>(`/api/live/account?connectionId=${encodeURIComponent(connectionId)}`);
      setAccount(result.account); setLastUpdatedAt(result.account.receivedAt); setMessage(`잔고 동기화 완료 · ${time(result.account.receivedAt)}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "잔고조회 실패"); }
    finally { setBusy(false); }
  }

  async function updatePolicy(next: Partial<Policy>, includeAck = false) {
    if (!policy) return;
    setBusy(true);
    try {
      const result = await jsonRequest<{ policy: Policy }>("/api/live/risk", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...next, expectedVersion: policy.version, acknowledgement: includeAck ? acknowledgement : undefined }) });
      setPolicy(result.policy); setAcknowledgement(""); setMessage(result.policy.killSwitch ? "비상정지 활성화 · 모든 신규 실전 주문 차단" : result.policy.liveEnabled ? "사용자 실거래 허용 · 주문별 최종확인은 계속 필요" : "사용자 실거래 잠금");
      await load(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "위험정책 변경 실패"); }
    finally { setBusy(false); }
  }

  async function createPreview(event: FormEvent) {
    event.preventDefault();
    if (!connectionId) { setMessage("연결된 실전 계좌를 선택하세요"); return; }
    setBusy(true); setPreview(null); setConfirmationText(""); setMessage("실시간 시세·잔고·위험한도 사전검사 중");
    try {
      const result = await jsonRequest<{ preview: Preview }>("/api/live/orders/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectionId, symbol, side, orderType, timeInForce: tossSelected ? "DAY" : timeInForce, venue: tossSelected ? "SOR" : venue, quantity: Number(quantity), price: orderType === "LIMIT" ? Number(price) : null }) });
      setPreview(result.preview); setPreviewExpired(false); setMessage("주문 미리보기 생성 · 60초 안에 확인해야 전송됩니다");
    } catch (error) { setMessage(error instanceof Error ? error.message : "주문 미리보기 실패"); }
    finally { setBusy(false); }
  }

  async function submitLiveOrder() {
    if (!preview) return;
    setBusy(true); setMessage("실전 주문을 증권사로 전송 중 · 창을 닫지 마세요");
    try {
      const result = await jsonRequest<{ submitted: boolean; order: LiveOrder }>("/api/live/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ previewId: preview.id, confirmationText }) });
      setPreview(null); setConfirmationText(""); setMessage(`실전 주문 접수 · 증권사 주문번호 ${result.order.brokerOrderId ?? "대사 필요"}`);
      await load(true); await refreshAccount();
    } catch (error) { setMessage(error instanceof Error ? error.message : "실전 주문 실패"); await load(true); }
    finally { setBusy(false); }
  }

  async function confirmCancelOrder() {
    const candidate = cancelCandidate;
    if (!candidate) return;
    setCancelCandidate(null);
    setBusy(true);
    try { await jsonRequest(`/api/live/orders/${encodeURIComponent(candidate.id)}`, { method: "DELETE" }); setMessage("실전 취소 요청 접수 · 체결대사로 최종 상태를 확인하세요"); await load(true); }
    catch (error) { setMessage(error instanceof Error ? error.message : "취소 실패"); }
    finally { setBusy(false); }
  }

  async function reconcile() {
    if (!connectionId) return;
    setBusy(true); setMessage("증권사 당일 주문·체결 내역과 원장을 대사하는 중");
    try {
      const result = await jsonRequest<{ reconciliation: { checked: number; updated: number; orders: LiveOrder[] } }>("/api/live/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectionId }) });
      setOrders(result.reconciliation.orders); setMessage(`체결대사 완료 · ${result.reconciliation.checked}건 확인 / ${result.reconciliation.updated}건 갱신`); await refreshAccount();
    } catch (error) { setMessage(error instanceof Error ? error.message : "체결대사 실패"); }
    finally { setBusy(false); }
  }

  if (!authenticated) return <section className="live-console locked" id="live-trading"><div className="live-console-head"><div><span className="section-kicker">LIVE BROKER ROUTING</span><h2>실거래 콘솔</h2><p>로그인 후 본인 명의 증권계좌를 연결할 수 있습니다.</p></div><span className="live-state blocked">AUTH REQUIRED</span></div></section>;

  return (
    <section className="live-console" id="live-trading">
      <div className="live-console-head">
        <div><span className="section-kicker">MULTI-BROKER ORDER ROUTING · KRX / NXT / SOR</span><h2>실거래 주문·체결 콘솔</h2><p>본인 증권계좌를 연결하고 최신 잔고·시세를 확인한 뒤, 주문별 최종확인을 거쳐 전송합니다.</p></div>
        <div className={`live-state ${readiness?.ready ? "ready" : "blocked"}`}><span className={`tiny-dot ${readiness?.ready ? "green" : "amber"}`} />{readiness?.ready ? "LIVE READY" : "SAFETY LOCKED"}</div>
      </div>

      <div className="live-guardrail"><strong>실제 현금 주문</strong><div><span>서버 허용 + 고정 출발 IP + 사용자 위험동의 + 60초 주문확인 네 단계가 모두 통과해야 전송됩니다. 현재 환경: {readiness?.service.environment ?? "확인 중"} · {readiness?.service.liveMarket ? "실시간 시장" : "인증·검증 모드"}</span>{!readiness ? <small className="live-blockers">서버 게이트 확인 중</small> : readiness.service.blockers.length ? <small className="live-blockers">잠금 사유: {readiness.service.blockers.join(" · ")}</small> : <small className="live-blockers ready">모든 서버 게이트 통과</small>}</div></div>
      <div className="live-message" aria-live="polite" role="status"><span className={busy ? "pulse-dot" : "tiny-dot green"} />{message}<time>{lastUpdatedAt ? `마지막 동기화 ${time(lastUpdatedAt)}` : ""}</time></div>

      <div className="live-grid">
        <section className="live-card connection-card">
          <div className="live-card-title"><div><span>01 · ACCOUNT</span><strong>실계좌 연결</strong></div><button className="ghost-button" onClick={() => setShowConnect((value) => !value)}>{showConnect ? "닫기" : "계좌 추가"}</button></div>
          {connections.length ? <div className="connection-list">{connections.map((connection) => <button key={connection.id} className={connection.id === connectionId ? "active" : ""} aria-pressed={connection.id === connectionId} onClick={() => { setConnectionId(connection.id); setAccount(null); setPreview(null); if (connection.provider === "toss_investment") { setVenue("SOR"); setTimeInForce("DAY"); } }}><span><strong>{connection.accountLabel}</strong><small>{providerLabel(connection.provider)} · {connection.accountRef}</small></span><em className={connection.status}>{connection.mode === "production" ? "실전" : "모의"} · {connection.status}</em></button>)}</div> : <div className="live-empty">연결된 계좌가 없습니다. 사용자가 본인 증권사에서 발급한 Open API 키를 직접 등록하세요.</div>}
          {showConnect ? <form className="connect-form" onSubmit={connect} autoComplete="off">
            <ol className="connect-steps" aria-label="계좌 연결 단계"><li className="active">증권사 선택</li><li>API 자격증명</li><li>연결 검증</li></ol>
            <div className="provider-switch">
              <button type="button" className={connectProvider === "toss_investment" ? "active" : ""} onClick={() => { setConnectProvider("toss_investment"); setConnectMode("production"); setConnectForm((value) => ({ ...value, accountLabel: "토스증권 실전계좌" })); }}>토스증권</button>
              <button type="button" className={connectProvider === "korea_investment" ? "active" : ""} onClick={() => { setConnectProvider("korea_investment"); setConnectForm((value) => ({ ...value, accountLabel: "한국투자증권 실전계좌" })); }}>한국투자</button>
              <button type="button" className={connectProvider === "kiwoom" ? "active" : ""} onClick={() => { setConnectProvider("kiwoom"); setConnectForm((value) => ({ ...value, accountLabel: "키움증권 실전계좌" })); }}>키움증권</button>
            </div>
            {connectProvider !== "toss_investment" ? <div className="mode-switch"><button type="button" className={connectMode === "production" ? "active danger" : ""} onClick={() => setConnectMode("production")}>실전투자</button><button type="button" className={connectMode === "sandbox" ? "active" : ""} onClick={() => setConnectMode("sandbox")}>모의투자</button></div> : null}
            <label>표시 이름<input value={connectForm.accountLabel} onChange={(event) => setConnectForm({ ...connectForm, accountLabel: event.target.value })} /></label>
            {connectProvider === "toss_investment" ? <>
              <label>Client ID<input type="password" value={connectForm.clientId} onChange={(event) => setConnectForm({ ...connectForm, clientId: event.target.value })} required /></label>
              <label>Client Secret<input type="password" value={connectForm.clientSecret} onChange={(event) => setConnectForm({ ...connectForm, clientSecret: event.target.value })} required /></label>
              <label>계좌 식별값 accountSeq (선택)<input inputMode="numeric" value={connectForm.accountSeq} onChange={(event) => setConnectForm({ ...connectForm, accountSeq: event.target.value.replace(/\D/g, "") })} placeholder="비우면 국내주식 계좌 자동 선택" /></label>
              <small>토스증권 WTS → 설정 → Open API에서 발급합니다. 국내주식은 SOR·DAY로 전송됩니다.</small>
            </> : <>
              <label>App Key<input type="password" value={connectForm.appKey} onChange={(event) => setConnectForm({ ...connectForm, appKey: event.target.value })} required /></label>
              <label>{connectProvider === "kiwoom" ? "Secret Key" : "App Secret"}<input type="password" value={connectForm.appSecret} onChange={(event) => setConnectForm({ ...connectForm, appSecret: event.target.value })} required /></label>
              {connectProvider === "korea_investment" ? <><div className="connect-row"><label>계좌번호 앞 8자리<input inputMode="numeric" maxLength={8} value={connectForm.accountNumber} onChange={(event) => setConnectForm({ ...connectForm, accountNumber: event.target.value.replace(/\D/g, "") })} required /></label><label>상품코드<input inputMode="numeric" maxLength={2} value={connectForm.productCode} onChange={(event) => setConnectForm({ ...connectForm, productCode: event.target.value.replace(/\D/g, "") })} required /></label></div><label>KIS 고객 ID (HTS ID · 선택)<input value={connectForm.htsId} onChange={(event) => setConnectForm({ ...connectForm, htsId: event.target.value })} /></label></> : <small>키움 REST API에서 발급한 키를 입력하면 계좌번호를 자동 조회합니다. 모의투자는 KRX만 지원합니다.</small>}
            </>}
            <button className="primary-button" disabled={busy}>토큰·잔고 조회로 연결 검증</button>
            <small>비밀키와 계좌정보는 사용자별 AES-GCM으로 암호화되며 화면·로그·GitHub에 저장되지 않습니다.</small>
            <div className="broker-roadmap"><span><strong>실주문 지원</strong> 토스 · 한국투자 · 키움</span><span><strong>연동 준비</strong> LS증권 · 제휴 API 증권사</span></div>
          </form> : null}
          {selectedConnection ? <div className="connection-meta"><span>상태 <strong>{selectedConnection.status.toUpperCase()}</strong></span><span>최근 확인 <strong>{time(selectedConnection.lastCheckedAt)}</strong></span>{selectedConnection.lastError ? <small>{selectedConnection.lastError}</small> : null}</div> : null}
        </section>

        <section className="live-card account-card">
          <div className="live-card-title"><div><span>02 · BALANCE</span><strong>최신 자산·잔고</strong></div><button className="ghost-button" disabled={!connectionId || busy} onClick={refreshAccount}>지금 조회</button></div>
          {account ? <><div className="account-sync-strip"><span className="tiny-dot green" /> 증권사 수신 {time(account.receivedAt)}</div><div className="account-kpis"><div><span>주문가능현금</span><strong>{money(account.deposit)}</strong></div><div><span>총평가금액</span><strong>{money(account.totalEvaluation)}</strong></div><div><span>평가손익</span><strong className={account.profitLoss >= 0 ? "positive" : "sell-color"}>{money(account.profitLoss)}</strong></div></div><div className="position-list">{account.positions.length ? account.positions.slice(0, 8).map((position) => <div key={position.symbol}><span><strong>{position.name || position.symbol}</strong><small>{position.symbol} · 주문가능 {count(position.availableQuantity)}주</small></span><span><strong>{count(position.quantity)}주</strong><small className={position.profitLoss >= 0 ? "positive" : "sell-color"}>{money(position.profitLoss)}</small></span></div>) : <div className="live-empty">보유 종목이 없습니다.</div>}</div></> : <div className="live-empty">계좌를 선택하고 증권사 조회를 누르면 최신 잔고가 표시됩니다.</div>}
        </section>

        <section className="live-card risk-card">
          <div className="live-card-title"><div><span>03 · RISK GATE</span><strong>실전 안전장치</strong></div><span className={`guard-status ${policy?.killSwitch ? "stopped" : policy?.liveEnabled ? "armed" : "locked"}`}>{policy?.killSwitch ? "KILL SWITCH" : policy?.liveEnabled ? "USER ARMED" : "LOCKED"}</span></div>
          {policy ? <div className="risk-controls-live">
            <label>주문당 최대수량 <span>주</span><input type="number" min="1" value={policy.maxOrderQuantity} onChange={(event) => setPolicy({ ...policy, maxOrderQuantity: Number(event.target.value) })} /></label>
            <label>주문당 최대금액 <span>원</span><input type="number" min="10000" step="10000" value={policy.maxOrderNotional} onChange={(event) => setPolicy({ ...policy, maxOrderNotional: Number(event.target.value) })} /></label>
            <label>일일 최대주문금액 <span>원</span><input type="number" min="10000" step="10000" value={policy.maxDailyNotional} onChange={(event) => setPolicy({ ...policy, maxDailyNotional: Number(event.target.value) })} /></label>
            <label>미체결 최대건수 <span>건</span><input type="number" min="1" value={policy.maxOpenOrders} onChange={(event) => setPolicy({ ...policy, maxOpenOrders: Number(event.target.value) })} /></label>
            <label className="allowed-symbols-field">허용 종목 <span>비우면 전체 허용 · 쉼표로 구분</span><input value={policy.allowedSymbols.join(", ")} onChange={(event) => setPolicy({ ...policy, allowedSymbols: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="005930, 000660" /></label>
            <button className="ghost-button full" disabled={busy} onClick={() => updatePolicy({ maxOrderQuantity: policy.maxOrderQuantity, maxOrderNotional: policy.maxOrderNotional, maxDailyNotional: policy.maxDailyNotional, maxOpenOrders: policy.maxOpenOrders, allowedSymbols: policy.allowedSymbols })}>위험 한도 저장</button>
            <div className="risk-usage"><span>오늘 주문금액 <strong>{money(usage.dailyNotional)}</strong><small>잔여 {money(Math.max(0, policy.maxDailyNotional - usage.dailyNotional))}</small></span><span>미체결 <strong>{count(usage.openOrders)}건</strong><small>한도 {count(policy.maxOpenOrders)}건</small></span></div>
            <label className="ack-field">실거래 활성화 확인문구<input value={acknowledgement} onChange={(event) => setAcknowledgement(event.target.value)} placeholder="실거래 위험을 이해했습니다" /></label>
            <div className="risk-actions"><button className="primary-button" disabled={busy || policy.liveEnabled} onClick={() => updatePolicy({ liveEnabled: true, killSwitch: false }, true)}>사용자 실거래 허용</button><button className="danger-button" disabled={busy} onClick={() => updatePolicy({ killSwitch: true, liveEnabled: false })}>즉시 비상정지</button></div>
          </div> : <div className="live-empty">위험정책을 불러오는 중입니다.</div>}
        </section>
      </div>

      <div className="live-order-grid">
        <section className="live-card order-ticket-live">
          <div className="live-card-title"><div><span>04 · ORDER ENTRY</span><strong>실전 현금주문</strong></div><span className="route-badge">{providerCode(selectedConnection?.provider)} → {tossSelected ? "SOR" : venue}</span></div>
          <form onSubmit={createPreview}>
            <div className="ticket-account-context"><span>{selectedConnection ? `${providerLabel(selectedConnection.provider)} · ${selectedConnection.accountRef}` : "실전 계좌를 먼저 선택하세요"}</span><em>{selectedConnection?.mode === "production" ? "실전" : selectedConnection ? "모의 · 조회 전용" : "미연결"}</em></div>
            <div className="live-ticket-row"><label>종목코드 <span>{selectedInstrument?.displayName ?? "6자리 종목코드"}</span><input list="live-symbols" inputMode="numeric" maxLength={6} value={symbol} onChange={(event) => { const nextSymbol = event.target.value.replace(/\D/g, "").slice(0, 6); const next = NEXTRADE_INSTRUMENTS.find((item) => item.symbol === nextSymbol); setSymbol(nextSymbol); if (next?.basePrice) setPrice(String(next.basePrice)); setPreview(null); }} placeholder="국내주식 6자리" required /><datalist id="live-symbols">{NEXTRADE_INSTRUMENTS.map((instrument) => <option key={instrument.symbol} value={instrument.symbol}>{instrument.displayName}</option>)}</datalist></label><label>라우팅 <span>{tossSelected ? "토스는 SOR 고정" : "주문 시장"}</span><select value={tossSelected ? "SOR" : venue} disabled={tossSelected} onChange={(event) => { setVenue(event.target.value as typeof venue); setPreview(null); }}><option value="SOR">SOR 최선집행</option><option value="NXT">NXT</option><option value="KRX">KRX</option></select></label></div>
            <div className="segmented live-side" role="group" aria-label="매수 또는 매도"><button type="button" aria-pressed={side === "BUY"} className={side === "BUY" ? "selected-buy" : ""} onClick={() => { setSide("BUY"); setPreview(null); }}>매수</button><button type="button" aria-pressed={side === "SELL"} className={side === "SELL" ? "selected-sell" : ""} onClick={() => { setSide("SELL"); setPreview(null); }}>매도</button></div>
            <div className="live-ticket-row"><label>주문유형<select value={orderType} onChange={(event) => { setOrderType(event.target.value as typeof orderType); setPreview(null); }}><option value="LIMIT">지정가</option><option value="MARKET">시장가</option></select></label><label>유효조건 <span>{tossSelected ? "토스는 DAY 고정" : "체결 조건"}</span><select value={tossSelected ? "DAY" : timeInForce} disabled={tossSelected} onChange={(event) => { setTimeInForce(event.target.value as typeof timeInForce); setPreview(null); }}><option value="DAY">DAY</option><option value="IOC">IOC</option><option value="FOK">FOK</option></select></label></div>
            <div className="live-ticket-row"><label>수량 <span>주</span><input type="number" min="1" max={policy?.maxOrderQuantity} step="1" value={quantity} onChange={(event) => { setQuantity(event.target.value); setPreview(null); }} /></label><label>가격 <span>원</span><input type="number" min="0" step={selectedInstrument?.tickSize ?? 1} value={orderType === "MARKET" ? "" : price} disabled={orderType === "MARKET"} onChange={(event) => { setPrice(event.target.value); setPreview(null); }} placeholder={orderType === "MARKET" ? "시장가" : "주문가격"} /></label></div>
            <div className="ticket-estimate"><span>입력 주문금액</span><strong>{orderType === "MARKET" ? "시세 확인 후 계산" : money((Number(price) || 0) * (Number(quantity) || 0))}</strong></div>
            <button type="submit" className={`submit-order ${side === "BUY" ? "buy" : "sell"}`} disabled={busy || !readiness?.ready || selectedConnection?.mode !== "production"}>시세·잔고·한도 사전확인 <span>이 단계에서는 주문을 전송하지 않습니다</span></button>
          </form>
          {preview ? <div className={`order-preview ${previewExpired ? "expired" : ""}`}>
            <div className="preview-head"><strong>실전 주문 최종확인</strong><PreviewCountdown key={preview.expiresAt} expiresAt={preview.expiresAt} /></div>
            <div className="preview-account"><span>출금 계좌</span><strong>{providerLabel(selectedConnection?.provider ?? "")} · {selectedConnection?.accountRef ?? "계좌 확인 필요"}</strong></div>
            <dl>
              <div><dt>종목</dt><dd>{selectedInstrument?.displayName ?? preview.request.symbol}<small>{preview.request.symbol}</small></dd></div>
              <div><dt>구분</dt><dd className={preview.request.side === "BUY" ? "buy-color" : "sell-color"}>{preview.request.side === "BUY" ? "매수" : "매도"}</dd></div>
              <div><dt>주문 조건</dt><dd>{preview.request.orderType} · {preview.request.timeInForce}</dd></div>
              <div><dt>수량 / 가격</dt><dd>{count(preview.request.quantity)}주 · {preview.request.price ? money(preview.request.price) : "시장가"}</dd></div>
              <div><dt>라우팅</dt><dd>{preview.request.venue}</dd></div>
              <div><dt>예상 주문금액</dt><dd>{money(preview.estimatedNotional)}</dd></div>
              <div><dt>현재가</dt><dd>{money(preview.quote.lastPrice)}<small>{time(preview.quote.receivedAt)}</small></dd></div>
              <div><dt>최우선 매수 / 매도</dt><dd>{money(preview.quote.bestBid)} / {money(preview.quote.bestAsk)}</dd></div>
            </dl>
            {previewExpired ? <div className="preview-expired-note">시세와 잔고를 다시 확인하려면 위의 사전확인 버튼을 눌러주세요.</div> : <label>아래 문구를 정확히 입력<input value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} placeholder={preview.confirmationText} /></label>}
            <button type="button" className="danger-button execute-live" disabled={busy || previewExpired || confirmationText !== preview.confirmationText} onClick={submitLiveOrder}>{previewExpired ? "미리보기 만료됨" : "실제 증권사로 주문 전송"}</button>
          </div> : null}
        </section>

        <section className="live-card live-journal">
          <div className="live-card-title"><div><span>05 · EXECUTION RECONCILIATION</span><strong>실전 주문·체결 원장</strong></div><button className="ghost-button" disabled={!connectionId || busy} onClick={reconcile}>지금 체결대사</button></div>
          <div className="journal-filters" role="group" aria-label="주문 상태 필터">{(["ALL", "OPEN", "DONE", "ATTENTION"] as const).map((filter) => <button type="button" key={filter} className={orderFilter === filter ? "active" : ""} aria-pressed={orderFilter === filter} onClick={() => setOrderFilter(filter)}>{filter === "ALL" ? "전체" : filter === "OPEN" ? "진행 중" : filter === "DONE" ? "완료" : "확인 필요"}</button>)}</div>
          <div className="live-orders-table"><div className="live-order-head"><span>주문</span><span>수량</span><span>가격/체결</span><span>상태</span><span /></div>{filteredOrders.length ? filteredOrders.slice(0, 30).map((order) => <div className="live-order-row" key={order.id}><span><strong>{order.symbol} · {order.side === "BUY" ? "매수" : "매도"}</strong><small>{order.venue} · {order.brokerOrderId ?? "주문번호 대기"}</small>{order.brokerMessage ? <small className="broker-message">{order.brokerMessage}</small> : null}</span><span>{count(order.executedQuantity)} / {count(order.quantity)}</span><span>{order.price ? money(order.price) : "시장가"}<small>{order.averagePrice ? `평균 ${money(order.averagePrice)}` : ""}</small></span><span><em className={`live-order-status ${order.status.toLowerCase()}`}>{order.status}</em><small>{time(order.updatedAt)}</small></span><span>{["SUBMITTED", "PARTIAL", "UNKNOWN"].includes(order.status) ? <button className="row-action" onClick={() => setCancelCandidate(order)}>취소</button> : null}</span></div>) : <div className="live-empty">선택한 조건의 주문 기록이 없습니다.</div>}</div>
        </section>
      </div>
      {cancelCandidate ? <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCancelCandidate(null); }}><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="live-cancel-title"><span className="dialog-kicker">LIVE ORDER CANCELLATION</span><h2 id="live-cancel-title">증권사에 실주문 취소를 전송할까요?</h2><dl className="cancel-summary"><div><dt>종목</dt><dd>{cancelCandidate.symbol}</dd></div><div><dt>주문</dt><dd>{cancelCandidate.side === "BUY" ? "매수" : "매도"} {count(cancelCandidate.quantity)}주</dd></div><div><dt>미체결</dt><dd>{count(Math.max(0, cancelCandidate.quantity - cancelCandidate.executedQuantity))}주</dd></div><div><dt>주문번호</dt><dd>{cancelCandidate.brokerOrderId ?? "대사 필요"}</dd></div></dl><p>이미 체결된 수량은 취소되지 않습니다. 취소 전송 후 체결대사로 최종 상태를 확인하세요.</p><div className="dialog-actions"><button type="button" className="ghost-button" onClick={() => setCancelCandidate(null)}>돌아가기</button><button type="button" className="danger-button" autoFocus onClick={() => void confirmCancelOrder()}>실주문 취소 전송</button></div></section></div> : null}
    </section>
  );
}
