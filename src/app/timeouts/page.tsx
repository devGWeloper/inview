"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtDuration } from "@/components/TokenLatencyChart";
import { TimeoutTrendChart } from "@/components/TimeoutTrendChart";
import { TimeoutModelHeatmap } from "@/components/TimeoutModelHeatmap";
import { TickMetricDef, TickStatsResponse, TimeoutDimStat, TimeoutItem, TimeoutReason, TimeoutStatsResponse } from "@/lib/types";
import { TickMonitor } from "@/components/TickMonitor";
import { callStatus } from "@/lib/tokenStatus";
import { apiJson, errMessage } from "@/lib/apiClient";
import { useAgentScope } from "@/components/agents/AgentScopeProvider";
import {
  CUSTOM_LABEL,
  RANGE_PRESETS,
  RangePreset,
  resolveRange,
  useTimeRange,
} from "@/components/TimeRangeProvider";
import {
  TickRange,
  resolveTickRange,
  tickRefreshMs,
  useTick,
  useTickView,
} from "@/components/tick/TickProvider";
import { TickActions, TickPresets } from "@/components/tick/TickToolbar";
import { analysisMinutesForTickWin, spanMinutes, tickSelFor } from "@/components/tick/rangeSync";
import { ViewToggle } from "@/components/tick/ViewToggle";

// Timeout 탭 — LLM 호출이 끊긴 지점을 그대로 본다.
// 출처는 TRX_TOKEN_DET 의 실패 적재(STAT_CD='ERROR' + ERR_CTN + LATENCY_MS) 한 곳이며,
// 노드/모델/질의/대기시간 모두 그 실패한 호출의 값이다 (추정 없음).
//
// 조회 조건(기간·노드·모델)은 서버 필터라 KPI/추이/분포/목록이 전부 같은 범위로 좁혀진다.
// 목록 안의 컬럼 필터는 그 위에 얹는 클라이언트 필터(로드된 행 범위)다.

// 조회 기간(프리셋/직접 설정)은 Tokens 탭과 **공유**한다 — TimeRangeProvider 참고.
// 여기에 프리셋 배열이나 기간 state 를 다시 두지 말 것(두 탭의 구성이 또 갈린다).
//
// 틱 뷰는 같은 TRX_TOKEN_DET 를 롤링 60초로 본다. ⚠️ 다만 지표가 Tokens 탭과 다르다 —
// 여기서 TPM/RPM 을 그대로 복제하면 두 화면의 숫자가 글자 하나까지 같아져 볼 이유가 없다.
// 이 화면의 틱 뷰는 **분당 타임아웃 / 분당 실패**다(`?view=failure`).
interface Range { from: string; to: string }

/**
 * 틱 뷰의 게이지/차트 정의.
 * ⚠️ 한도(limit)는 0 이다 — 타임아웃은 사내 rate limit 같은 상한이 있는 값이 아니다.
 *    0 이면 기준선·초과 판정 없이 추이만 그리고, 목록은 "가장 몰린 순간" 이 된다.
 */
const TIMEOUT_METRICS: [TickMetricDef, TickMetricDef] = [
  { name: "타임아웃", unitText: "건/분", unit: "건", limit: 0 },
  { name: "실패", unitText: "건/분", unit: "건", limit: 0 },
];

function fmtRange(from: string | null, to: string | null): string {
  if (!from || !to) return "—";
  return `${from.replace("T", " ").slice(0, 16)}  →  ${to.replace("T", " ").slice(0, 16)}`;
}
function fmtTs(ts: string | null): string {
  return ts ? ts.replace("T", " ").slice(0, 19) : "—";
}
const pct = (n: number, total: number): string => (total > 0 ? ((n / total) * 100).toFixed(1) + "%" : "—");

export default function TimeoutsPage() {
  const { agentId, agent, isDefault, ready } = useAgentScope();
  const { sel, ready: rangeReady, setPreset, setCustom } = useTimeRange();
  // 직접 설정 입력은 로컬 초안이고, '적용' 을 눌렀을 때만 공유 상태에 커밋된다.
  // draftCustom = 패널만 열린 상태(아직 적용 전) — 공유 선택은 그대로 프리셋이다.
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [draftCustom, setDraftCustom] = useState(false);
  const [node, setNode] = useState("");
  const [model, setModel] = useState("");
  const [stats, setStats] = useState<TimeoutStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** 틱 뷰인가 (화면별로 기억) + 공유 조회 창 */
  const [tickView, setTickView, tickViewReady] = useTickView("timeouts");
  const { sel: tickSel, ready: tickReady, resolve: resolveTick, apply: applyTick } = useTick();
  const [tick, setTick] = useState<TickStatsResponse | null>(null);
  const [tickClamped, setTickClamped] = useState(false);

  // 응답 도착 시점의 "현재 선택된 에이전트" 를 읽기 위한 ref — tokens 페이지와 동일 패턴.
  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;

  const load = useCallback(async (r: Range, nodeNm: string, modelNm: string) => {
    const requestFor = agentId; // 이 요청이 향한 에이전트
    setLoading(true);
    setErr(null);
    try {
      const q = new URLSearchParams({ dateFrom: r.from, dateTo: r.to });
      if (agentId) q.set("agent", agentId);
      if (nodeNm) q.set("nodeNm", nodeNm);
      if (modelNm) q.set("modelNm", modelNm);
      const data = await apiJson<TimeoutStatsResponse>(`/api/timeouts?${q.toString()}`, { cache: "no-store" });
      // ⚠️ 응답 도착 시점에 이미 다른 에이전트로 전환됐으면 폐기한다 — tokens 페이지와 동일 이유.
      //    단, 양쪽 다 "모름" 은 통과다 — data.agentId 가 없으면(구버전 라우트) requestFor 로
      //    대체하고, agentIdRef.current 자체가 비어 있으면(/api/agents 조회 실패로 agentId=""
      //    인 상태) 비교 대상이 없으니 무조건 통과시킨다. 엄격 비교만 쓰면 이 두 경우에 매번
      //    폐기돼 헤더·필터는 뜨는데 데이터/에러/안내가 전부 없는 빈 화면이 된다.
      const echoed = data.agentId ?? requestFor;
      if (agentIdRef.current && echoed !== agentIdRef.current) return;
      setStats(data);
    } catch (e) {
      if (agentIdRef.current !== requestFor) return;
      setErr(errMessage(e, "타임아웃 집계를 불러오지 못했습니다."));
      setStats(null);
    } finally {
      if (agentIdRef.current === requestFor) setLoading(false);
    }
  }, [agentId]);

  // 틱(롤링 60초) 조회 — 같은 TRX_TOKEN_DET 를 ?view=failure 로 본다.
  // 노드/모델 필터는 그대로 걸린다(기간 분석 뷰와 조회 범위 해석이 갈리지 않게).
  const loadTick = useCallback(async (r: TickRange, nodeNm: string, modelNm: string) => {
    const requestFor = agentId;
    setLoading(true);
    setErr(null);
    try {
      const q = new URLSearchParams({ dateFrom: r.from, dateTo: r.to, view: "failure" });
      if (agentId) q.set("agent", agentId);
      if (nodeNm) q.set("nodeNm", nodeNm);
      if (modelNm) q.set("modelNm", modelNm);
      const data = await apiJson<TickStatsResponse>(`/api/tokens/tick?${q.toString()}`, { cache: "no-store" });
      const echoed = data.agentId ?? requestFor;
      if (agentIdRef.current && echoed !== agentIdRef.current) return;
      setTick(data);
      // 요청한 시작 시각보다 응답의 시작이 뒤면 서버가 24시간으로 자른 것이다.
      // (1분 여유 — 초 정규화 차이를 잘림으로 오인하지 않도록)
      const want = Date.parse(r.from);
      const got = data.range.from ? Date.parse(data.range.from) : NaN;
      setTickClamped(Number.isFinite(want) && Number.isFinite(got) && got - want > 60_000);
    } catch (e) {
      if (agentIdRef.current !== requestFor) return;
      setErr(errMessage(e, "틱 조회를 불러오지 못했습니다."));
      setTick(null);
      setTickClamped(false);
    } finally {
      if (agentIdRef.current === requestFor) setLoading(false);
    }
  }, [agentId]);

  // 최초 조회 + 에이전트 전환 시 재조회. ready 이전에는 agentId 가 비어 있어 조회하지 않는다.
  // ⚠️ 에이전트가 바뀌면 노드/모델 필터와 렌더된 데이터를 비운다 — 이유는 tokens 페이지와 동일
  //    (필터가 남으면 "이 에이전트는 사용량이 없다" 로 오독되고, 데이터가 남으면 새 이름 아래
  //    이전 에이전트의 수치가 잠깐 남아 보인다).
  // 지금 선택된 공유 기간을 실제 구간으로 (프리셋은 항상 '지금' 기준이라 호출 시점에 계산한다)
  const currentRange = useCallback((): Range => resolveRange(sel), [sel]);

  // 공유 상태가 복원되기 전(rangeReady=false)에 조회하면 기본값으로 한 번, 복원값으로 한 번
  // 이중 조회가 된다 — 둘 다 준비된 뒤에 부른다.
  useEffect(() => {
    if (!ready || !rangeReady || !tickReady || !tickViewReady) return;
    setNode("");
    setModel("");
    setStats(null);
    setTick(null);
    if (tickView) loadTick(resolveTick(), "", "");
    else load(resolveRange(sel), "", "");
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [ready, rangeReady, tickReady, tickViewReady, agentId]);

  // 자동 갱신 — 틱 뷰의 live 모드에서만 (TickToolbar 의 체크박스). 주기는 창 길이에 맞춘다.
  useEffect(() => {
    if (!tickView || tickSel.mode !== "live" || !tickSel.auto) return;
    const id = setInterval(() => loadTick(resolveTickRange(tickSel), node, model), tickRefreshMs(tickSel.win));
    return () => clearInterval(id);
  }, [tickView, tickSel, node, model, loadTick]);

  // 직접 설정 초안은 공유된 값으로 채워 둔다 — 탭을 옮겼다 와도 다시 입력할 필요가 없다.
  useEffect(() => {
    if (sel.preset === "custom" && sel.customFrom && sel.customTo) {
      setCustomFrom(sel.customFrom);
      setCustomTo(sel.customTo);
    }
  }, [sel.preset, sel.customFrom, sel.customTo]);

  const onPreset = (p: RangePreset) => {
    // setPreset 은 비동기라 sel 이 아직 옛 값이다 — 방금 고른 프리셋으로 직접 풀어서 조회한다.
    const r = resolveRange({ ...sel, preset: p });
    setPreset(p);
    setDraftCustom(false);
    load(r, node, model);
  };
  const enterCustom = () => {
    if (!customFrom || !customTo) {
      const r = currentRange();
      setCustomFrom(r.from.slice(0, 16));
      setCustomTo(r.to.slice(0, 16));
    }
    // 아직 커밋하지 않는다 — '적용' 을 눌렀을 때 공유 상태에 반영된다.
    setDraftCustom(true);
  };
  const applyCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customFrom || !customTo) return;
    setCustom(customFrom, customTo);
    setDraftCustom(false);
    load(resolveRange({ preset: "custom", customFrom, customTo }), node, model);
  };
  /** 노드/모델 필터 변경 — 현재 뷰에 맞는 쪽을 다시 조회한다 */
  const reload = (nodeNm: string, modelNm: string) => {
    if (tickView) loadTick(resolveTick(), nodeNm, modelNm);
    else load(currentRange(), nodeNm, modelNm);
  };
  const onNode = (k: string) => { const next = node === k ? "" : k; setNode(next); reload(next, model); };
  const onModel = (k: string) => { const next = model === k ? "" : k; setModel(next); reload(node, next); };

  /**
   * 보기 전환. 켜는 즉시 조회한다 — 토글을 눌렀는데 빈 화면이 남아 있으면 켜진 건지 알 수 없다.
   *
   * ⚠️ **조회 구간을 서로 물려준다** (rangeSync.ts) — 토글할 때마다 무관한 구간으로 튀면
   *    매번 기간을 다시 골라야 한다. 두 뷰의 후보가 겹치지 않아 정확히 같지는 않다.
   */
  const onView = (live: boolean) => {
    setTickView(live);
    setDraftCustom(false);
    if (live) {
      const cur = sel.preset === "custom" && sel.customFrom && sel.customTo
        ? { from: sel.customFrom, to: sel.customTo }
        : null;
      const mins = cur
        ? spanMinutes(cur.from, cur.to) ?? 60
        : (RANGE_PRESETS.find((p) => p.key === sel.preset) ?? RANGE_PRESETS[0]).hours * 60;
      applyTick(tickSelFor(mins, cur));
      loadTick(resolveTick(), node, model);
      return;
    }
    if (tickSel.mode === "custom" && tickSel.from && tickSel.to) {
      setCustom(tickSel.from, tickSel.to);
      load(resolveRange({ preset: "custom", customFrom: tickSel.from, customTo: tickSel.to }), node, model);
      return;
    }
    // 틱 창(≤180분)을 덮는 가장 짧은 집계 프리셋으로 옮긴다.
    const need = analysisMinutesForTickWin(tickSel.win);
    const p = RANGE_PRESETS.find((x) => x.hours * 60 >= need) ?? RANGE_PRESETS[0];
    setPreset(p.key);
    load(resolveRange({ ...sel, preset: p.key }), node, model);
  };

  const customOpen = draftCustom || sel.preset === "custom";
  const scope = [node && `노드 ${node}`, model && `모델 ${model}`].filter(Boolean).join(" · ");
  const topNode = stats?.byNode[0];

  return (
    <div className="dash">
      <div className="dash-header stacked">
        {/* 1줄 — 제목 + 보기 전환(우상단 고정). ⚠️ 토글을 조회 줄로 되돌리지 말 것: 폭이 모자라면 그것만 위로 튀어 올라 줄이 깨진다. */}
        <div className="dash-head-row">
          <div className="dash-title">
            <div className="dash-title-main">Timeout</div>
            <div className="dash-title-sub">
              {tickView
                ? tick ? fmtRange(tick.range.from, tick.range.to) : "—"
                : stats ? fmtRange(stats.range.from, stats.range.to) : fmtRange(currentRange().from, currentRange().to)}
              <span className="dash-title-note">
                {tickView ? " · 틱 · 분당 타임아웃/LLM 오류" : " · LLM 호출 실패 적재 기준"}
                {!isDefault && agent ? ` · ${agent.name}` : ""}
              </span>
            </div>
          </div>
          {/* 보기 전환 — 조회 조건이 아니라 화면 자체를 바꾸는 조작이라 우상단 자기 자리에 둔다 */}
          <ViewToggle
            live={tickView}
            onChange={onView}
            pulsing={tickSel.auto && tickSel.mode === "live"}
          />
        </div>

        <div className="dash-filter">
          {/* 프리셋 줄 자리는 보기에 따라 통째로 교체된다.
              ⚠️ .preset-slot 이 두 세트 중 넓은 쪽 폭을 확보한다 — 없으면 토글할 때마다
                 뒤따르는 컨트롤이 좌우로 밀린다. */}
          <div className="preset-slot">
          {tickView ? (
            <TickPresets loading={loading} onSubmit={() => loadTick(resolveTick(), node, model)} />
          ) : (
            <>
              <div className="preset-group" role="tablist" aria-label="time preset">
                {RANGE_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className={"preset-btn" + (!customOpen && sel.preset === p.key ? " active" : "")}
                    onClick={() => onPreset(p.key)}
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={"preset-btn" + (customOpen ? " active" : "")}
                  onClick={enterCustom}
                >
                  {CUSTOM_LABEL}
                </button>
              </div>
              {customOpen && (
                <form className="custom-range" onSubmit={applyCustom}>
                  <input
                    type="datetime-local"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    aria-label="from"
                  />
                  <span className="range-arrow">→</span>
                  <input
                    type="datetime-local"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    aria-label="to"
                  />
                  <button type="submit" className="btn primary">적용</button>
                </form>
              )}
            </>
          )}
          </div>
          {/* 동작 버튼은 두 보기가 같은 자리를 쓴다 (집계 뷰는 '적용' 이 직접 설정 폼 안에 있어
              여기는 틱일 때만 렌더된다) */}
          {tickView && <TickActions loading={loading} onSubmit={() => loadTick(resolveTick(), node, model)} />}
        </div>
      </div>

      {(node || model) && (
        <div className="to-scope">
          <span className="to-scope-label">조회 범위</span>
          {node && (
            <button type="button" className="to-chip" onClick={() => onNode(node)}>
              노드 <b>{node}</b> ✕
            </button>
          )}
          {model && (
            <button type="button" className="to-chip is-model" onClick={() => onModel(model)}>
              모델 <b>{model}</b> ✕
            </button>
          )}
        </div>
      )}

      {loading && <div className="dash-banner loading">집계 중…</div>}
      {err && <div className="dash-banner err">불러오기 실패: {err}</div>}
      {agent && !agent.dbConfigured && (
        <div className="dash-banner err">
          {/* config.yml 에 agents: 섹션이 없으면 config.ts 가 layers.GAIA 로 기본 에이전트 1개를
              합성한다 — 이 경우 고칠 곳은 "agents 항목"이 아니라 layers.GAIA 라 두 경우를 모두
              가리키는 문구로 안내한다. */}
          {agent.name} 의 DB 접속 정보가 설정되지 않았습니다 — config.yml 에서 agents 섹션이 있다면
          해당 에이전트의 db 항목을, 없다면 layers.GAIA 를 확인하세요.
          (빈 화면은 &ldquo;사용량 0&rdquo; 이 아닙니다)
        </div>
      )}

      {tickView && tick && (
        <TickMonitor stats={tick} metrics={TIMEOUT_METRICS} rowsLabel="호출" clamped={tickClamped} />
      )}

      {!tickView && stats && !stats.available && (
        <div className="dash-banner">
          아직 실패 호출이 적재되지 않았습니다 · GAIA 가 <code>TRX_TOKEN_DET.STAT_CD</code> /{" "}
          <code>ERR_CTN</code> 을 적재하면 이 화면이 채워집니다.
        </div>
      )}

      {!tickView && stats && stats.available && (
        <>
          <div className="kpi-grid">
            <div className="kpi-card tone-err">
              <div className="kpi-title">타임아웃</div>
              <div className="kpi-value">{stats.timeoutCalls.toLocaleString()}</div>
              <div className="kpi-sub">
                전체 호출 {stats.totalCalls.toLocaleString()}건 중 {pct(stats.timeoutCalls, stats.totalCalls)}
              </div>
            </div>
            <div className="kpi-card tone-fail">
              <div className="kpi-title">실패 호출</div>
              <div className="kpi-value">{stats.failedCalls.toLocaleString()}</div>
              <div className="kpi-sub">
                타임아웃 외 LLM 오류 {(stats.failedCalls - stats.timeoutCalls).toLocaleString()}건 포함
              </div>
            </div>
            {/* 사용자 체감 피해량 — 호출 수보다 "질문 몇 개가 깨졌나" 가 크기를 말해준다 */}
            <div className="kpi-card tone-warn">
              <div className="kpi-title">영향 질문</div>
              <div className="kpi-value">{stats.affectedTraces.toLocaleString()}</div>
              <div className="kpi-sub">
                {stats.lastAt ? `최근 발생 ${fmtTs(stats.lastAt).slice(5, 16)}` : "발생 없음"}
              </div>
            </div>
            <div className="kpi-card tone-default">
              <div className="kpi-title">영향 사용자</div>
              <div className="kpi-value">{stats.affectedUsers.toLocaleString()}</div>
              <div className="kpi-sub">
                {topNode ? `최다 발생 ${topNode.key} (${topNode.failed.toLocaleString()}건)` : "—"}
              </div>
            </div>
          </div>

          <section className="dash-card dash-card-hero">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">발생 추이</span>
                <span className="dash-card-sub">호출 시각 기준{scope && ` · ${scope}`}</span>
              </div>
            </div>
            <div className="dash-card-body">
              {stats.failedCalls === 0 ? (
                <div className="top-empty">이 기간에 실패한 LLM 호출이 없습니다</div>
              ) : (
                <TimeoutTrendChart stats={stats} />
              )}
            </div>
          </section>

          {/* 모델 × 시간 히트맵 — "그 시간대에 이 모델이 몇 건 중 몇 건 실패" 를 셀 하나로 압축.
              총 요청 수를 분모로 두는 게 핵심 — 색은 실패율, 라벨 옆 숫자는 총 호출. */}
          <section className="dash-card dash-card-hero">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">모델별 요청·실패 격자</span>
                <span className="dash-card-sub">
                  가로축 시간 · 세로축 모델 · 셀 색 = 그 슬롯의 실패율{scope && ` · ${scope}`}
                </span>
              </div>
            </div>
            <div className="dash-card-body">
              <TimeoutModelHeatmap stats={stats} selectedModel={model} onSelectModel={onModel} />
            </div>
          </section>

          <div className="to-grid">
            <DimCard
              title="노드별"
              sub="어느 노드에서 끊겼나"
              dims={stats.byNode}
              selected={node}
              onSelect={onNode}
            />
            <DimCard
              title="모델별"
              sub="어느 모델에서 끊겼나"
              dims={stats.byModel}
              selected={model}
              onSelect={onModel}
            />
            <section className="dash-card">
              <div className="dash-card-head">
                <div className="dash-card-title-group">
                  <span className="dash-card-title">오류 사유</span>
                  <span className="dash-card-sub">가장 흔한 원인</span>
                </div>
              </div>
              <div className="dash-card-body">
                {stats.topReasons.length === 0 ? (
                  <div className="top-empty">데이터 없음</div>
                ) : (
                  <ReasonList reasons={stats.topReasons} totalFailed={stats.failedCalls} />
                )}
              </div>
            </section>
          </div>

          <section className="dash-card">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">실패한 호출</span>
                <span className="dash-card-sub">최근 {stats.items.length.toLocaleString()}건</span>
              </div>
            </div>
            <div className="dash-card-body">
              <FailedCallsTable items={stats.items} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/** 노드/모델/사용자 분포 — 실패 수 막대(타임아웃/기타 구분) + 그 값의 전체 호출 대비 실패율 */
function DimCard({
  title, sub, dims, selected, onSelect,
}: {
  title: string;
  sub: string;
  dims: TimeoutDimStat[];
  selected?: string;
  onSelect?: (key: string) => void;
}) {
  const max = Math.max(1, ...dims.map((d) => d.failed));
  return (
    <section className="dash-card">
      <div className="dash-card-head">
        <div className="dash-card-title-group">
          <span className="dash-card-title">{title}</span>
          <span className="dash-card-sub">{sub}</span>
        </div>
      </div>
      <div className="dash-card-body">
        {dims.length === 0 ? (
          <div className="top-empty">데이터 없음</div>
        ) : (
          <div className="to-dims">
            {dims.map((d) => (
              <button
                key={d.key}
                type="button"
                className={"to-dim" + (selected === d.key ? " active" : "")}
                onClick={onSelect ? () => onSelect(d.key) : undefined}
                disabled={!onSelect}
                title={`실패 ${d.failed.toLocaleString()} / 전체 호출 ${d.calls.toLocaleString()} · 타임아웃 ${d.timeout.toLocaleString()}`}
              >
                <span className="to-dim-key">{d.key}</span>
                {/* 막대는 추이 차트와 같은 색 규칙 — 타임아웃(진한 빨강) + LLM 오류(앰버) */}
                <span className="to-dim-bar">
                  <span className="seg-t" style={{ width: `${(d.timeout / max) * 100}%` }} />
                  <span className="seg-o" style={{ width: `${(Math.max(0, d.failed - d.timeout) / max) * 100}%` }} />
                </span>
                <span className="to-dim-val mono">{d.failed.toLocaleString()}</span>
                <span className="to-dim-rate mono">{pct(d.failed, d.calls)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** 오류 사유 top — 순위 · 문구 · 발생 수(비중) */
function ReasonList({ reasons, totalFailed }: { reasons: TimeoutReason[]; totalFailed: number }) {
  return (
    <ol className="rs-list">
      {reasons.map((r, i) => {
        const share = totalFailed > 0 ? (r.failed / totalFailed) * 100 : 0;
        return (
          <li key={`${r.reason}-${i}`} className="rs-item">
            <span className="rs-rank">{i + 1}</span>
            <span className="rs-text" title={r.reason}>{r.reason}</span>
            <span className="rs-stats mono">
              <b>{r.failed.toLocaleString()}</b>
              <span className="rs-stats-sub">{share.toFixed(0)}%</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ── 실패한 호출 목록 ─────────────────────────────────────────────────────────
// 컬럼 필터(결과/노드/모델/사용자/텍스트) + 헤더 클릭 정렬 + 페이징.
// 서버 조회 범위(기간·노드·모델) 안에서 로드된 행을 다시 좁히는 클라이언트 필터다.

const PAGE_SIZE = 25;
type SortKey = "time" | "wait";
type SortDir = "asc" | "desc";
type Result = "" | "timeout" | "error";

function FailedCallsTable({ items }: { items: TimeoutItem[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "time", dir: "desc" });
  const [fResult, setFResult] = useState<Result>("");
  const [fNode, setFNode] = useState("");
  const [fModel, setFModel] = useState("");
  const [fUser, setFUser] = useState("");
  const [fText, setFText] = useState("");
  const [page, setPage] = useState(0);

  const opts = (pick: (it: TimeoutItem) => string | null) =>
    Array.from(new Set(items.map((it) => pick(it) ?? "(없음)"))).sort((a, b) => a.localeCompare(b));
  const nodeOptions = useMemo(() => opts((it) => it.nodeNm), [items]);
  const modelOptions = useMemo(() => opts((it) => it.modelNm), [items]);

  const hasFilter = !!(fResult || fNode || fModel || fUser.trim() || fText.trim());
  const clearFilters = () => {
    setFResult("");
    setFNode("");
    setFModel("");
    setFUser("");
    setFText("");
  };

  const rows = useMemo(() => {
    const u = fUser.trim().toLowerCase();
    const t = fText.trim().toLowerCase();
    let list = items;
    if (fResult) list = list.filter((it) => (callStatus(it.statCd, it.errCtn) === "timeout") === (fResult === "timeout"));
    if (fNode) list = list.filter((it) => (it.nodeNm ?? "(없음)") === fNode);
    if (fModel) list = list.filter((it) => (it.modelNm ?? "(없음)") === fModel);
    if (u) list = list.filter((it) => (it.userId ?? "").toLowerCase().includes(u));
    if (t)
      list = list.filter(
        (it) =>
          (it.queryCtn ?? "").toLowerCase().includes(t) ||
          (it.errCtn ?? "").toLowerCase().includes(t) ||
          (it.traceId ?? "").toLowerCase().includes(t)
      );
    const mul = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sort.key === "wait") return ((a.latencyMs ?? -1) - (b.latencyMs ?? -1)) * mul;
      return (a.callTm ?? "").localeCompare(b.callTm ?? "") * mul;
    });
  }, [items, fResult, fNode, fModel, fUser, fText, sort]);

  useEffect(() => { setPage(0); }, [fResult, fNode, fModel, fUser, fText, sort, items]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount - 1);
  const paged = rows.slice(curPage * PAGE_SIZE, curPage * PAGE_SIZE + PAGE_SIZE);

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  const SortTh = ({ k, label, num }: { k: SortKey; label: string; num?: boolean }) => (
    <th
      className={num ? "num" : undefined}
      aria-sort={sort.key === k ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <button type="button" className={"qth-sort" + (sort.key === k ? " active" : "")} onClick={() => onSort(k)}>
        {label}
        <span className="qth-arrow" aria-hidden>{sort.key === k ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );

  if (items.length === 0) return <div className="top-empty">없음</div>;

  return (
    <div className="qtable-wrap">
      <div className="qtable-controls">
        <span className="qtable-meta">
          {rows.length.toLocaleString()}
          {hasFilter && ` / ${items.length.toLocaleString()}`} 건
        </span>
        {hasFilter && (
          <button type="button" className="qfilter-clear" onClick={clearFilters}>
            컬럼 필터 초기화 ✕
          </button>
        )}
      </div>

      <div className="token-recent-wrap">
        <table className="token-recent to-table">
          <thead>
            <tr>
              <SortTh k="time" label="호출 시각" />
              <th>결과</th>
              <th>노드</th>
              <th>모델</th>
              <SortTh k="wait" label="대기" num />
              <th>사용자</th>
              <th className="to-col-q">질의</th>
              <th className="to-col-q">사유</th>
              <th>TRACE_ID</th>
            </tr>
            <tr className="qfilter-row">
              <th />
              <th>
                <select
                  className="qft-select"
                  value={fResult}
                  onChange={(e) => setFResult(e.target.value as Result)}
                  aria-label="결과 필터"
                >
                  <option value="">전체</option>
                  <option value="timeout">타임아웃</option>
                  <option value="error">LLM 오류</option>
                </select>
              </th>
              <th>
                <select className="qft-select" value={fNode} onChange={(e) => setFNode(e.target.value)} aria-label="노드 필터">
                  <option value="">전체</option>
                  {nodeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </th>
              <th>
                <select className="qft-select" value={fModel} onChange={(e) => setFModel(e.target.value)} aria-label="모델 필터">
                  <option value="">전체</option>
                  {modelOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </th>
              <th />
              <th>
                <input
                  type="text"
                  className="qft-input"
                  placeholder="검색"
                  value={fUser}
                  onChange={(e) => setFUser(e.target.value)}
                  aria-label="사용자 필터"
                />
              </th>
              <th colSpan={3}>
                <input
                  type="text"
                  className="qft-input"
                  placeholder="질의 / 사유 / TRACE_ID 검색"
                  value={fText}
                  onChange={(e) => setFText(e.target.value)}
                  aria-label="질의·사유 필터"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {paged.map((it) => {
              const st = callStatus(it.statCd, it.errCtn);
              return (
                <tr key={it.tokenId}>
                  <td className="mono">{fmtTs(it.callTm)}</td>
                  <td>
                    <span className={"to-st" + (st === "timeout" ? " is-timeout" : "")}>
                      {st === "timeout" ? "타임아웃" : "LLM 오류"}
                    </span>
                  </td>
                  <td>{it.nodeNm ? <span className="qnode">{it.nodeNm}</span> : "—"}</td>
                  <td>{it.modelNm ? <span className="qmodel">{it.modelNm}</span> : "—"}</td>
                  <td className="num mono">{fmtDuration(it.latencyMs)}</td>
                  <td className="mono">{it.userId ?? "—"}</td>
                  <td className="to-col-q">
                    <span className="to-q" title={it.queryCtn ?? undefined}>{it.queryCtn ?? "—"}</span>
                  </td>
                  <td className="to-col-q">
                    <span className="to-q to-err" title={it.errCtn ?? undefined}>{it.errCtn ?? "—"}</span>
                  </td>
                  <td className="to-trace mono">{it.traceId ?? "—"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <div className="top-empty">조건에 맞는 호출이 없습니다</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {rows.length > PAGE_SIZE && (
        <div className="qpager">
          <button
            type="button"
            className="qpage-btn"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={curPage === 0}
          >
            ‹ 이전
          </button>
          <span className="qpage-info">
            {curPage + 1} / {pageCount}
            <span className="qpage-range">
              {" "}· {(curPage * PAGE_SIZE + 1).toLocaleString()}–
              {Math.min(rows.length, curPage * PAGE_SIZE + PAGE_SIZE).toLocaleString()}
              {" / "}
              {rows.length.toLocaleString()}
            </span>
          </span>
          <button
            type="button"
            className="qpage-btn"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={curPage >= pageCount - 1}
          >
            다음 ›
          </button>
        </div>
      )}
    </div>
  );
}
