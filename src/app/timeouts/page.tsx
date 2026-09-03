"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtDuration } from "@/lib/format";
import { TimeoutTrendChart } from "@/components/charts/TimeoutTrendChart";
import { TimeoutModelHeatmap } from "@/features/timeouts/TimeoutModelHeatmap";
import { TickMetricDef, TickStatsResponse, TimeoutDimStat, TimeoutItem, TimeoutReason, TimeoutStatsResponse } from "@/lib/types";
import { TickMonitor } from "@/components/tick/TickMonitor";
import { callStatus } from "@/lib/tokenStatus";
import { apiJson, errMessage } from "@/lib/apiClient";
import { useAgentScope } from "@/components/agents/AgentScopeProvider";
import {
  CUSTOM_LABEL,
  RANGE_PRESETS,
  RangePreset,
  TimeRangeSel,
  resolveRange,
  spanOfSel,
  useTimeRange,
} from "@/components/ui/TimeRangeProvider";

import { ViewToggle, useTickView } from "@/components/tick/ViewToggle";
import { AutoRefreshToggle, refreshMs, useAutoRefresh } from "@/components/charts/AutoRefresh";
import { DimCard } from "@/features/timeouts/DimCard";
import { ReasonList } from "@/features/timeouts/ReasonList";
import { FailedCallsTable } from "@/features/timeouts/FailedCallsTable";


interface Range { from: string; to: string }

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
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [draftCustom, setDraftCustom] = useState(false);
  const [node, setNode] = useState("");
  const [model, setModel] = useState("");
  const [stats, setStats] = useState<TimeoutStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [tick, setTick] = useState<TickStatsResponse | null>(null);

  const spanMs = useMemo(() => spanOfSel(sel), [sel]);
  const { on: tickOn, canTick, ready: unitReady, setOn: setTickOn, onFor: tickOnFor } = useTickView("timeouts", spanMs);
  const [auto, setAuto] = useAutoRefresh("timeouts");

  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;

  // 1분에서는 두 번 조회한다 — 집계(KPI·나머지 카드) + 틱(분당 타임아웃/실패).
  const load = useCallback(
    async (r: Range, nodeNm: string, modelNm: string, tickOn: boolean) => {
      const requestFor = agentId; // 이 요청이 향한 에이전트
      setLoading(true);
      setErr(null);

      const q = new URLSearchParams({ dateFrom: r.from, dateTo: r.to });
      if (agentId) q.set("agent", agentId);
      if (nodeNm) q.set("nodeNm", nodeNm);
      if (modelNm) q.set("modelNm", modelNm);

      const tq = new URLSearchParams(q);
      tq.set("view", "failure");

      let tickErr: string | null = null;
      try {
        const [data, tickData] = await Promise.all([
          apiJson<TimeoutStatsResponse>(`/api/timeouts?${q.toString()}`, { cache: "no-store" }),
          tickOn
            ? apiJson<TickStatsResponse>(`/api/tokens/tick?${tq.toString()}`, { cache: "no-store" })
                .catch((e) => {
                  tickErr = errMessage(e, "틱 조회를 불러오지 못했습니다.");
                  return null;
                })
            : Promise.resolve(null),
        ]);
        const echoed = data.agentId ?? requestFor;
        if (agentIdRef.current && echoed !== agentIdRef.current) return;
        setStats(data);
        setTick(tickData);
        setErr(tickErr);
      } catch (e) {
        if (agentIdRef.current !== requestFor) return;
        setErr(errMessage(e, "타임아웃 집계를 불러오지 못했습니다."));
        setStats(null);
        setTick(null);
      } finally {
        if (agentIdRef.current === requestFor) setLoading(false);
      }
    },
    [agentId]
  );

  const currentRange = useCallback((): Range => resolveRange(sel), [sel]);

  useEffect(() => {
    if (!ready || !rangeReady || !unitReady) return;
    setNode("");
    setModel("");
    setStats(null);
    setTick(null);
    load(resolveRange(sel), "", "", tickOn);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [ready, rangeReady, unitReady, agentId]);

  useEffect(() => {
    if (!auto || sel.preset === "custom") return;
    const id = setInterval(() => load(resolveRange(sel), node, model, tickOn), refreshMs(tickOn));
    return () => clearInterval(id);
  }, [auto, sel, node, model, tickOn, load]);

  useEffect(() => {
    if (sel.preset === "custom" && sel.customFrom && sel.customTo) {
      setCustomFrom(sel.customFrom);
      setCustomTo(sel.customTo);
    }
  }, [sel.preset, sel.customFrom, sel.customTo]);

  // 기간을 바꾸면 고른 틱 단위가 무효가 될 수 있다 — 새 구간 기준으로 다시 고른다.
  const onPreset = (p: RangePreset) => {
    const next: TimeRangeSel = { ...sel, preset: p };
    setPreset(p);
    setDraftCustom(false);
    const r = tickOnFor(spanOfSel(next));
    load(resolveRange(next), node, model, r);
  };
  const onTick = (v: boolean) => {
    setTickOn(v);
    load(currentRange(), node, model, v);
  };
  const enterCustom = () => {
    if (!customFrom || !customTo) {
      const r = currentRange();
      setCustomFrom(r.from.slice(0, 16));
      setCustomTo(r.to.slice(0, 16));
    }
    setDraftCustom(true);
  };
  const applyCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customFrom || !customTo) return;
    const next: TimeRangeSel = { preset: "custom", customFrom, customTo };
    setCustom(customFrom, customTo);
    setDraftCustom(false);
    load(resolveRange(next), node, model, tickOnFor(spanOfSel(next)));
  };
  const reload = (nodeNm: string, modelNm: string) => load(currentRange(), nodeNm, modelNm, tickOn);
  const onNode = (k: string) => { const next = node === k ? "" : k; setNode(next); reload(next, model); };
  const onModel = (k: string) => { const next = model === k ? "" : k; setModel(next); reload(node, next); };

  const customOpen = draftCustom || sel.preset === "custom";
  const scope = [node && `노드 ${node}`, model && `모델 ${model}`].filter(Boolean).join(" · ");
  const topNode = stats?.byNode[0];

  const tickCtl = (
    <ViewToggle on={tickOn} canTick={canTick} onChange={onTick} pulsing={auto && !customOpen} />
  );

  return (
    <div className="dash">
      <div className="dash-header stacked">
        <div className="dash-head-row">
          <div className="dash-title">
            <div className="dash-title-main">Timeout</div>
            <div className="dash-title-sub">
              {stats
                ? fmtRange(stats.range.from, stats.range.to)
                : fmtRange(currentRange().from, currentRange().to)}
              <span className="dash-title-note">
                {" · LLM 호출 실패 적재 기준"}
                {!isDefault && agent ? ` · ${agent.name}` : ""}
              </span>
            </div>
          </div>
        </div>

        <div className="dash-filter">
          {/* 기간만 고르는 줄이다. 틱 단위는 차트 바로 위에 있고, 이 줄은 그것에 따라 바뀌지 않는다. */}
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
          <AutoRefreshToggle on={auto} onChange={setAuto} disabled={customOpen} />
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
          {/* agents: 섹션이 없으면 config.ts 가 layers.GAIA 로 기본 에이전트를 합성하므로
                  두 경우를 모두 가리키는 문구로 안내한다. */}
          {agent.name} 의 DB 접속 정보가 설정되지 않았습니다 — config.yml 에서 agents 섹션이 있다면
          해당 에이전트의 db 항목을, 없다면 layers.GAIA 를 확인하세요.
          (빈 화면은 &ldquo;사용량 0&rdquo; 이 아닙니다)
        </div>
      )}

      {stats && !stats.available && (
        <div className="dash-banner">
          아직 실패 호출이 적재되지 않았습니다 · GAIA 가 <code>TRX_TOKEN_DET.STAT_CD</code> /{" "}
          <code>ERR_CTN</code> 을 적재하면 이 화면이 채워집니다.
        </div>
      )}

      {stats && stats.available && (
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

          {/* 보기 토글(ViewToggle)은 이 카드 머리 안에 있고, 틱 보기도 **같은 자리**를 쓴다.
              ⚠️ 틱 조회가 비어도 카드 껍데기는 그려야 한다 — 안 그리면 되돌릴 컨트롤이 사라진다. */}
          {tickOn ? (
            tick ? (
              <TickMonitor stats={tick} metrics={TIMEOUT_METRICS} title="발생 추이" rowsLabel="호출" headSlot={tickCtl} />
            ) : (
              <section className="dash-card dash-card-hero">
                <div className="dash-card-head">
                  <div className="dash-card-title-group">
                    <span className="dash-card-title">발생 추이</span>
                  </div>
                  <div className="dash-card-aux">{tickCtl}</div>
                </div>
                <div className="dash-card-body"><div className="tick-empty">—</div></div>
              </section>
            )
          ) : (
          <section className="dash-card dash-card-hero">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">발생 추이</span>
                <span className="dash-card-sub">호출 시각 기준{scope && ` · ${scope}`}</span>
              </div>
              <div className="dash-card-aux">{tickCtl}</div>
            </div>
            <div className="dash-card-body">
              {stats.failedCalls === 0 ? (
                <div className="top-empty">이 기간에 실패한 LLM 호출이 없습니다</div>
              ) : (
                <TimeoutTrendChart stats={stats} />
              )}
            </div>
          </section>
          )}

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



