"use client";

import { useCallback, useEffect, useState } from "react";
import { NEXTRADE_INSTRUMENTS } from "../engine/instrumentMaster";
import type { SimulationState, SimulationEvent } from "../engine/paperSimulation";

type StrategyOption = { id: string; name: string; symbol: string; triggerPrice: number; triggerOperator: "LTE" | "GTE" };
type Account = { state: SimulationState; version: number; updatedAt: string; summary: { equity: number; availableCash: number }; journal?: Array<{ id: string; createdAt: string; events: SimulationEvent[] }> };
const money = (value: number) => new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(value) + "원";
const orderStatus = { OPEN: "대기", PARTIAL: "부분체결", FILLED: "체결", CANCELLED: "취소", REJECTED: "거부" };

export default function PaperTradingPanel({ authenticated, strategies }: { authenticated: boolean; strategies: StrategyOption[] }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [strategyId, setStrategyId] = useState("");
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("전략을 선택하고 가상 운용을 시작하세요.");
  const [events, setEvents] = useState<SimulationEvent[]>([]);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!authenticated) return;
    try {
      const response = await fetch("/api/paper", { cache: "no-store", signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "가상 원장을 불러오지 못했습니다.");
      if (signal?.aborted) return;
      setAccount(data);
      setEvents((data.journal ?? []).flatMap((entry: { events: SimulationEvent[] }) => entry.events).sort((a: SimulationEvent, b: SimulationEvent) => b.at.localeCompare(a.at)).slice(0, 12));
      setError("");
    } catch (failure) { if (!signal?.aborted) setError(failure instanceof Error ? failure.message : "새로고침해 다시 확인하세요."); }
  }, [authenticated]);
  useEffect(() => { const controller = new AbortController(); void Promise.resolve().then(() => load(controller.signal)); return () => controller.abort(); }, [load]);

  async function act(body: Record<string, unknown>) {
    if (!account || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/paper", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ ...body, expectedVersion: account.version }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "가상 운용 요청을 처리하지 못했습니다.");
      setAccount(data); setEvents(data.events.slice(-12).reverse());
      setNotice(body.action === "start" ? "가상 운용을 시작했습니다. 가격 기록을 넣으면 자동으로 조건과 체결을 처리합니다." : body.action === "stop" ? "운용을 중지하고 미체결을 취소했습니다. 잔고와 이력은 보존됩니다." : body.action === "cancel" ? "가상 미체결을 취소했습니다." : `가격 기록을 처리했습니다. 원장 버전 ${data.version}`);
    } catch (failure) { setError((failure instanceof Error ? failure.message : "응답을 확인하지 못했습니다.") + " 원장을 새로고침해 반영 여부를 확인하세요."); }
    finally { setBusy(false); }
  }

  function replay() {
    try {
      if (csv.length > 20_000) throw new Error("가격 기록은 20KB 이하로 입력하세요.");
      const lines = csv.trim().split(/\r?\n/).filter((line) => line.trim());
      const ticks = lines.map((line) => { const [observedAt, price, quantity, ...extra] = line.split(",").map((item) => item.trim()); if (extra.length || !observedAt || !price || !quantity) throw new Error("각 줄에 시각,가격,체결가능수량을 쉼표로 구분하세요. 헤더는 제외하세요."); return { observedAt, price: Number(price), quantity: Number(quantity) }; });
      void act({ action: "replay", ticks });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "가격 기록 형식을 확인하세요."); }
  }

  function practice() {
    const strategy = account?.state.session?.strategy ?? strategies.find((item) => item.id === strategyId) ?? strategies[0];
    if (!strategy) { setError("먼저 전략을 저장하세요."); return; }
    const instrument = NEXTRADE_INSTRUMENTS.find((item) => item.symbol === strategy.symbol)!;
    const start = Math.max(Date.now(), Date.parse(account?.state.session?.lastTickAt ?? "1970-01-01T00:00:00Z") + 60_000);
    const wait = strategy.triggerOperator === "LTE" ? strategy.triggerPrice + instrument.tickSize : strategy.triggerPrice - instrument.tickSize;
    setCsv([wait, strategy.triggerPrice, strategy.triggerPrice].map((value, index) => `${new Date(start + index * 60_000).toISOString()},${Math.max(instrument.minPrice, Math.min(instrument.maxPrice, value))},1`).join("\n"));
    setNotice("전략 설정값으로 만든 연습 기록입니다. 실제 시세가 아닙니다. 확인 후 재생하세요.");
  }

  function download() {
    if (!account) return;
    const link = document.createElement("a"); link.href = "/api/paper?format=csv"; link.download = "paper-orders.csv"; document.body.appendChild(link); link.click(); link.remove();
  }

  const session = account?.state.session;
  const running = session?.status === "RUNNING";
  const disabled = !authenticated || !account || busy;
  return <section className="paper-workspace" aria-labelledby="paper-title">
    <header className="paper-heading"><div><span className="section-kicker">PAPER OPERATIONS</span><h2 id="paper-title">가상 운용</h2><p>내 전략을 가상 자금으로 실행하고, 주문부터 잔고 변화까지 확인하세요.</p></div><span className="paper-source">입력 기록 재생 · 실계좌 영향 없음</span></header>
    <div className="paper-metrics"><div><span>가상 현금</span><strong>{account ? money(account.state.cash) : "—"}</strong><small>시작 자금 1억원</small></div><div><span>가상 평가액</span><strong>{account ? money(account.summary.equity) : "—"}</strong><small>마지막 입력 가격 기준</small></div><div><span>실현손익</span><strong>{account ? money(account.state.realizedPnl) : "—"}</strong><small>가정 수수료 포함</small></div><div><span>사용 가능한 현금</span><strong>{account ? money(account.summary.availableCash) : "—"}</strong><small>미체결 예약금 차감</small></div></div>
    <div className={`paper-feedback ${error ? "error" : ""}`} role="status" aria-live="polite">{!authenticated ? "로그인하면 사용자별 가상 계좌가 만들어집니다. 증권계좌 번호는 필요하지 않습니다." : error || notice}</div>
    <div className="paper-columns"><section className="paper-control" aria-labelledby="paper-session-title"><h3 id="paper-session-title">1. 운용 전략</h3><label>저장한 전략<select value={strategyId} disabled={running || busy} onChange={(event) => setStrategyId(event.target.value)}><option value="">전략을 선택하세요</option>{strategies.map((strategy) => <option value={strategy.id} key={strategy.id}>{strategy.name}</option>)}</select></label>{strategies.length === 0 ? <p className="paper-help">아래 전략 설계에서 첫 전략을 저장하면 여기에 나타납니다.</p> : null}<div className="paper-actions"><button type="button" className="primary-button" disabled={disabled || running || !strategyId} onClick={() => void act({ action: "start", strategyId })}>가상 운용 시작</button><button type="button" className="danger-button" disabled={disabled || !running} onClick={() => void act({ action: "stop" })}>운용 중지</button></div><dl className="paper-session-info"><div><dt>운용 상태</dt><dd>{running ? "가격 기록 대기 / 처리 가능" : session ? "중지됨" : "시작 전"}</dd></div><div><dt>현재 전략</dt><dd>{session?.strategy.name ?? "—"}</dd></div><div><dt>처리한 가격 기록</dt><dd>{session?.ticks ?? 0}개</dd></div><div><dt>세션 일일 주문 / 한도</dt><dd>{session ? `${session.dailyOrders} / ${session.strategy.maxOrdersPerDay}건` : "—"}</dd></div><div><dt>가정 수수료</dt><dd>매수·매도 각 0.015% · 세금 미반영</dd></div></dl><p className="paper-help">시작할 때 전략을 복사합니다. 원래 전략을 수정해도 진행 중인 운용에는 반영되지 않습니다. 다른 전략으로 바꾸려면 중지 후 다시 시작하세요.</p></section>
    <section className="paper-control" aria-labelledby="paper-replay-title"><h3 id="paper-replay-title">2. 가격 기록 재생</h3><p className="paper-help">시각,가격,체결가능수량을 한 줄씩 입력하세요. 최대 50개이며 시간순으로 처리합니다. 연습 기록은 사용자가 만든 가정입니다.</p><label htmlFor="paper-csv">가격 기록 <span>시간대 포함 ISO 시각 · 헤더 제외</span></label><textarea id="paper-csv" value={csv} onChange={(event) => setCsv(event.target.value)} spellCheck={false} placeholder="2026-10-28T09:00:00+09:00,70000,10" rows={6} maxLength={20_000} /><div className="paper-actions"><button type="button" className="primary-button" disabled={disabled || !running || !csv.trim()} onClick={replay}>{busy ? "처리 중…" : "가격 기록 재생"}</button><button type="button" className="ghost-button" disabled={!strategies.length || busy} onClick={practice}>연습 기록 만들기</button></div><p className="paper-help">체결은 입력 가격과 수량을 사용하는 가정입니다. 실제 호가 대기열·시장 충격·세금은 재현하지 않습니다. 브라우저를 닫으면 새 기록을 받지 않으며, 원장은 서버에 보존됩니다.</p></section></div>
    <section className="paper-holdings" aria-labelledby="paper-holdings-title"><h3 id="paper-holdings-title">가상 보유종목</h3>{account && Object.entries(account.state.positions).some(([, position]) => position.quantity > 0) ? <div className="paper-position-list">{Object.entries(account.state.positions).filter(([, position]) => position.quantity > 0).map(([symbol, position]) => <div key={symbol}><strong>{NEXTRADE_INSTRUMENTS.find((item) => item.symbol === symbol)?.displayName ?? symbol}</strong><span>{position.quantity}주</span><span>취득금액 {money(position.cost)}</span><span>평가금액 {money((account.state.marks[symbol] ?? position.cost / position.quantity) * position.quantity)}</span></div>)}</div> : <p className="paper-help">가상 체결 후 보유종목이 표시됩니다. 처음에는 보유주식이 없습니다.</p>}</section>
    <section className="paper-journal" aria-labelledby="paper-journal-title"><div className="paper-heading"><div><h3 id="paper-journal-title">가상 주문 원장</h3><p>최근 종료 주문 100건과 모든 미체결 · 버전 {account?.version ?? "—"}</p></div><div className="paper-actions"><button type="button" className="ghost-button" disabled={disabled} onClick={() => void load()}>원장 새로고침</button><button type="button" className="ghost-button" disabled={disabled || !account?.state.orders.length} onClick={download}>원장 CSV</button></div></div><div className="paper-table-scroll" tabIndex={0} role="region" aria-label="가상 주문 원장 표"><table><thead><tr><th>주문</th><th>종목 / 방향</th><th>주문수량</th><th>체결 / 잔량</th><th>평균 체결가</th><th>수수료</th><th>상태</th><th>관리</th></tr></thead><tbody>{account?.state.orders.length ? [...account.state.orders].reverse().map((order) => <tr key={order.id}><td>{order.id}</td><td>{order.symbol} · {order.side === "BUY" ? "매수" : "매도"}</td><td>{order.quantity}</td><td>{order.filled} / {order.remaining}</td><td>{order.filled ? money(order.averagePrice) : "—"}</td><td>{money(order.fees)}</td><td>{orderStatus[order.status]}</td><td>{order.status === "OPEN" || order.status === "PARTIAL" ? <button type="button" disabled={disabled} onClick={() => void act({ action: "cancel", orderId: order.id })}>취소</button> : "—"}</td></tr>) : <tr><td colSpan={8}>아직 가상 주문이 없습니다. 운용을 시작하고 가격 기록을 재생하세요.</td></tr>}</tbody></table></div></section>
    <section className="paper-events" aria-labelledby="paper-events-title"><h3 id="paper-events-title">최근 처리 기록</h3>{events.length ? <ol>{events.map((event, index) => <li key={`${event.at}-${index}`}><time>{new Date(event.at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })}</time><strong>{event.type}</strong><span>{event.message}</span></li>)}</ol> : <p className="paper-help">명령과 처리 결과는 사용자별 서버 원장에 저장됩니다.</p>}</section>
  </section>;
}
