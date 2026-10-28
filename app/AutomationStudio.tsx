"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { NEXTRADE_INSTRUMENTS } from "../engine/instrumentMaster";
import PaperTradingPanel from "./PaperTradingPanel";

type StrategyProgress = {
  validationCount: number;
  triggerScenarioPassed: boolean;
  waitingScenarioPassed: boolean;
  readyToMark: boolean;
  liveExecutionAvailable: false;
  completedSteps: number;
  totalSteps: number;
};

type AutomationStrategy = {
  id: string;
  name: string;
  symbol: string;
  side: "BUY" | "SELL";
  triggerOperator: "GTE" | "LTE";
  triggerPrice: number;
  orderType: "LIMIT" | "MARKET";
  limitPrice: number | null;
  quantity: number;
  maxOrdersPerDay: number;
  maxDailyNotional: number;
  status: "draft" | "ready" | "armed" | "paused" | "stopped";
  strategyFingerprint: string | null;
  estimatedNotional: number | null;
  progress: StrategyProgress;
  lastEvaluatedAt: string | null;
  updatedAt: string;
  version: number;
};

type AutomationRun = {
  id: string;
  strategyId: string;
  status: string;
  observedPrice: number | null;
  detail: Record<string, unknown>;
  createdAt: string;
};

type Dashboard = { strategyCount: number; readyCount: number; evaluationCount: number; scenarioCoveragePercent: number };
type FormState = { id: string; expectedVersion: number | null; name: string; symbol: string; side: "BUY" | "SELL"; triggerOperator: "GTE" | "LTE"; triggerPrice: string; orderType: "LIMIT" | "MARKET"; limitPrice: string; quantity: string; maxOrdersPerDay: string; maxDailyNotional: string };

const number = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat("ko-KR").format(value);
const price = (value: number | null | undefined) => value == null ? "—" : `${number(value)}원`;
const initialInstrument = NEXTRADE_INSTRUMENTS[0];

const blankForm = (): FormState => ({
  id: "",
  expectedVersion: null,
  name: "가격 도달 매수",
  symbol: initialInstrument.symbol,
  side: "BUY",
  triggerOperator: "LTE",
  triggerPrice: String(initialInstrument.basePrice),
  orderType: "LIMIT",
  limitPrice: String(initialInstrument.basePrice),
  quantity: "1",
  maxOrdersPerDay: "1",
  maxDailyNotional: "1000000",
});

const statusText = (status: AutomationStrategy["status"]) => status === "ready" ? "검증 완료" : status === "paused" ? "일시정지" : status === "stopped" ? "중지" : "초안";
const decisionText = (status: string) => status === "WOULD_SUBMIT" ? "조건 충족" : status === "CONDITION_WAITING" ? "조건 대기" : status === "RISK_BLOCKED" ? "안전검사 차단" : status;

export default function AutomationStudio({ authenticated }: { authenticated: boolean }) {
  const [form, setForm] = useState<FormState>(blankForm);
  const [strategies, setStrategies] = useState<AutomationStrategy[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard>({ strategyCount: 0, readyCount: 0, evaluationCount: 0, scenarioCoveragePercent: 0 });
  const [selectedId, setSelectedId] = useState("");
  const [scenarioPrice, setScenarioPrice] = useState(String(initialInstrument.basePrice));
  const [loading, setLoading] = useState(authenticated);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("전략을 설계한 뒤 서로 다른 두 가격으로 조건을 점검해보세요.");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true);
    try {
      const response = await fetch("/api/automation/strategies", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "자동화 데이터를 불러오지 못했습니다.");
      setStrategies(payload.strategies ?? []);
      setRuns(payload.runs ?? []);
      setDashboard(payload.dashboard ?? { strategyCount: 0, readyCount: 0, evaluationCount: 0, scenarioCoveragePercent: 0 });
      setSelectedId((current) => current && (payload.strategies ?? []).some((item: AutomationStrategy) => item.id === current) ? current : payload.strategies?.[0]?.id ?? "");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "자동화 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [authenticated]);

  useEffect(() => {
    const task = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const selectedInstrument = useMemo(() => NEXTRADE_INSTRUMENTS.find((item) => item.symbol === form.symbol) ?? initialInstrument, [form.symbol]);
  const selectedStrategy = useMemo(() => strategies.find((strategy) => strategy.id === selectedId) ?? null, [strategies, selectedId]);
  const projectedNotional = (form.orderType === "LIMIT" ? Number(form.limitPrice) : Number(form.triggerPrice)) * Number(form.quantity);

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function changeSymbol(symbol: string) {
    const instrument = NEXTRADE_INSTRUMENTS.find((item) => item.symbol === symbol) ?? initialInstrument;
    setForm((current) => ({ ...current, symbol, triggerPrice: String(instrument.basePrice), limitPrice: String(instrument.basePrice) }));
  }

  function beginEdit(strategy: AutomationStrategy) {
    setForm({ id: strategy.id, expectedVersion: strategy.version, name: strategy.name, symbol: strategy.symbol, side: strategy.side, triggerOperator: strategy.triggerOperator, triggerPrice: String(strategy.triggerPrice), orderType: strategy.orderType, limitPrice: strategy.limitPrice == null ? "" : String(strategy.limitPrice), quantity: String(strategy.quantity), maxOrdersPerDay: String(strategy.maxOrdersPerDay), maxDailyNotional: String(strategy.maxDailyNotional) });
    setSelectedId(strategy.id);
    setMessage("전략을 수정하면 현재 검증 표시는 초안으로 돌아갑니다.");
    document.getElementById("strategy-builder")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function saveStrategy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authenticated || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/automation/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: form.id || undefined, expectedVersion: form.id ? form.expectedVersion : undefined, name: form.name, symbol: form.symbol, side: form.side, triggerOperator: form.triggerOperator, triggerPrice: Number(form.triggerPrice), orderType: form.orderType, limitPrice: form.orderType === "LIMIT" ? Number(form.limitPrice) : null, quantity: Number(form.quantity), maxOrdersPerDay: Number(form.maxOrdersPerDay), maxDailyNotional: Number(form.maxDailyNotional) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.issues?.[0]?.message ?? payload.error ?? "전략을 저장하지 못했습니다.");
      setSelectedId(payload.strategy.id);
      setScenarioPrice(String(payload.strategy.triggerPrice));
      setForm(blankForm());
      setMessage(payload.message);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "전략을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function evaluateScenario() {
    if (!selectedStrategy || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/automation/strategies/${encodeURIComponent(selectedStrategy.id)}/evaluate`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ observedPrice: Number(scenarioPrice) }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "조건 점검에 실패했습니다.");
      setMessage(`${decisionText(payload.evaluation.decision)} · ${payload.message}`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "조건 점검에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(strategy: AutomationStrategy, status: "draft" | "ready" | "paused") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/automation/strategies/${encodeURIComponent(strategy.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, expectedVersion: strategy.version }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "상태를 변경하지 못했습니다.");
      setMessage(payload.message);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "상태를 변경하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function setSuggestedScenario(kind: "trigger" | "wait") {
    if (!selectedStrategy) return;
    const instrument = NEXTRADE_INSTRUMENTS.find((item) => item.symbol === selectedStrategy.symbol) ?? initialInstrument;
    const triggerValue = selectedStrategy.triggerPrice;
    const waitingValue = selectedStrategy.triggerOperator === "GTE" ? Math.max(instrument.minPrice, triggerValue - instrument.tickSize) : Math.min(instrument.maxPrice, triggerValue + instrument.tickSize);
    setScenarioPrice(String(kind === "trigger" ? triggerValue : waitingValue));
  }

  if (!authenticated) {
    return <><PaperTradingPanel authenticated={false} strategies={[]} /><section className="automation-studio automation-locked" aria-labelledby="automation-title"><div className="automation-lock-mark">◎</div><span className="section-kicker">STRATEGY BUILDER</span><h2 id="automation-title">전략 설계</h2><p>가격 조건을 설계하고 두 가지 시나리오를 검증한 뒤 가상 운용으로 이어갑니다.</p><div className="automation-lock-note"><strong>로그인 후 사용할 수 있습니다</strong><span>전략과 가상 원장은 사용자별로 분리 저장됩니다. 증권사 API가 없어도 가격 기록으로 시작할 수 있습니다.</span></div></section></>;
  }

  return (
    <><PaperTradingPanel authenticated={authenticated} strategies={strategies} /><section className="automation-studio" aria-labelledby="automation-title">
      <header className="automation-studio-head">
        <div><span className="section-kicker">VALUE-FIRST AUTOMATION</span><h2 id="automation-title">내 자동화</h2><p>주문 조건과 예산을 먼저 검증하고, 실행 여부는 사용자가 직접 통제합니다.</p></div>
        <div className="paper-badge"><i /> PAPER LAB <small>실주문 없음</small></div>
      </header>

      <div className="value-loop" aria-label="자동화 준비 과정"><span className={dashboard.strategyCount > 0 ? "complete" : undefined}><b>1</b>전략 설계</span><span className={dashboard.strategyCount > 0 ? "complete" : undefined}><b>2</b>안전한도</span><span className={dashboard.evaluationCount > 0 ? "complete" : undefined}><b>3</b>1회 점검</span><span className="locked"><b>4</b>상시 실행 · 준비 중</span></div>

      <div className="automation-kpis" aria-label="자동화 사용 지표">
        <div><span>저장 전략</span><strong>{dashboard.strategyCount}</strong><small>사용자 전용</small></div>
        <div><span>검증 완료</span><strong>{dashboard.readyCount}</strong><small>양쪽 시나리오 통과</small></div>
        <div><span>누적 점검</span><strong>{dashboard.evaluationCount}</strong><small>수동 1회 평가</small></div>
        <div><span>시나리오 커버리지</span><strong>{dashboard.scenarioCoveragePercent}%</strong><small>조건 충족 + 대기</small></div>
      </div>

      <div className={`automation-feedback ${error ? "error" : ""}`} role="status" aria-live="polite"><span>{error ? "!" : "●"}</span><strong>{error || message}</strong><small>반복 실행과 증권사 주문 전송은 꺼져 있습니다.</small></div>

      <div className="automation-layout">
        <form id="strategy-builder" className="strategy-builder" onSubmit={saveStrategy}>
          <div className="automation-card-head"><div><span>STRATEGY BUILDER</span><strong>{form.id ? "전략 수정" : "새 전략 만들기"}</strong></div><em>{form.id ? "수정 후 재검증" : "초안 저장"}</em></div>
          <fieldset><legend><b>1</b> 언제 무엇을 거래할까요?</legend><label>전략 이름<input value={form.name} maxLength={60} onChange={(event) => updateForm("name", event.target.value)} required /></label><div className="automation-field-grid"><label>종목<select value={form.symbol} onChange={(event) => changeSymbol(event.target.value)}>{NEXTRADE_INSTRUMENTS.map((instrument) => <option key={instrument.symbol} value={instrument.symbol}>{instrument.displayName} · {instrument.symbol}</option>)}</select></label><label>방향<select value={form.side} onChange={(event) => updateForm("side", event.target.value as "BUY" | "SELL")}><option value="BUY">매수</option><option value="SELL">매도</option></select></label></div></fieldset>
          <fieldset><legend><b>2</b> 가격 조건을 정하세요</legend><div className="automation-field-grid"><label>조건<select value={form.triggerOperator} onChange={(event) => updateForm("triggerOperator", event.target.value as "GTE" | "LTE")}><option value="LTE">기준가 이하</option><option value="GTE">기준가 이상</option></select></label><label>기준 가격<input inputMode="numeric" value={form.triggerPrice} onChange={(event) => updateForm("triggerPrice", event.target.value)} required /></label></div><small>{selectedInstrument.displayName} 호가단위 {number(selectedInstrument.tickSize)}원 · 실시간 시세가 아닌 사용자 설정값입니다.</small></fieldset>
          <fieldset><legend><b>3</b> 주문과 예산을 제한하세요</legend><div className="automation-field-grid"><label>주문 방식<select value={form.orderType} onChange={(event) => updateForm("orderType", event.target.value as "LIMIT" | "MARKET")}><option value="LIMIT">지정가</option><option value="MARKET">시장가 가정</option></select></label><label>지정 가격<input inputMode="numeric" value={form.limitPrice} disabled={form.orderType === "MARKET"} onChange={(event) => updateForm("limitPrice", event.target.value)} required={form.orderType === "LIMIT"} /></label><label>주문 수량<input inputMode="numeric" value={form.quantity} onChange={(event) => updateForm("quantity", event.target.value)} required /></label><label>하루 최대 횟수<input inputMode="numeric" value={form.maxOrdersPerDay} onChange={(event) => updateForm("maxOrdersPerDay", event.target.value)} required /></label></div><label>하루 최대 주문금액<input inputMode="numeric" value={form.maxDailyNotional} onChange={(event) => updateForm("maxDailyNotional", event.target.value)} required /></label><div className={`budget-preview ${projectedNotional > Number(form.maxDailyNotional) ? "warning" : ""}`}><span>1회 예상 주문금액</span><strong>{Number.isFinite(projectedNotional) ? price(projectedNotional) : "—"}</strong><small>{projectedNotional > Number(form.maxDailyNotional) ? "일일 예산을 초과합니다" : "일일 예산 안에서 점검 가능"}</small></div></fieldset>
          <div className="builder-actions"><button className="primary-button" disabled={busy}>{busy ? "처리 중…" : form.id ? "수정하고 초안으로 저장" : "전략 초안 저장"}</button>{form.id ? <button type="button" className="ghost-button" onClick={() => setForm(blankForm())}>수정 취소</button> : null}</div>
          <p className="honesty-note">저장만으로 자동 실행되지 않습니다. 입력한 전략은 항상 <b>Paper · 초안</b>으로 저장됩니다.</p>
        </form>

        <section className="strategy-library" aria-labelledby="strategy-library-title">
          <div className="automation-card-head"><div><span>MY STRATEGIES</span><strong id="strategy-library-title">전략 보관함</strong></div><em>{strategies.length}개</em></div>
          {loading ? <div className="automation-empty"><span className="loading-ring" /><strong>전략을 불러오는 중</strong></div> : strategies.length === 0 ? <div className="automation-empty"><strong>아직 전략이 없습니다</strong><span>왼쪽에서 첫 전략을 저장해보세요.</span></div> : <div className="strategy-card-list">{strategies.map((strategy) => {
            const instrument = NEXTRADE_INSTRUMENTS.find((item) => item.symbol === strategy.symbol);
            return <article key={strategy.id} className={`strategy-card ${selectedId === strategy.id ? "selected" : ""}`}><button type="button" className="strategy-card-main" aria-pressed={selectedId === strategy.id} onClick={() => { setSelectedId(strategy.id); setScenarioPrice(String(strategy.triggerPrice)); }}><span className={`strategy-state ${strategy.status}`}>{statusText(strategy.status)}</span><strong>{strategy.name}</strong><small>{instrument?.displayName ?? strategy.symbol} · {strategy.side === "BUY" ? "매수" : "매도"} · {strategy.triggerOperator === "LTE" ? "이하" : "이상"} {price(strategy.triggerPrice)}</small><span className="progress-line"><i style={{ width: `${strategy.progress.completedSteps / strategy.progress.totalSteps * 100}%` }} /></span><em>시나리오 {strategy.progress.completedSteps}/{strategy.progress.totalSteps}</em></button><div className="strategy-card-actions"><button type="button" onClick={() => beginEdit(strategy)}>수정</button>{strategy.status === "ready" ? <button type="button" onClick={() => void changeStatus(strategy, "paused")}>일시정지</button> : strategy.progress.readyToMark ? <button type="button" className="accent" onClick={() => void changeStatus(strategy, "ready")}>검증 완료 표시</button> : null}</div></article>;
          })}</div>}
        </section>

        <section className="scenario-lab" aria-labelledby="scenario-lab-title">
          <div className="automation-card-head"><div><span>ONE-TIME CHECK</span><strong id="scenario-lab-title">가격 시나리오 점검</strong></div><em>주문 전송 0건</em></div>
          {!selectedStrategy ? <div className="automation-empty"><strong>점검할 전략을 선택하세요</strong><span>전략을 저장하면 조건 충족·대기 상황을 각각 확인할 수 있습니다.</span></div> : <>
            <div className="scenario-summary"><span>{selectedStrategy.name}</span><strong>{selectedStrategy.triggerOperator === "LTE" ? price(selectedStrategy.triggerPrice) + " 이하" : price(selectedStrategy.triggerPrice) + " 이상"}</strong><small>{selectedStrategy.side === "BUY" ? "매수" : "매도"} {number(selectedStrategy.quantity)}주 · 1회 예상 {price(selectedStrategy.estimatedNotional)}</small></div>
            <div className="scenario-presets"><button type="button" onClick={() => setSuggestedScenario("trigger")}><span>조건 충족 값</span><strong>{price(selectedStrategy.triggerPrice)}</strong></button><button type="button" onClick={() => setSuggestedScenario("wait")}><span>조건 대기 값</span><strong>자동 계산</strong></button></div>
            <label className="scenario-input">검증용 가격<input inputMode="numeric" value={scenarioPrice} onChange={(event) => setScenarioPrice(event.target.value)} /><small>사용자가 만든 가정입니다. 현재가·실시간 시세·투자 추천이 아닙니다.</small></label>
            <button type="button" className="primary-button scenario-run" disabled={busy} onClick={() => void evaluateScenario()}>{busy ? "점검 중…" : "이 가격으로 한 번 점검"}</button>
            <div className="scenario-checklist"><span className={selectedStrategy.progress.triggerScenarioPassed ? "pass" : ""}><i />조건 충족 상황 기록</span><span className={selectedStrategy.progress.waitingScenarioPassed ? "pass" : ""}><i />조건 대기 상황 기록</span><span><i />실제 주문 전송 없음</span></div>
          </>}
        </section>
      </div>

      <div className="automation-lower-grid">
        <section className="automation-history" aria-labelledby="automation-history-title"><div className="automation-card-head"><div><span>DECISION JOURNAL</span><strong id="automation-history-title">최근 점검 이력</strong></div><em>최대 250건 조회</em></div>{runs.length === 0 ? <div className="automation-empty compact"><strong>점검 이력이 없습니다</strong><span>전략을 선택해 첫 시나리오를 확인하세요.</span></div> : <div className="automation-run-list">{runs.slice(0, 8).map((run) => { const strategy = strategies.find((item) => item.id === run.strategyId); return <div className="automation-run" key={run.id}><span className={`run-decision ${run.status.toLowerCase()}`}>{decisionText(run.status)}</span><div><strong>{strategy?.name ?? "이전 전략"}</strong><small>사용자 시나리오 {price(run.observedPrice)} · {new Date(run.createdAt).toLocaleString("ko-KR", { hour12: false })}</small></div><em>실주문 없음</em></div>; })}</div>}</section>
        <section className="future-readiness" aria-labelledby="future-readiness-title"><div className="automation-card-head"><div><span>SAFE SCALE-UP</span><strong id="future-readiness-title">실거래 자동화 전환 조건</strong></div><em className="locked">현재 잠금</em></div><div className="future-gates"><span className={dashboard.strategyCount > 0 ? "available" : undefined}><i />전략 설정 서버 검증</span><span className={strategies.some((strategy) => strategy.progress.readyToMark) ? "available" : undefined}><i />양쪽 가격 시나리오 이력</span><span><i />사용자별 격리 Paper Broker</span><span><i />내구성 실행 워커·재시도·Outbox</span><span><i />증권사 계좌·시세·주문 API 승인</span><span><i />자동화 별도 동의·킬 스위치·대사</span></div><p>안전 기능은 유료 잠금 대상이 아닙니다. 운영 안정성·다중 증권사·팀 관리가 충분히 검증된 뒤에만 수익모델을 연결합니다.</p></section>
      </div>
    </section></>
  );
}
