"use client";

import { FormEvent, useMemo, useState } from "react";

type Side = "BUY" | "SELL";
type OrderType = "LIMIT" | "MARKET";
type OrderStatus = "OPEN" | "PARTIAL" | "FILLED" | "CANCELLED";

type BookOrder = {
  id: string;
  side: Side;
  price: number;
  remaining: number;
  originalQty: number;
  time: number;
  owner: string;
};

type OrderLog = {
  id: string;
  side: Side;
  type: OrderType;
  price: number | null;
  qty: number;
  filled: number;
  status: OrderStatus;
  submittedAt: string;
};

type Trade = {
  id: string;
  price: number;
  qty: number;
  side: Side;
  time: string;
};

const initialAsks: BookOrder[] = [
  { id: "S-1084", side: "SELL", price: 87000, remaining: 420, originalQty: 420, time: 8, owner: "MM-01" },
  { id: "S-1082", side: "SELL", price: 86900, remaining: 180, originalQty: 180, time: 7, owner: "ALPHA" },
  { id: "S-1079", side: "SELL", price: 86800, remaining: 760, originalQty: 760, time: 6, owner: "MM-02" },
  { id: "S-1075", side: "SELL", price: 86700, remaining: 260, originalQty: 260, time: 5, owner: "NXT-07" },
  { id: "S-1072", side: "SELL", price: 86600, remaining: 540, originalQty: 540, time: 4, owner: "MM-01" },
];

const initialBids: BookOrder[] = [
  { id: "B-2045", side: "BUY", price: 86500, remaining: 620, originalQty: 620, time: 8, owner: "MM-03" },
  { id: "B-2041", side: "BUY", price: 86400, remaining: 300, originalQty: 300, time: 7, owner: "ALPHA" },
  { id: "B-2039", side: "BUY", price: 86300, remaining: 920, originalQty: 920, time: 6, owner: "NXT-12" },
  { id: "B-2034", side: "BUY", price: 86200, remaining: 470, originalQty: 470, time: 5, owner: "MM-02" },
  { id: "B-2028", side: "BUY", price: 86100, remaining: 780, originalQty: 780, time: 4, owner: "MM-01" },
];

const seededOrders: OrderLog[] = [
  { id: "B-2045", side: "BUY", type: "LIMIT", price: 86500, qty: 620, filled: 0, status: "OPEN", submittedAt: "09:41:32.184" },
  { id: "S-1084", side: "SELL", type: "LIMIT", price: 87000, qty: 420, filled: 0, status: "OPEN", submittedAt: "09:41:31.992" },
  { id: "B-2041", side: "BUY", type: "LIMIT", price: 86400, qty: 300, filled: 0, status: "OPEN", submittedAt: "09:41:29.447" },
  { id: "S-1079", side: "SELL", type: "LIMIT", price: 86800, qty: 760, filled: 0, status: "OPEN", submittedAt: "09:41:26.821" },
];

const seededTrades: Trade[] = [
  { id: "T-89211", price: 86500, qty: 80, side: "BUY", time: "09:41:33.002" },
  { id: "T-89210", price: 86500, qty: 120, side: "SELL", time: "09:41:32.841" },
  { id: "T-89209", price: 86400, qty: 60, side: "BUY", time: "09:41:32.410" },
  { id: "T-89208", price: 86400, qty: 210, side: "SELL", time: "09:41:31.907" },
  { id: "T-89207", price: 86300, qty: 95, side: "BUY", time: "09:41:31.442" },
];

const formatNumber = (value: number) => new Intl.NumberFormat("ko-KR").format(value);
const formatPrice = (value: number) => `${formatNumber(value)}원`;

function nowStamp() {
  return new Date().toLocaleTimeString("ko-KR", { hour12: false }) + "." + String(Date.now() % 1000).padStart(3, "0");
}

export default function Home() {
  const [asks, setAsks] = useState(initialAsks);
  const [bids, setBids] = useState(initialBids);
  const [orders, setOrders] = useState(seededOrders);
  const [trades, setTrades] = useState(seededTrades);
  const [side, setSide] = useState<Side>("BUY");
  const [orderType, setOrderType] = useState<OrderType>("LIMIT");
  const [price, setPrice] = useState("86500");
  const [quantity, setQuantity] = useState("100");
  const [message, setMessage] = useState("엔진 대기 중");
  const [activeTab, setActiveTab] = useState<"book" | "trades">("book");

  const bestAsk = asks.length ? Math.min(...asks.map((order) => order.price)) : 0;
  const bestBid = bids.length ? Math.max(...bids.map((order) => order.price)) : 0;
  const spread = bestAsk && bestBid ? bestAsk - bestBid : 0;
  const totalBid = bids.reduce((sum, order) => sum + order.remaining, 0);
  const totalAsk = asks.reduce((sum, order) => sum + order.remaining, 0);
  const lastTrade = trades[0]?.price ?? 86500;
  const maxDepth = Math.max(...[...asks, ...bids].map((order) => order.remaining), 1);

  const sortedAsks = useMemo(() => [...asks].sort((a, b) => a.price - b.price || a.time - b.time), [asks]);
  const sortedBids = useMemo(() => [...bids].sort((a, b) => b.price - a.price || a.time - b.time), [bids]);

  function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const qty = Number(quantity);
    const limitPrice = Number(price);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) {
      setMessage("수량은 1주 이상의 정수로 입력하세요");
      return;
    }
    if (orderType === "LIMIT" && (!Number.isFinite(limitPrice) || limitPrice <= 0)) {
      setMessage("지정가 주문에는 유효한 가격이 필요합니다");
      return;
    }

    const orderId = `${side === "BUY" ? "B" : "S"}-${Math.floor(10000 + Math.random() * 89999)}`;
    let remaining = qty;
    const newTrades: Trade[] = [];
    const opposite = side === "BUY" ? [...asks].sort((a, b) => a.price - b.price || a.time - b.time) : [...bids].sort((a, b) => b.price - a.price || a.time - b.time);
    const updatedOpposite = opposite.map((order) => ({ ...order }));

    for (const resting of updatedOpposite) {
      const crosses = orderType === "MARKET" || (side === "BUY" ? resting.price <= limitPrice : resting.price >= limitPrice);
      if (!crosses || remaining <= 0) continue;
      const fillQty = Math.min(remaining, resting.remaining);
      resting.remaining -= fillQty;
      remaining -= fillQty;
      newTrades.push({ id: `T-${Math.floor(89000 + Math.random() * 999)}`, price: resting.price, qty: fillQty, side, time: nowStamp() });
    }

    const updatedOppositeFiltered = updatedOpposite.filter((order) => order.remaining > 0);
    if (side === "BUY") setAsks(updatedOppositeFiltered);
    else setBids(updatedOppositeFiltered);

    if (remaining > 0 && orderType === "LIMIT") {
      const bookOrder: BookOrder = { id: orderId, side, price: limitPrice, remaining, originalQty: qty, time: Date.now(), owner: "DEMO" };
      if (side === "BUY") setBids((current) => [...current, bookOrder]);
      else setAsks((current) => [...current, bookOrder]);
    }

    const filled = qty - remaining;
    const status: OrderStatus = remaining === 0 ? "FILLED" : filled > 0 ? "PARTIAL" : orderType === "MARKET" ? "CANCELLED" : "OPEN";
    const newOrder: OrderLog = { id: orderId, side, type: orderType, price: orderType === "LIMIT" ? limitPrice : null, qty, filled, status, submittedAt: nowStamp() };
    setOrders((current) => [newOrder, ...current].slice(0, 12));
    if (newTrades.length) setTrades((current) => [...newTrades.reverse(), ...current].slice(0, 12));
    setMessage(filled ? `${formatNumber(filled)}주 체결 · ${remaining ? `${formatNumber(remaining)}주 잔량` : "전량 체결"}` : status === "CANCELLED" ? "시장가 잔량 없음 · 취소" : "호가에 접수됨");
  }

  function resetDemo() {
    setAsks(initialAsks);
    setBids(initialBids);
    setOrders(seededOrders);
    setTrades(seededTrades);
    setMessage("데모 데이터로 초기화됨");
  }

  return (
    <main className="terminal-shell">
      <aside className="side-rail">
        <div className="brand-mark">N<span>+</span></div>
        <nav className="rail-nav" aria-label="주요 메뉴">
          <button className="rail-item active" aria-label="매매체결"><span className="rail-icon">⌁</span><span>체결</span></button>
          <button className="rail-item" aria-label="주문관리"><span className="rail-icon">◫</span><span>주문</span></button>
          <button className="rail-item" aria-label="리스크관리"><span className="rail-icon">⌁</span><span>리스크</span></button>
          <button className="rail-item" aria-label="모니터링"><span className="rail-icon">◌</span><span>관제</span></button>
        </nav>
        <div className="rail-bottom"><button className="rail-item" aria-label="설정"><span className="rail-icon">⚙</span><span>설정</span></button><div className="user-avatar">DE</div></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="crumb"><span className="eyebrow">NXT / MATCHING CORE</span><span className="crumb-divider">/</span><strong>실시간 체결 터미널</strong></div>
          <div className="top-actions"><div className="market-state"><span className="pulse" /> 장중 · 09:00–15:30</div><div className="header-chip"><span className="tiny-dot green" /> FIX Gateway 03</div><button className="icon-button" aria-label="알림">◔<span className="notification-dot" /></button></div>
        </header>

        <div className="content">
          <div className="instrument-bar">
            <div className="instrument-title"><div className="ticker-icon">S</div><div><div className="instrument-name">삼성전자 <span className="ticker">005930 · KRX</span></div><div className="instrument-sub">보통주 · KRW · 호가단위 100원</div></div></div>
            <div className="quote-block"><span className="quote-label">현재가</span><strong>{formatPrice(lastTrade)}</strong><span className="positive">+1,200 <small>(+1.40%)</small></span></div>
            <div className="instrument-actions"><button className="ghost-button" onClick={resetDemo}>↻ 데모 리셋</button><button className="primary-button small">API 연결 안내</button></div>
          </div>

          <section className="kpi-row" aria-label="엔진 상태">
            <div className="kpi-card"><span className="kpi-label">P99 매칭 지연</span><strong>42<span className="unit">µs</span></strong><span className="kpi-trend positive">↓ 8.6% <em>vs. 1h</em></span></div>
            <div className="kpi-card"><span className="kpi-label">초당 처리량</span><strong>18.4<span className="unit">K/s</span></strong><span className="kpi-trend">평균 12.7K/s</span></div>
            <div className="kpi-card"><span className="kpi-label">활성 주문</span><strong>{formatNumber(totalBid + totalAsk)}<span className="unit">주</span></strong><span className="kpi-trend">Bid {formatNumber(totalBid)} · Ask {formatNumber(totalAsk)}</span></div>
            <div className="kpi-card"><span className="kpi-label">매칭 노드</span><strong>3<span className="unit">/ 3</span></strong><span className="kpi-trend positive"><span className="tiny-dot green" /> 모두 정상</span></div>
          </section>

          <div className="dashboard-grid">
            <section className="panel order-panel">
              <div className="panel-heading"><div><span className="section-kicker">ORDER ENTRY</span><h2>주문 입력</h2></div><span className="latency-badge">LOCAL SIM</span></div>
              <div className="segmented"><button className={side === "BUY" ? "selected-buy" : ""} onClick={() => setSide("BUY")}>매수</button><button className={side === "SELL" ? "selected-sell" : ""} onClick={() => setSide("SELL")}>매도</button></div>
              <div className="order-tabs"><button className={orderType === "LIMIT" ? "active" : ""} onClick={() => setOrderType("LIMIT")}>지정가</button><button className={orderType === "MARKET" ? "active" : ""} onClick={() => setOrderType("MARKET")}>시장가</button></div>
              <form onSubmit={submitOrder}>
                <label className="field-label">가격 <span>KRW</span></label>
                <div className={`number-input ${orderType === "MARKET" ? "disabled" : ""}`}><input aria-label="주문 가격" type="number" step="100" value={price} disabled={orderType === "MARKET"} onChange={(event) => setPrice(event.target.value)} /><span>원</span></div>
                <div className="quick-prices"><button type="button" onClick={() => setPrice(String(bestAsk || 86600))}>최우선 매도</button><button type="button" onClick={() => setPrice(String(bestBid || 86500))}>최우선 매수</button></div>
                <label className="field-label">수량 <span>주</span></label>
                <div className="number-input"><input aria-label="주문 수량" type="number" step="1" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /><span>주</span></div>
                <div className="quantity-presets"><button type="button" onClick={() => setQuantity("10")}>10</button><button type="button" onClick={() => setQuantity("100")}>100</button><button type="button" onClick={() => setQuantity("500")}>500</button><button type="button" onClick={() => setQuantity("1000")}>1,000</button></div>
                <div className="estimate"><span>예상 주문금액</span><strong>{orderType === "MARKET" ? "시장가" : formatPrice((Number(price) || 0) * (Number(quantity) || 0))}</strong></div>
                <button className={`submit-order ${side === "BUY" ? "buy" : "sell"}`} type="submit">{side === "BUY" ? "매수 주문" : "매도 주문"}<span>⌘ ↵</span></button>
              </form>
              <div className="engine-message"><span className="tiny-dot green" />{message}</div>
              <div className="risk-check"><div className="risk-title"><span>사전 리스크 체크</span><span className="positive">PASS</span></div><div className="risk-row"><span>가격단위 검증</span><span>100원</span></div><div className="risk-row"><span>호가잔량 검증</span><span>정상</span></div><div className="risk-row"><span>주문 라우팅</span><span>CORE-01</span></div></div>
            </section>

            <section className="panel book-panel">
              <div className="panel-heading"><div><span className="section-kicker">LEVEL 2 MARKET DATA</span><h2>호가창 <span className="live-label"><span className="pulse" /> LIVE</span></h2></div><div className="book-meta"><span>단위: 주</span><button className="more-button" aria-label="더보기">···</button></div></div>
              <div className="book-summary"><div><span>매도 잔량</span><strong className="sell-color">{formatNumber(totalAsk)}</strong></div><div className="spread"><span>스프레드</span><strong>{formatNumber(spread)}원</strong></div><div><span>매수 잔량</span><strong className="buy-color">{formatNumber(totalBid)}</strong></div></div>
              <div className="book-head"><span>가격</span><span>매도 잔량</span><span>누적</span></div>
              <div className="book-rows asks">{sortedAsks.map((order) => <div className="book-row" key={order.id}><span className="depth-bar ask-bar" style={{ width: `${Math.min(100, (order.remaining / maxDepth) * 100)}%` }} /><span className="price-cell sell-color">{formatNumber(order.price)}</span><span>{formatNumber(order.remaining)}</span><span className="muted">{formatNumber(order.remaining)}</span></div>)}</div>
              <div className="mid-price"><span className="mid-line" /><strong>{formatPrice(lastTrade)}</strong><span className="positive">+1.40%</span><span className="mid-line" /></div>
              <div className="book-head"><span>가격</span><span>매수 잔량</span><span>누적</span></div>
              <div className="book-rows bids">{sortedBids.map((order) => <div className="book-row" key={order.id}><span className="depth-bar bid-bar" style={{ width: `${Math.min(100, (order.remaining / maxDepth) * 100)}%` }} /><span className="price-cell buy-color">{formatNumber(order.price)}</span><span>{formatNumber(order.remaining)}</span><span className="muted">{formatNumber(order.remaining)}</span></div>)}</div>
              <div className="book-footer"><span><span className="tiny-dot green" /> WebSocket connected</span><span>seq 4,821,904</span></div>
            </section>

            <section className="panel activity-panel">
              <div className="panel-heading"><div><span className="section-kicker">MARKET ACTIVITY</span><h2>시장 흐름</h2></div><span className="time-badge">09:41:33 KST</span></div>
              <div className="mini-chart"><div className="chart-caption"><span>체결가</span><strong>{formatPrice(lastTrade)}</strong><span className="positive">+1.40%</span></div><div className="chart-area"><div className="chart-gridline g1" /><div className="chart-gridline g2" /><div className="chart-gridline g3" /><div className="chart-line l1" /><div className="chart-line l2" /><div className="chart-line l3" /><div className="chart-dot d1" /><div className="chart-dot d2" /><div className="chart-dot d3" /></div><div className="chart-axis"><span>09:30</span><span>09:35</span><span>09:40</span><span>09:45</span></div></div>
              <div className="activity-tabs"><button className={activeTab === "book" ? "active" : ""} onClick={() => setActiveTab("book")}>주문 이벤트</button><button className={activeTab === "trades" ? "active" : ""} onClick={() => setActiveTab("trades")}>최근 체결</button></div>
              {activeTab === "book" ? <div className="event-list"><div className="event-row"><span className="event-icon blue">↗</span><div><strong>신규 주문 유입</strong><span>BUY · 005930 · 100주</span></div><time>방금</time></div><div className="event-row"><span className="event-icon violet">⇄</span><div><strong>가격·시간 우선 매칭</strong><span>CORE-01 · 42µs</span></div><time>1초 전</time></div><div className="event-row"><span className="event-icon amber">#</span><div><strong>호가 스냅샷 저장</strong><span>seq 4,821,904</span></div><time>2초 전</time></div><div className="event-row"><span className="event-icon green">✓</span><div><strong>리스크 체크 통과</strong><span>LIMIT · PRE-TRADE</span></div><time>3초 전</time></div></div> : <div className="trade-list">{trades.slice(0, 6).map((trade) => <div className="trade-row" key={trade.id}><span className={trade.side === "BUY" ? "buy-color" : "sell-color"}>{trade.side === "BUY" ? "매수" : "매도"}</span><strong>{formatNumber(trade.price)}</strong><span>{formatNumber(trade.qty)}주</span><time>{trade.time}</time></div>)}</div>}
              <div className="activity-footer"><span>오늘 누적 체결</span><strong>2,148,930주</strong><span className="positive">+12.8%</span></div>
            </section>
          </div>

          <section className="panel orders-panel"><div className="panel-heading"><div><span className="section-kicker">ORDER &amp; TRADE LOG</span><h2>주문·체결 로그</h2></div><div className="table-actions"><span className="filter-chip active">전체</span><span className="filter-chip">내 주문</span><span className="filter-chip">체결만</span><button className="ghost-button">CSV 내보내기 ↓</button></div></div><div className="table-wrap"><table><thead><tr><th>주문 ID</th><th>구분</th><th>유형</th><th>가격</th><th>주문수량</th><th>체결수량</th><th>상태</th><th>접수시각</th><th /></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td className="mono">{order.id}</td><td><span className={`side-pill ${order.side === "BUY" ? "buy" : "sell"}`}>{order.side === "BUY" ? "매수" : "매도"}</span></td><td>{order.type === "LIMIT" ? "지정가" : "시장가"}</td><td>{order.price ? formatPrice(order.price) : "시장가"}</td><td>{formatNumber(order.qty)}</td><td className="strong-cell">{formatNumber(order.filled)}</td><td><span className={`status-pill ${order.status.toLowerCase()}`}>{order.status === "OPEN" ? "대기" : order.status === "PARTIAL" ? "부분체결" : order.status === "FILLED" ? "체결" : "취소"}</span></td><td className="muted mono">{order.submittedAt}</td><td><button className="row-more" aria-label={`${order.id} 상세`}>···</button></td></tr>)}</tbody></table></div></section>
          <footer className="page-footer"><span>© 2026 NXT Matching Lab · 교육·검증용 시뮬레이터</span><span><span className="tiny-dot green" /> 엔진 정상 · 모든 데이터는 로컬 데모입니다</span></footer>
        </div>
      </section>
    </main>
  );
}
