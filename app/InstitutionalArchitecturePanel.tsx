"use client";

import { useEffect, useState } from "react";

type Operations = {
  environment: string;
  marketSequence: number;
  recoveredOrders: number;
  concurrency: string;
  gateway: { metrics: { messages: number; rejected: number; averageLatencyMicros: number; maxLatencyMicros: number }; sessions: Array<{ memberId: string; sessionId: string; protocol: string; status: string; expectedInboundSequence: number; lastHeartbeatAt: string }> };
  components: Array<{ id: string; name: string; status: string; protocol: string }>;
};

export default function InstitutionalArchitecturePanel() {
  const [operations, setOperations] = useState<Operations | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const response = await fetch("/api/gateway/operations", { cache: "no-store" });
      if (active && response.ok) setOperations(await response.json() as Operations);
    };
    const first = window.setTimeout(() => { void load(); }, 0);
    const timer = window.setInterval(load, 3000);
    return () => { active = false; window.clearTimeout(first); window.clearInterval(timer); };
  }, []);

  return <section className="institutional-hub" id="institutional-hub" aria-label="기관 주문 인프라">
    <div className="institutional-head"><div><span className="section-kicker">INSTITUTIONAL VENUE TOPOLOGY</span><h2>회원사 주문·체결 인프라</h2><p>개인 증권 API가 아니라 회원사 세션에서 주문을 수신하고, 모든 상태 변화를 시장 시퀀스와 Drop Copy로 확정합니다.</p></div><div className="certification-badge"><span className="tiny-dot amber" /> MEMBER CERTIFICATION</div></div>
    <div className="system-flow" aria-label="주문 처리 순서"><div><span>01</span><strong>회원사 세션</strong><small>HMAC · 순번 · heartbeat</small></div><b>→</b><div><span>02</span><strong>Order Entry</strong><small>중복·속도·형식 검사</small></div><b>→</b><div><span>03</span><strong>Pre-trade Risk</strong><small>가격·수량·시장상태</small></div><b>→</b><div><span>04</span><strong>Sequencer</strong><small>전역 단조 증가 순번</small></div><b>→</b><div><span>05</span><strong>Matching Core</strong><small>가격·시간 우선</small></div><b>→</b><div><span>06</span><strong>MD / Drop Copy</strong><small>호가·체결·실행보고</small></div></div>
    <div className="institutional-grid">
      <article className="infra-panel"><div className="infra-title"><div><span>VENUE COMPONENTS</span><strong>이중화 구성요소</strong></div><em>{operations?.components.filter((item) => item.status === "ACTIVE").length ?? 0} ACTIVE</em></div><div className="component-list">{operations?.components.map((component) => <div className="component-row" key={component.id}><span className={`component-light ${component.status.toLowerCase()}`} /><div><strong>{component.id} · {component.name}</strong><small>{component.protocol}</small></div><em>{component.status}</em></div>) ?? <div className="infra-empty">운영 상태 수집 중</div>}</div></article>
      <article className="infra-panel"><div className="infra-title"><div><span>ORDER ENTRY METRICS</span><strong>최근 60초 게이트웨이</strong></div><em>OE-A</em></div><div className="metric-matrix"><div><span>수신 메시지</span><strong>{operations?.gateway.metrics.messages.toLocaleString("ko-KR") ?? "—"}</strong><small>messages / 60s</small></div><div><span>거부 메시지</span><strong>{operations?.gateway.metrics.rejected.toLocaleString("ko-KR") ?? "—"}</strong><small>protocol + risk reject</small></div><div><span>평균 처리</span><strong>{operations ? `${operations.gateway.metrics.averageLatencyMicros.toLocaleString("ko-KR")}µs` : "—"}</strong><small>gateway measured</small></div><div><span>최대 처리</span><strong>{operations ? `${operations.gateway.metrics.maxLatencyMicros.toLocaleString("ko-KR")}µs` : "—"}</strong><small>gateway measured</small></div></div><div className="engine-coordination"><span>ENGINE COORDINATION</span><strong>{operations?.concurrency ?? "확인 중"}</strong><small>market seq {operations?.marketSequence.toLocaleString("ko-KR") ?? "—"} · recovered {operations?.recoveredOrders.toLocaleString("ko-KR") ?? "—"}</small></div></article>
      <article className="infra-panel member-sessions"><div className="infra-title"><div><span>MEMBER SESSIONS</span><strong>접속 회원사</strong></div><em>{operations?.gateway.sessions.filter((item) => item.status === "ACTIVE").length ?? 0} ONLINE</em></div>{operations?.gateway.sessions.length ? <div className="session-table"><div className="session-head"><span>회원사</span><span>세션</span><span>다음 순번</span><span>상태</span></div>{operations.gateway.sessions.map((session) => <div className="session-row" key={session.sessionId}><strong>{session.memberId}</strong><span>{session.sessionId}</span><span>{session.expectedInboundSequence}</span><em>{session.status}</em></div>)}</div> : <div className="infra-empty">외부 회원사 시험 세션 대기 중</div>}</article>
    </div>
    <div className="protocol-strip"><div><span>ORDER ENTRY</span><strong>POST /api/gateway/order-entry</strong><small>Message D · X-Member-Signature · contiguous sequence</small></div><div><span>MARKET DATA SNAPSHOT</span><strong>GET /api/market-data/snapshot</strong><small>Message W · X-Market-Sequence</small></div><div><span>EXECUTION REPORT</span><strong>Message 8</strong><small>ACK · REJECT · PARTIAL · FILLED</small></div><div><span>CERTIFICATION LIMIT</span><strong>1,000 msg/s/session</strong><small>distributed fixed-window enforcement</small></div></div>
  </section>;
}
