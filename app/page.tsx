"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { MatchingEngine, type Execution, type Order, type OrderType, type Side, type TimeInForce } from "../engine/matchingEngine";
import { phaseLabel, type MarketPhase } from "../engine/koreanMarketRules";
import { instrumentFor, NEXTRADE_INSTRUMENTS as INSTRUMENTS } from "../engine/instrumentMaster";
import InstitutionalArchitecturePanel from "./InstitutionalArchitecturePanel";
import LiveTradingPanel from "./LiveTradingPanel";

const DEFAULT_SYMBOL = INSTRUMENTS[0].symbol;

const formatNumber = (value: number) => new Intl.NumberFormat("ko-KR").format(value);
const formatPrice = (value: number | null) => value == null ? "—" : `${formatNumber(value)}원`;
const nowStamp = () => new Date().toLocaleTimeString("ko-KR", { hour12: false }) + "." + String(Date.now() % 1000).padStart(3, "0");

type OrderRow = Order & { filled: number; submittedAt: string };
type ReadinessView = {
  ok: boolean;
  persistence: { ok: boolean; provider: string; latencyMs: number };
  engine: { status: string; sequence: number; recoveredOrders: number };
  safeguards: { mutationSerialization: boolean; distributedLeaderLock?: boolean; durableOrderJournal: boolean; authenticatedOwnership: boolean; selfTradePolicy: string };
};
type RiskView = {
  risk: { halted: boolean; openOrders: number; limits: { maxOrderQuantity: number; maxOrderNotional: number; maxOpenOrders: number } };
  exposure: { reservedCash: number; reservedCashPercent: number; openOrderUtilizationPercent: number };
};
type AuditEntry = { id: string; action: string; entityId: string | null; payload: unknown; entryHash: string; createdAt: string };
type AuditIntegrity = { ok: boolean; checked: number; head?: string; failedAt?: string };
type VenueControlView = { venue: "NEXTRADE"; phase: MarketPhase; haltMode: "OPEN" | "CANCEL_ONLY" | "FULL_STOP"; reason: string | null; version: number; updatedAt: string };
type SessionView = {
  authenticated: boolean;
  user: { displayName: string; email: string; participantId: string; role: string };
  account: { participantId: string; cashBalance: number; availableCash: number; positions: Array<{ symbol: string; quantity: number; availableQuantity: number; averagePrice: number }> };
  signOutPath: string;
};

export default function Home() {
  const [selectedSymbol, setSelectedSymbol] = useState(DEFAULT_SYMBOL);
  const [engine] = useState(() => new MatchingEngine("CANCEL_TAKER", INSTRUMENTS));
  const [book, setBook] = useState(() => engine.snapshot(DEFAULT_SYMBOL));
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [trades, setTrades] = useState<Execution[]>([]);
  const [marketPhase, setMarketPhase] = useState<MarketPhase>("CONTINUOUS");
  const [side, setSide] = useState<Side>("BUY");
  const [orderType, setOrderType] = useState<OrderType>("LIMIT");
  const [timeInForce, setTimeInForce] = useState<TimeInForce>("GTC");
  const [price, setPrice] = useState(String(INSTRUMENTS[0].basePrice));
  const [stopPrice, setStopPrice] = useState(String(INSTRUMENTS[0].basePrice));
  const [quantity, setQuantity] = useState("1");
  const [participantId, setParticipantId] = useState("로그인 필요");
  const [message, setMessage] = useState("주문 입력을 기다리는 중");
  const [activeTab, setActiveTab] = useState<"orders" | "trades">("orders");
  const [readiness, setReadiness] = useState<ReadinessView | null>(null);
  const [riskView, setRiskView] = useState<RiskView | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditIntegrity, setAuditIntegrity] = useState<AuditIntegrity | null>(null);
  const [venueControl, setVenueControl] = useState<VenueControlView | null>(null);
  const [streamConnected, setStreamConnected] = useState(false);
  const [streamRevision, setStreamRevision] = useState(0);
  const [session, setSession] = useState<SessionView | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);
  const [signInPath, setSignInPath] = useState("/signin-with-chatgpt?return_to=%2F");
  const authenticated = session !== null;

  useEffect(() => {
    let active = true;
    fetch("/api/readiness", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (active && payload?.service) setReadiness(payload as ReadinessView);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/stream");
    const refresh = () => setStreamRevision((value) => value + 1);
    source.onopen = () => setStreamConnected(true);
    source.onerror = () => setStreamConnected(false);
    source.addEventListener("ready", refresh);
    source.addEventListener("market", refresh);
    source.addEventListener("book", refresh);
    return () => source.close();
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/session", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          const payload = await response.json().catch(() => null);
          if (active) {
            setSignInRequired(true);
            if (payload?.signInPath) setSignInPath(payload.signInPath);
          }
          return null;
        }
        return response.json();
      })
      .then((payload) => {
        if (!active || !payload?.authenticated) return;
        setSession(payload as SessionView);
        setParticipantId(payload.user.participantId);
        setSignInRequired(false);
      })
      .catch(() => { if (active) setSignInRequired(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const requests: Promise<Response>[] = [fetch(`/api/book?symbol=${encodeURIComponent(selectedSymbol)}`, { cache: "no-store" })];
        if (authenticated) {
          requests.push(fetch("/api/orders", { cache: "no-store" }));
          requests.push(fetch("/api/risk", { cache: "no-store" }));
          requests.push(fetch("/api/audit?limit=30", { cache: "no-store" }));
          requests.push(fetch("/api/operations/venue", { cache: "no-store" }));
        }
        const [bookResponse, ordersResponse, riskResponse, auditResponse, venueResponse] = await Promise.all(requests);
        if (!active) return;
        if (bookResponse.ok) {
          const payload = await bookResponse.json();
          setBook(payload.book);
          if (payload.market?.phase) setMarketPhase(payload.market.phase);
          if (payload.venueControl) setVenueControl(payload.venueControl);
        }
        if (ordersResponse?.ok) {
          const payload = await ordersResponse.json();
          setOrders((payload.orders ?? []).map((order: Order) => ({ ...order, filled: order.quantity - order.remaining, submittedAt: new Date(order.acceptedAt).toLocaleTimeString("ko-KR", { hour12: false }) })));
          setTrades((payload.executions ?? []).map((execution: Execution, index: number) => ({ ...execution, makerOrderId: execution.makerOrderId ?? "", takerOrderId: execution.takerOrderId ?? "", sequence: execution.sequence ?? index + 1 })));
          if (payload.account) setSession((current) => current ? { ...current, account: payload.account } : current);
        }
        if (riskResponse?.ok) setRiskView(await riskResponse.json() as RiskView);
        if (auditResponse?.ok) {
          const payload = await auditResponse.json();
          setAuditEntries(payload.entries ?? []);
          setAuditIntegrity(payload.integrity ?? null);
        }
        if (venueResponse?.ok) {
          const payload = await venueResponse.json();
          setVenueControl(payload.control ?? null);
        }
      } catch {
        if (active) setMessage("공유 시장 연결을 다시 확인하는 중");
      }
    };
    void load();
    const timer = window.setInterval(load, 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [selectedSymbol, authenticated, streamRevision]);

  const selectedInstrument = instrumentFor(selectedSymbol);
  const visibleTrades = trades.filter((trade) => trade.symbol === selectedSymbol);

  const bestAsk = book.askLevels[0]?.price ?? null;
  const bestBid = book.bidLevels[0]?.price ?? null;
  const spread = bestAsk != null && bestBid != null ? bestAsk - bestBid : null;
  const lastTrade = visibleTrades[0]?.price ?? null;
  const totalBid = book.bidLevels.reduce((sum, level) => sum + level.quantity, 0);
  const totalAsk = book.askLevels.reduce((sum, level) => sum + level.quantity, 0);
  const maxDepth = Math.max(...[...book.askLevels, ...book.bidLevels].map((level) => level.quantity), 1);
  const sortedAsks = useMemo(() => book.askLevels, [book.askLevels]);
  const sortedBids = useMemo(() => book.bidLevels, [book.bidLevels]);

  function refresh(nextEngine = engine, symbol = selectedSymbol) {
    setBook(nextEngine.snapshot(symbol));
  }

  function selectInstrument(symbol: string) {
    const nextInstrument = instrumentFor(symbol);
    setSelectedSymbol(nextInstrument.symbol);
    setPrice(String(nextInstrument.basePrice ?? ""));
    setStopPrice(String(nextInstrument.basePrice ?? ""));
    setMessage(`${nextInstrument.displayName} · ${nextInstrument.symbol} 원장 선택`);
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) {
      setMessage("주문하려면 먼저 로그인하세요");
      return;
    }
    const parsedPrice = Number(price);
    const parsedQuantity = Number(quantity);
    setMessage("서버 주문 게이트웨이에 전송 중");
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        symbol: selectedSymbol,
        side,
        type: orderType,
        timeInForce: orderType === "MARKET" ? "IOC" : timeInForce,
        price: orderType === "LIMIT" || orderType === "STOP_LIMIT" ? parsedPrice : null,
        stopPrice: orderType === "STOP_LIMIT" ? Number(stopPrice) : null,
        quantity: parsedQuantity,
      }),
    });
    const result = await response.json();
    if (!result.accepted || !result.order) {
      setMessage(`주문 거부 · ${result.error ?? result.reason ?? "validation error"}`);
      return;
    }
    const order = result.order as Order;
    const row: OrderRow = { ...order, filled: order.quantity - order.remaining, submittedAt: nowStamp() };
    setOrders((current) => [row, ...current.filter((item) => item.id !== row.id)].slice(0, 100));
    setMessage(result.executions.length ? `${formatNumber(result.executions.reduce((sum: number, fill: Execution) => sum + fill.quantity, 0))}주 체결 · seq ${result.executions.at(-1)?.sequence}` : order.status === "OPEN" ? "공유 호가에 접수됨" : `${order.timeInForce} 잔량 없음 · 취소`);
  }

  async function cancelOrder(orderId: string) {
    const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, { method: "DELETE" });
    const result = await response.json();
    if (!result.cancelled) {
      setMessage(`취소 거부 · ${result.reason ?? "cancel failed"}`);
      return;
    }
    setOrders((current) => current.map((order) => order.id === orderId && result.order ? { ...order, ...result.order, filled: result.order.quantity - result.order.remaining } : order));
    setMessage(`${orderId} 취소 완료`);
  }

  async function cancelAllOrders() {
    const openOrders = orders.filter((order) => order.status === "OPEN" || order.status === "PARTIAL");
    if (!openOrders.length) {
      setMessage("취소할 미체결 주문이 없습니다");
      return;
    }
    if (!window.confirm(`${openOrders.length}건의 미체결 주문을 모두 취소할까요?`)) return;
    const response = await fetch("/api/orders", { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) {
      setMessage(`일괄취소 거부 · ${result.error ?? "cancel failed"}`);
      return;
    }
    const cancelled = new Map<string, Order>((result.orders ?? []).map((order: Order) => [order.id, order]));
    setOrders((current) => current.map((order) => {
      const updated = cancelled.get(order.id);
      return updated ? { ...order, ...updated, filled: updated.quantity - updated.remaining } : order;
    }));
    setMessage(`${cancelled.size}건 일괄취소 완료`);
  }

  function changeMarketPhase(nextPhase: MarketPhase) {
    engine.setMarketPhase(nextPhase);
    setMarketPhase(nextPhase);
    refresh();
    setMessage(`${phaseLabel(nextPhase)} phase selected · local venue control`);
  }

  function runAuctionCycle() {
    const result = engine.runAuction(selectedSymbol);
    if (result.executions.length) setTrades((current) => [...result.executions, ...current].slice(0, 50));
    refresh();
    setMessage(result.price == null ? "동시호가에서 체결 가능한 수량이 없습니다" : `단일가 ${formatNumber(result.price)}원 · ${formatNumber(result.quantity)}주 체결`);
  }

  function resetEngine() {
    setMessage("공유 시장 상태를 새로 불러오는 중");
    window.location.reload();
  }

  function jumpTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function changeVenueControl(phase: MarketPhase, haltMode: VenueControlView["haltMode"]) {
    if (!venueControl || session?.user.role !== "operator") return;
    if (haltMode === "FULL_STOP" && !window.confirm("전면정지 중에는 신규·정정·취소 주문이 모두 차단됩니다. 실행할까요?")) return;
    const response = await fetch("/api/operations/venue", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phase, haltMode, expectedVersion: venueControl.version, reason: haltMode === "OPEN" ? null : haltMode === "CANCEL_ONLY" ? "운영자 취소전용 전환" : "운영자 전면정지" }),
    });
    const payload = await response.json();
    if (!response.ok) {
      if (payload.control) setVenueControl(payload.control);
      setMessage(`시장통제 실패 · ${payload.error ?? "control rejected"}`);
      return;
    }
    setVenueControl(payload.control);
    setMarketPhase(payload.control.haltMode === "OPEN" ? payload.control.phase : "CLOSED");
    setMessage(`시장통제 반영 · ${payload.control.phase} / ${payload.control.haltMode}`);
  }

  return (
    <main className="terminal-shell">
      <aside className="side-rail">
        <div className="brand-mark">S<span>TS</span></div>
        <nav className="rail-nav" aria-label="주요 메뉴">
          <button className="rail-item active" aria-label="Live Trading" onClick={() => jumpTo("live-trading")}><span className="rail-icon">↗</span><span>Live</span></button>
          <button className="rail-item" aria-label="Matching Lab" onClick={() => jumpTo("matching-console")}><span className="rail-icon">⌁</span><span>Lab</span></button>
          <button className="rail-item" aria-label="Orders" onClick={() => jumpTo("order-journal")}><span className="rail-icon">◫</span><span>Orders</span></button>
          <button className="rail-item" aria-label="Risk" onClick={() => jumpTo("risk-controls")}><span className="rail-icon">⌁</span><span>Risk</span></button>
          <button className="rail-item" aria-label="Monitor" onClick={() => jumpTo("system-monitor")}><span className="rail-icon">◌</span><span>Monitor</span></button>
          <button className="rail-item" aria-label="Gateway" onClick={() => jumpTo("institutional-hub")}><span className="rail-icon">↯</span><span>Gateway</span></button>
        </nav>
        <div className="rail-bottom"><button className="rail-item" aria-label="설정"><span className="rail-icon">⚙</span><span>설정</span></button><div className="user-avatar">{session ? session.user.participantId.slice(-2) : "--"}</div></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="crumb"><span className="eyebrow">TRADINGSTOCKSYSYEM / LIVE ROUTING</span><span className="crumb-divider">/</span><strong>TradingStockSysyem</strong></div>
          <div className="top-actions"><div className="market-state"><span className="tiny-dot green" /> 실계좌 라우팅 · KRX / NXT / SOR</div><div className="header-chip"><span className="tiny-dot green" /> {session ? session.user.displayName : "사용자 로그인 필요"}</div></div>
        </header>

        <div className="content" id="matching-console">
          {signInRequired ? <section className="auth-banner"><div><strong>실계좌 주문은 로그인한 사용자만 사용할 수 있습니다</strong><span>사용자별 증권사 키와 계좌는 암호화·분리 저장되며 다른 사용자에게 공개되지 않습니다.</span></div><a href={signInPath}>사용자 로그인</a></section> : session ? <section className="account-strip"><div><span>사용자</span><strong>{session.user.participantId}</strong></div><div><span>권한</span><strong>{session.user.role.toUpperCase()}</strong></div><div><span>Live Broker</span><strong>USER VAULT</strong></div><div><span>Engine Lab</span><strong>seq {formatNumber(book.sequence)}</strong></div><a href={session.signOutPath}>로그아웃</a></section> : null}

          <LiveTradingPanel authenticated={authenticated} />

          <div className="instrument-bar">
            <div className="instrument-title"><div className="ticker-icon">{selectedInstrument.mark}</div><div><div className="instrument-name">{selectedInstrument.displayName} <span className="ticker">{selectedSymbol} · {selectedInstrument.venue}</span></div><div className="instrument-sub">중앙 호가장 · 시장 시퀀스 · 체결 보고</div></div></div>
            <div className="instrument-selector"><label htmlFor="instrument-select">엔진 랩 종목</label><select id="instrument-select" value={selectedSymbol} onChange={(event) => selectInstrument(event.target.value)}>{INSTRUMENTS.map((instrument) => <option key={instrument.symbol} value={instrument.symbol}>{instrument.displayName} · {instrument.symbol}</option>)}</select><span>내부 매칭 검증용 · {INSTRUMENTS.length}종목</span></div>
            <div className="quote-block"><span className="quote-label">최근 체결</span><strong>{formatPrice(lastTrade)}</strong><span className="muted">MD-A seq {formatNumber(book.sequence)}</span></div>
            <div className="instrument-actions"><span className="api-status"><span className="tiny-dot green" /> 회원사 시험망 · 인증 적용</span><button className="ghost-button" onClick={resetEngine}>새로고침</button></div>
          </div>

          <section className="feed-warning"><span className="warning-icon">L</span><div><strong>아래 영역은 ATS 매칭엔진 검증 랩입니다.</strong><span>실제 현금 주문은 위 ‘실거래 주문·체결 콘솔’에서만 증권사로 전송됩니다. 랩 주문은 실제 계좌에 영향을 주지 않습니다.</span></div></section>

          <section className="engine-profile" aria-label="엔진 프로파일"><div><span>MATCHING POLICY</span><strong>DETERMINISTIC PRICE / TIME</strong></div><div><span>ORDER GATEWAY</span><strong>MEMBER SESSION · HMAC · SEQUENCE</strong></div><div><span>RECOVERY</span><strong>WAL · SNAPSHOT · DISTRIBUTED LEADER LOCK</strong></div><div className="profile-lock"><span className={`tiny-dot ${venueControl?.haltMode === "OPEN" ? "green" : "amber"}`} /> {venueControl?.haltMode === "FULL_STOP" ? "VENUE FULL STOP" : venueControl?.haltMode === "CANCEL_ONLY" ? "CANCEL ONLY" : "ORDER GATE OPEN"}</div></section>

          <section className="operations-strip" id="system-monitor" aria-label="운영 상태">
            <div><span>서비스 상태</span><strong className={readiness?.ok ? "positive" : "sell-color"}>{readiness?.ok ? "정상" : "확인 중"}</strong><small>readiness gate</small></div>
            <div><span>주문 저널</span><strong>{readiness?.persistence.ok ? readiness.persistence.provider.toUpperCase() : "—"}</strong><small>{readiness?.persistence.ok ? `${readiness.persistence.latencyMs}ms 응답` : "영속 저장소 확인"}</small></div>
            <div><span>복구 미체결</span><strong>{formatNumber(readiness?.engine.recoveredOrders ?? 0)}건</strong><small>원본 우선순위 유지</small></div>
            <div><span>매칭 리더</span><strong>{readiness?.safeguards.distributedLeaderLock ? "분산 직렬화" : readiness?.safeguards.mutationSerialization ? "단일 직렬화" : "—"}</strong><small>결정론적 처리 경계</small></div>
            <div><span>실시간 이벤트</span><strong className={streamConnected ? "positive" : "muted"}>{streamConnected ? "연결됨" : "재연결 중"}</strong><small>SSE · 자동 복구</small></div>
          </section>

          {session?.user.role === "operator" && venueControl ? <section className="operator-control" aria-label="운영자 시장 통제"><div><span className="section-kicker">OPERATOR CONTROL</span><strong>{venueControl.phase} · {venueControl.haltMode}</strong><small>version {venueControl.version} · 모든 변경은 해시 감사기록에 남습니다.</small></div><div className="operator-actions"><button type="button" className={venueControl.haltMode === "OPEN" && venueControl.phase === "PRE_MARKET" ? "active" : ""} onClick={() => changeVenueControl("PRE_MARKET", "OPEN")}>PRE</button><button type="button" className={venueControl.haltMode === "OPEN" && venueControl.phase === "CONTINUOUS" ? "active" : ""} onClick={() => changeVenueControl("CONTINUOUS", "OPEN")}>정상 거래</button><button type="button" className={venueControl.haltMode === "OPEN" && venueControl.phase === "AFTER_MARKET" ? "active" : ""} onClick={() => changeVenueControl("AFTER_MARKET", "OPEN")}>AFTER</button><button type="button" className={venueControl.haltMode === "CANCEL_ONLY" ? "cancel-only active" : "cancel-only"} onClick={() => changeVenueControl("CLOSED", "CANCEL_ONLY")}>취소전용</button><button type="button" className={venueControl.haltMode === "FULL_STOP" ? "full-stop active" : "full-stop"} onClick={() => changeVenueControl("CLOSED", "FULL_STOP")}>전면정지</button></div></section> : null}

          <section className="phase-control" aria-label="시장 세션 상태"><div><span className="section-kicker">VENUE SESSION</span><strong>{phaseLabel(marketPhase)}</strong><small>NEXTRADE · local control plane</small></div><div className="phase-buttons"><button type="button" className={marketPhase === "PRE_MARKET" ? "active" : ""} onClick={() => changeMarketPhase("PRE_MARKET")}>PRE</button><button type="button" className={marketPhase === "OPENING_AUCTION" ? "active" : ""} onClick={() => changeMarketPhase("OPENING_AUCTION")}>OPEN AUCTION</button><button type="button" className={marketPhase === "CONTINUOUS" ? "active" : ""} onClick={() => changeMarketPhase("CONTINUOUS")}>CONTINUOUS</button><button type="button" className={marketPhase === "CLOSING_AUCTION" ? "active" : ""} onClick={() => changeMarketPhase("CLOSING_AUCTION")}>CLOSE AUCTION</button><button type="button" className={marketPhase === "AFTER_MARKET" ? "active" : ""} onClick={() => changeMarketPhase("AFTER_MARKET")}>AFTER</button><button type="button" className="auction-run" onClick={runAuctionCycle} disabled={marketPhase !== "OPENING_AUCTION" && marketPhase !== "CLOSING_AUCTION"}>RUN AUCTION</button><button type="button" className={marketPhase === "CLOSED" ? "active closed" : "closed"} onClick={() => changeMarketPhase("CLOSED")}>CLOSED</button></div></section>

          <section className="kpi-row" aria-label="엔진 상태">
            <div className="kpi-card"><span className="kpi-label">엔진 상태</span><strong className={venueControl?.haltMode === "OPEN" ? "status-text" : "sell-color"}>{venueControl?.haltMode === "OPEN" ? "READY" : venueControl?.haltMode ?? "READY"}</strong><span className="kpi-trend">seq {formatNumber(book.sequence)}</span></div>
            <div className="kpi-card"><span className="kpi-label">활성 매수 잔량</span><strong>{formatNumber(totalBid)}<span className="unit">주</span></strong><span className="kpi-trend">{book.bids.length}개 주문</span></div>
            <div className="kpi-card"><span className="kpi-label">활성 매도 잔량</span><strong>{formatNumber(totalAsk)}<span className="unit">주</span></strong><span className="kpi-trend">{book.asks.length}개 주문</span></div>
            <div className="kpi-card"><span className="kpi-label">누적 체결 이벤트</span><strong>{formatNumber(visibleTrades.length)}<span className="unit">건</span></strong><span className="kpi-trend">{selectedInstrument.displayName}</span></div>
          </section>

          <div className="dashboard-grid">
            <section className="panel order-panel">
              <div className="panel-heading"><div><span className="section-kicker">ATS ENGINE LAB</span><h2>매칭엔진 검증 주문</h2></div><span className="latency-badge">LAB</span></div>
              <div className="segmented"><button className={side === "BUY" ? "selected-buy" : ""} onClick={() => setSide("BUY")}>매수</button><button className={side === "SELL" ? "selected-sell" : ""} onClick={() => setSide("SELL")}>매도</button></div>
              <div className="order-tabs"><button type="button" className={orderType === "LIMIT" ? "active" : ""} onClick={() => setOrderType("LIMIT")}>지정가</button><button type="button" className={orderType === "MARKET" ? "active" : ""} onClick={() => { setOrderType("MARKET"); setTimeInForce("IOC"); }}>시장가</button><button type="button" className={orderType === "MIDPOINT" ? "active" : ""} onClick={() => { setOrderType("MIDPOINT"); setTimeInForce("GTC"); }}>중간가</button><button type="button" className={orderType === "STOP_LIMIT" ? "active" : ""} onClick={() => { setOrderType("STOP_LIMIT"); setTimeInForce("GTC"); }}>스톱지정가</button></div>
              <div className="tif-row" aria-label="주문 유효조건"><span>유효조건</span><button type="button" className={orderType === "MARKET" || timeInForce === "GTC" ? "active" : ""} onClick={() => setTimeInForce("GTC")} disabled={orderType === "MARKET"}>GTC · 잔량유지</button><button type="button" className={orderType !== "MARKET" && timeInForce === "IOC" ? "active" : ""} onClick={() => setTimeInForce("IOC")}>IOC · 즉시취소</button><button type="button" className={orderType !== "MARKET" && timeInForce === "FOK" ? "active" : ""} onClick={() => setTimeInForce("FOK")}>FOK · 전량체결</button></div>
              <form onSubmit={submitOrder}>
                <label className="field-label">회원사 ID <span>인증 세션에서 자동 지정</span></label>
                <div className="number-input disabled"><input aria-label="참가자 ID" type="text" value={participantId} readOnly /></div>
                <label className="field-label">가격 <span>KRW · 호가단위 {formatNumber(selectedInstrument.tickSize)}원</span></label>
                <div className={`number-input ${orderType === "MARKET" || orderType === "MIDPOINT" ? "disabled" : ""}`}><input aria-label="주문 가격" type="number" step={selectedInstrument.tickSize} min={selectedInstrument.minPrice} value={price} disabled={orderType === "MARKET" || orderType === "MIDPOINT"} onChange={(event) => setPrice(event.target.value)} /><span>원</span></div>
                <div className="quick-prices"><button type="button" onClick={() => setPrice(String(bestAsk ?? 0))}>최우선 매도</button><button type="button" onClick={() => setPrice(String(bestBid ?? 0))}>최우선 매수</button></div>
                {orderType === "STOP_LIMIT" ? <><label className="field-label">발동가격 <span>체결가 도달 시 지정가 전환</span></label><div className="number-input"><input aria-label="스톱 발동 가격" type="number" step={selectedInstrument.tickSize} min={selectedInstrument.minPrice} value={stopPrice} onChange={(event) => setStopPrice(event.target.value)} /><span>원</span></div></> : null}
                <label className="field-label">수량 <span>주</span></label>
                <div className="number-input"><input aria-label="주문 수량" type="number" step="1" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /><span>주</span></div>
                <div className="quantity-presets"><button type="button" onClick={() => setQuantity("1")}>1</button><button type="button" onClick={() => setQuantity("10")}>10</button><button type="button" onClick={() => setQuantity("100")}>100</button><button type="button" onClick={() => setQuantity("1000")}>1,000</button></div>
                <div className="estimate"><span>주문금액</span><strong>{orderType === "MARKET" ? "시장가" : orderType === "MIDPOINT" ? "NBBO 중간가" : formatPrice((Number(price) || 0) * (Number(quantity) || 0))}</strong></div>
                <button className={`submit-order ${side === "BUY" ? "buy" : "sell"}`} type="submit" disabled={!session}>{session ? (side === "BUY" ? "LAB 매수 주문" : "LAB 매도 주문") : "로그인 후 LAB 주문"}<span>실계좌 영향 없음</span></button>
              </form>
              <div className="engine-message" aria-live="polite"><span className="tiny-dot green" />{message}</div>
              <div className="risk-check" id="risk-controls"><div className="risk-title"><span>사전 리스크 체크</span><span className={riskView?.risk.halted ? "sell-color" : "positive"}>{riskView?.risk.halted ? "HALTED" : "ACTIVE"}</span></div><div className="risk-row"><span>미체결 주문</span><span>{formatNumber(riskView?.risk.openOrders ?? 0)} / {formatNumber(riskView?.risk.limits.maxOpenOrders ?? 1000)}건</span></div><div className="risk-meter"><span style={{ width: `${Math.min(100, riskView?.exposure.openOrderUtilizationPercent ?? 0)}%` }} /></div><div className="risk-row"><span>예약 주문금액</span><span>{formatNumber(riskView?.exposure.reservedCash ?? 0)}원 · {riskView?.exposure.reservedCashPercent ?? 0}%</span></div><div className="risk-row"><span>주문당 최대수량</span><span>{formatNumber(riskView?.risk.limits.maxOrderQuantity ?? 100000)}주</span></div><div className="risk-row"><span>주문당 최대금액</span><span>{formatNumber(riskView?.risk.limits.maxOrderNotional ?? 1000000000)}원</span></div><div className="risk-row"><span>감사 무결성</span><span className={auditIntegrity?.ok ? "positive" : "sell-color"}>{auditIntegrity?.ok ? `${auditIntegrity.checked}건 검증` : "확인 중"}</span></div><div className="risk-row"><span>자기체결 방지</span><span>CANCEL_TAKER</span></div></div>
            </section>

            <section className="panel book-panel">
              <div className="panel-heading"><div><span className="section-kicker">CENTRAL LIMIT ORDER BOOK</span><h2>중앙 호가장 <span className="live-label"><span className="tiny-dot green" /> MD-A LIVE</span></h2></div><div className="book-meta"><span>단위: 주</span></div></div>
              <div className="book-summary"><div><span>매도 잔량</span><strong className="sell-color">{formatNumber(totalAsk)}</strong></div><div className="spread"><span>스프레드</span><strong>{spread == null ? "—" : `${formatNumber(spread)}원`}</strong></div><div><span>매수 잔량</span><strong className="buy-color">{formatNumber(totalBid)}</strong></div></div>
              <div className="book-head"><span>가격</span><span>잔량</span><span>누적</span></div>
              <div className="book-rows asks">{sortedAsks.length ? sortedAsks.slice(0, 8).map((level) => <div className="book-row" key={`ask-${level.price}`}><span className="depth-bar ask-bar" style={{ width: `${Math.min(100, (level.quantity / maxDepth) * 100)}%` }} /><span className="price-cell sell-color">{formatNumber(level.price)}</span><span>{formatNumber(level.quantity)}</span><span className="muted">{level.orderCount}건</span></div>) : <div className="empty-book">매도 호가 없음</div>}</div>
              <div className="mid-price"><span className="mid-line" /><strong>{formatPrice(lastTrade)}</strong><span className="muted">최근 체결</span><span className="mid-line" /></div>
              <div className="book-head"><span>가격</span><span>잔량</span><span>누적</span></div>
              <div className="book-rows bids">{sortedBids.length ? sortedBids.slice(0, 8).map((level) => <div className="book-row" key={`bid-${level.price}`}><span className="depth-bar bid-bar" style={{ width: `${Math.min(100, (level.quantity / maxDepth) * 100)}%` }} /><span className="price-cell buy-color">{formatNumber(level.price)}</span><span>{formatNumber(level.quantity)}</span><span className="muted">{level.orderCount}건</span></div>) : <div className="empty-book">매수 호가 없음</div>}</div>
              <div className="book-footer"><span><span className="tiny-dot amber" /> 주문 입력 스트림 대기</span><span>seq {formatNumber(book.sequence)}</span></div>
            </section>

            <section className="panel activity-panel">
              <div className="panel-heading"><div><span className="section-kicker">EXECUTION LOG</span><h2>체결 이벤트</h2></div><span className="time-badge">LOCAL</span></div>
              <div className="feed-state-card"><span className="feed-state-icon">↯</span><div><strong>Execution Report · Drop Copy</strong><span>시험 회원사에 전달된 주문확인·거부·체결 이벤트입니다.</span></div></div>
              <div className="activity-tabs"><button className={activeTab === "orders" ? "active" : ""} onClick={() => setActiveTab("orders")}>주문 이벤트</button><button className={activeTab === "trades" ? "active" : ""} onClick={() => setActiveTab("trades")}>최근 체결</button></div>
              {activeTab === "trades" ? <div className="trade-list">{visibleTrades.length ? visibleTrades.slice(0, 10).map((trade) => <div className="trade-row" key={trade.id}><span className="buy-color">체결</span><strong>{formatNumber(trade.price)}</strong><span>{formatNumber(trade.quantity)}주</span><time>seq {trade.sequence}</time></div>) : <div className="empty-activity">체결 이벤트가 없습니다.</div>}</div> : <div className="event-list">{auditEntries.length ? auditEntries.slice(0, 8).map((entry) => <div className="event-row" key={entry.id}><span className={`event-icon ${entry.action.includes("REJECT") ? "amber" : entry.action.includes("CANCEL") ? "violet" : "green"}`}>{entry.action.includes("REJECT") ? "!" : entry.action.includes("CANCEL") ? "×" : "✓"}</span><div><strong>{entry.action.replaceAll("_", " ")}</strong><span>{entry.entityId ?? "사용자 주문 일괄 작업"}</span></div><time>{new Date(entry.createdAt).toLocaleTimeString("ko-KR", { hour12: false })}</time></div>) : <div className="empty-activity">개인 감사기록이 없습니다.</div>}</div>}
              <div className="activity-footer"><span>세션 체결수량</span><strong>{formatNumber(visibleTrades.reduce((sum, trade) => sum + trade.quantity, 0))}주</strong></div>
            </section>
          </div>

          <div id="order-journal" className="scroll-anchor" aria-hidden="true" />

          <section className="panel orders-panel"><div className="panel-heading"><div><span className="section-kicker">ORDER JOURNAL</span><h2>주문 원장</h2></div><div className="table-actions"><span className="filter-chip active">현재 세션 · {orders.length}건</span><button className="danger-button" onClick={cancelAllOrders}>미체결 전체취소</button><button className="ghost-button" onClick={resetEngine}>초기화</button></div></div><div className="table-wrap"><table><thead><tr><th>주문 ID</th><th>종목</th><th>참가자</th><th>구분</th><th>유형</th><th>유효조건</th><th>가격</th><th>발동가격</th><th>주문수량</th><th>체결수량</th><th>잔량</th><th>상태</th><th>접수시각</th><th /></tr></thead><tbody>{orders.length ? orders.map((order) => <tr key={order.id}><td className="mono">{order.id}</td><td><strong>{instrumentFor(order.symbol).displayName}</strong><span className="muted mono">{order.symbol}</span></td><td className="mono">{order.participantId}</td><td><span className={`side-pill ${order.side === "BUY" ? "buy" : "sell"}`}>{order.side === "BUY" ? "매수" : "매도"}</span></td><td>{order.type === "LIMIT" ? "지정가" : order.type === "MARKET" ? "시장가" : order.type === "MIDPOINT" ? "중간가" : "스톱지정가"}</td><td><span className="tif-pill">{order.timeInForce}</span></td><td>{formatPrice(order.price)}</td><td>{formatPrice(order.stopPrice ?? null)}</td><td>{formatNumber(order.quantity)}</td><td className="strong-cell">{formatNumber(order.filled)}</td><td>{formatNumber(order.remaining)}</td><td><span className={`status-pill ${order.status.toLowerCase()}`}>{order.status === "OPEN" ? "대기" : order.status === "PARTIAL" ? "부분체결" : order.status === "PENDING_TRIGGER" ? "발동대기" : order.status === "FILLED" ? "체결" : order.status === "REJECTED" ? "거부" : "취소"}</span></td><td className="muted mono">{order.submittedAt}</td><td>{order.status === "OPEN" || order.status === "PARTIAL" || order.status === "PENDING_TRIGGER" ? <button className="row-action" onClick={() => cancelOrder(order.id)}>취소</button> : null}</td></tr>) : <tr><td colSpan={14} className="table-empty">주문 원장이 비어 있습니다. 외부 주문은 수신하지 않습니다.</td></tr>}</tbody></table></div></section>
          {session ? <InstitutionalArchitecturePanel /> : null}
          <footer className="page-footer"><span>TradingStockSysyem · multi-user live broker routing &amp; ATS engine lab</span><span><span className="tiny-dot green" /> ENCRYPTED VAULT · PRE-TRADE RISK · KIS · KRX / NXT / SOR</span></footer>
        </div>
      </section>
    </main>
  );
}
