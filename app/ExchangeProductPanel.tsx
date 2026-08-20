const gates = [
  { name: "결정론적 매칭 코어", detail: "Java 21 · 가격/시간 · IOC/FOK · STP", state: "BASELINE PASS", tone: "pass" },
  { name: "내구성·재기동", detail: "CRC32C WAL · fsync · replay digest", state: "BASELINE PASS", tone: "pass" },
  { name: "회원사 접속", detail: "mTLS · CompID · 전용회선 · 승인 프로토콜", state: "SPEC REQUIRED", tone: "pending" },
  { name: "시장감시·규제보고", detail: "통합시장 감시 · 불공정거래 · 보존", state: "INTEGRATION", tone: "blocked" },
  { name: "청산·결제", detail: "KRX/KSD 계약 · T+2 · 대사 · 불이행", state: "INTEGRATION", tone: "blocked" },
  { name: "HA·DR 인증", detail: "RPO 0 · 이중센터 · PTP · 자동절체", state: "INFRA REQUIRED", tone: "pending" },
];

const flow = ["Member A/B", "Session Gateway", "Pre-trade Risk", "Durable Sequencer", "Matching Partition", "Drop Copy / MD", "Surveillance", "Clearing"];

export default function ExchangeProductPanel() {
  return (
    <section className="exchange-product" id="exchange-core">
      <div className="exchange-product-head">
        <div>
          <span className="section-kicker">AUTOMATED EXECUTION · SYSTEM EVALUATION</span>
          <h1>자동 매매체결 코어</h1>
          <p>전략 주문을 접수하고 순번·위험통제·매칭·체결보고를 일관되게 처리하는 실행 코어입니다. 브로커 연결부와 체결 코어를 분리해 검증합니다.</p>
        </div>
        <span className="evaluation-badge"><i /> ENGINEERING EVALUATION BUILD</span>
      </div>

      <div className="truth-banner">
        <strong>현재 운영시장 인증 전</strong>
        <span>기술실사·PoC는 가능하지만 금융위원회 인가, 회원사 적합성, 시장감시, 청산결제, 이중센터 인증 전에는 실제 거래소로 사용할 수 없습니다.</span>
      </div>

      <div className="exchange-kpis">
        <div><span>CORE RUNTIME</span><strong>JAVA 21</strong><small>framework-independent</small></div>
        <div><span>LOCAL BASELINE</span><strong>144,902</strong><small>commands/sec · 개발 PC</small></div>
        <div><span>DURABILITY</span><strong>CRC32C + FSYNC</strong><small>command WAL</small></div>
        <div><span>REPLAY</span><strong>SHA-256 MATCH</strong><small>deterministic state</small></div>
        <div><span>CORE TESTS</span><strong>8 / 8</strong><small>price-time · risk · recovery</small></div>
      </div>

      <div className="exchange-flow" aria-label="자동 매매체결 처리 흐름">
        {flow.map((item, index) => <div key={item}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item}</strong>{index < flow.length - 1 ? <b>›</b> : null}</div>)}
      </div>

      <div className="exchange-product-grid">
        <section className="procurement-card">
          <div className="procurement-title"><div><span>PRODUCT ACCEPTANCE</span><strong>납품 준비 게이트</strong></div><em>2 / 6 BASELINE</em></div>
          <div className="gate-list">{gates.map((gate) => <div className="gate-row" key={gate.name}><i className={gate.tone} /><span><strong>{gate.name}</strong><small>{gate.detail}</small></span><em className={gate.tone}>{gate.state}</em></div>)}</div>
        </section>

        <section className="kernel-card">
          <div className="procurement-title"><div><span>VENUE CORE</span><strong>핫패스 설계 원칙</strong></div><em className="pass">DETERMINISTIC</em></div>
          <div className="kernel-list">
            <div><span>01</span><p><strong>정수 가격·수량</strong><small>부동소수점과 반올림 불확실성 제거</small></p></div>
            <div><span>02</span><p><strong>단일 단조증가 순번</strong><small>서버 시간이 아닌 sequence가 우선순위 결정</small></p></div>
            <div><span>03</span><p><strong>저널 선기록</strong><small>내구성 기록 이후에만 상태 전이</small></p></div>
            <div><span>04</span><p><strong>결정론적 재생</strong><small>동일 명령은 동일 주문장 다이제스트 생성</small></p></div>
            <div><span>05</span><p><strong>어댑터 격리</strong><small>브로커 API·HTTP·DB를 매칭 hot path에서 분리</small></p></div>
          </div>
        </section>
      </div>
    </section>
  );
}
