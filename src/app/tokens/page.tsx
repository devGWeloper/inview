"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TokenChart } from "@/components/charts/TokenChart";
import { TokenLatencyChart } from "@/components/charts/TokenLatencyChart";
import { fmtDuration } from "@/lib/format";
import { TokenBreakdown } from "@/features/tokens/TokenBreakdown";
import { TokenStatsCards } from "@/features/tokens/TokenStatsCards";
import { QuestionsTable } from "@/features/tokens/QuestionsTable";
import { TopList } from "@/components/ui/TopList";
import { ScopeNote } from "@/components/ui/ScopeNote";
import { TickMonitor } from "@/components/tick/TickMonitor";
import { TickMetricDef, TickStatsResponse, TokenFilter, TokenRow, TokenStatsResponse } from "@/lib/types";
import { apiJson, asArray, errMessage } from "@/lib/apiClient";
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
import { TickUnit, granOfTickUnit, granularityLabel } from "@/lib/timeBuckets";
import { TickSelect, useTickUnit } from "@/components/charts/TickSelect";
import { AutoRefreshToggle, refreshMs, useAutoRefresh } from "@/components/charts/AutoRefresh";


function tokenMetrics(tpmLimit: number, rpmLimit: number): [TickMetricDef, TickMetricDef] {
  return [
    { name: "TPM", unitText: "토큰/분", unit: "토큰", limit: tpmLimit },
    { name: "RPM", unitText: "호출/분", unit: "호출", limit: rpmLimit },
  ];
}

function fmtRange(from: string | null, to: string | null): string {
  if (!from || !to) return "—";
  return `${from.replace("T", " ").slice(0, 16)}  →  ${to.replace("T", " ").slice(0, 16)}`;
}

export default function TokensPage() {
  const { agentId, agent, isDefault, ready } = useAgentScope();
  const { sel, ready: rangeReady, setPreset, setCustom } = useTimeRange();
  const [userId, setUserId] = useState("");
  const [nodeNm, setNodeNm] = useState("");
  const [modelNm, setModelNm] = useState("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [draftCustom, setDraftCustom] = useState(false);

  const [stats, setStats] = useState<TokenStatsResponse | null>(null);
  const [tick, setTick] = useState<TickStatsResponse | null>(null);

  const spanMs = useMemo(() => spanOfSel(sel), [sel]);
  const { unit, options: unitOptions, ready: unitReady, setUnit, unitFor } = useTickUnit("tokens", spanMs);
  const [auto, setAuto] = useAutoRefresh("tokens");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nodeOptions, setNodeOptions] = useState<string[]>([]);
  const [modelOptions, setModelOptions] = useState<string[]>([]);

  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;

  const computeFilter = useCallback(
    (u: TickUnit, from: TimeRangeSel = sel): TokenFilter => {
      const range = resolveRange(from);
      return {
        userId: userId || undefined,
        nodeNm: nodeNm || undefined,
        modelNm: modelNm || undefined,
        dateFrom: range.from,
        dateTo: range.to,
        // 집계·1분은 g 를 안 보낸다 — 집계는 서버가 고르고, 1분은 틱 라우트가 그린다.
        gran: granOfTickUnit(u),
      };
    },
    [sel, userId, nodeNm, modelNm]
  );

  // 1분에서는 두 번 조회한다 — 집계(KPI·나머지 카드) + 틱(TPM/RPM).
  const load = useCallback(async (f: TokenFilter, r: TickUnit) => {
    const requestFor = agentId; // 이 요청이 향한 에이전트 (응답 도착 시점의 선택과 비교할 기준)
    setLoading(true);
    setErr(null);

    const q = new URLSearchParams();
    if (agentId) q.set("agent", agentId);
    if (f.dateFrom) q.set("dateFrom", f.dateFrom);
    if (f.dateTo) q.set("dateTo", f.dateTo);
    if (f.userId) q.set("userId", f.userId);
    if (f.nodeNm) q.set("nodeNm", f.nodeNm);
    if (f.modelNm) q.set("modelNm", f.modelNm);

    const tq = new URLSearchParams(q);
    tq.set("view", "usage");
    if (f.gran) q.set("g", f.gran);

    let tickErr: string | null = null;
    try {
      const [data, tickData] = await Promise.all([
        apiJson<TokenStatsResponse>(`/api/tokens?${q.toString()}`, { cache: "no-store" }),
        r === "1m"
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
      setNodeOptions((prev) => unionKeys(prev, asArray<{ key: string }>(data.byNode).map((d) => d.key)));
      setModelOptions((prev) => unionKeys(prev, asArray<{ key: string }>(data.byModel).map((d) => d.key)));
    } catch (e) {
      if (agentIdRef.current !== requestFor) return; // 이미 전환된 뒤의 실패는 화면에 반영하지 않는다
      setErr(errMessage(e, "토큰 통계를 불러오지 못했습니다."));
      setStats(null);
      setTick(null);
    } finally {
      if (agentIdRef.current === requestFor) setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (!ready || !rangeReady || !unitReady) return;
    setUserId("");
    setNodeNm("");
    setModelNm("");
    setNodeOptions([]);
    setModelOptions([]);
    setStats(null);
    setTick(null);
    load({ ...computeFilter(unit), userId: undefined, nodeNm: undefined, modelNm: undefined }, unit);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [ready, rangeReady, unitReady, agentId]);

  useEffect(() => {
    if (sel.preset === "custom" && sel.customFrom && sel.customTo) {
      setCustomFrom(sel.customFrom);
      setCustomTo(sel.customTo);
    }
  }, [sel.preset, sel.customFrom, sel.customTo]);

  useEffect(() => {
    if (!auto || sel.preset === "custom") return;
    const id = setInterval(() => load(computeFilter(unit), unit), refreshMs(unit));
    return () => clearInterval(id);
  }, [auto, sel.preset, unit, load, computeFilter]);

  const fetchCalls = useCallback(async (traceId: string): Promise<TokenRow[]> => {
    const query = new URLSearchParams({ traceId });
    if (agentId) query.set("agent", agentId);
    const data = await apiJson<TokenStatsResponse>(`/api/tokens?${query.toString()}`, { cache: "no-store" });
    return asArray<TokenRow>(data.calls);
  }, [agentId]);

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (draftCustom) {
      if (!customFrom || !customTo) {
        setErr("시작·끝 시각을 모두 입력하세요.");
        return;
      }
      const next: TimeRangeSel = { preset: "custom", customFrom, customTo };
      setCustom(customFrom, customTo);
      setDraftCustom(false);
      const r = unitFor(spanOfSel(next));
      load(computeFilter(r, next), r);
      return;
    }
    load(computeFilter(unit), unit);
  };

  // 기간을 바꾸면 고른 틱 단위가 무효가 될 수 있다 — 새 구간 기준으로 다시 고른다.
  const onPresetClick = (k: RangePreset) => {
    const next: TimeRangeSel = { ...sel, preset: k };
    setPreset(k);
    setDraftCustom(false);
    const r = unitFor(spanOfSel(next));
    load(computeFilter(r, next), r);
  };

  const onUnit = (r: TickUnit) => {
    setUnit(r);
    load(computeFilter(r), r);
  };

  const onCustomClick = () => {
    if (!customFrom || !customTo) {
      const r = resolveRange(sel);
      setCustomFrom(r.from.slice(0, 16));
      setCustomTo(r.to.slice(0, 16));
    }
    setDraftCustom(true);
  };

  const onSelectNode = (k: string) => {
    const next = nodeNm === k ? "" : k;
    setNodeNm(next);
    load({ ...computeFilter(unit), nodeNm: next || undefined }, unit);
  };

  const onSelectModel = (k: string) => {
    const next = modelNm === k ? "" : k;
    setModelNm(next);
    load({ ...computeFilter(unit), modelNm: next || undefined }, unit);
  };

  const reloadWith = (over: { userId?: string; nodeNm?: string; modelNm?: string }) => {
    load({ ...computeFilter(unit), ...over }, unit);
  };

  const customOpen = draftCustom || sel.preset === "custom";
  const hasFilter = !!(userId || nodeNm || modelNm);
  const clearFilters = () => {
    setUserId("");
    setNodeNm("");
    setModelNm("");
    reloadWith({ userId: undefined, nodeNm: undefined, modelNm: undefined });
  };

  return (
    <div className="dash">
      <div className="dash-header stacked">
        <div className="dash-head-row">
          <div className="dash-title">
            <div className="dash-title-main">Token Usage</div>
            <div className="dash-title-sub">
              {stats ? fmtRange(stats.range.from, stats.range.to) : "—"}
              <span className="dash-title-note">
                {" · LLM 호출 기준"}
                {!isDefault && agent ? ` · ${agent.name}` : ""}
              </span>
            </div>
          </div>
        </div>

        <form className="dash-filter" onSubmit={onApply}>
          {/* 기간만 고르는 줄이다. 틱 단위는 차트 바로 위에 있고, 이 줄은 그것에 따라 바뀌지 않는다. */}
          <div className="preset-group" role="tablist" aria-label="time preset">
                {RANGE_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className={"preset-btn" + (!customOpen && sel.preset === p.key ? " active" : "")}
                    onClick={() => onPresetClick(p.key)}
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={"preset-btn" + (customOpen ? " active" : "")}
                  onClick={onCustomClick}
                >
                  {CUSTOM_LABEL}
                </button>
              </div>
          {customOpen && (
            <div className="custom-range">
              <input type="datetime-local" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} aria-label="from" />
              <span className="range-arrow">→</span>
              <input type="datetime-local" value={customTo} onChange={(e) => setCustomTo(e.target.value)} aria-label="to" />
            </div>
          )}
          <input
            type="text"
            className="user-input"
            placeholder="USER_ID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
          <select
            className="user-input user-select"
            value={nodeNm}
            onChange={(e) => { const v = e.target.value; setNodeNm(v); reloadWith({ nodeNm: v || undefined }); }}
            aria-label="NODE"
          >
            <option value="">NODE (전체)</option>
            {nodeOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
          <select
            className="user-input user-select"
            value={modelNm}
            onChange={(e) => { const v = e.target.value; setModelNm(v); reloadWith({ modelNm: v || undefined }); }}
            aria-label="MODEL"
          >
            <option value="">MODEL (전체)</option>
            {modelOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
          {hasFilter && (
            <button type="button" className="btn ghost" onClick={clearFilters}>필터 초기화</button>
          )}
          <AutoRefreshToggle on={auto} onChange={setAuto} disabled={customOpen} />
          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? "조회 중…" : "조회"}
          </button>
        </form>
      </div>

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

      {stats && (
        <>
          <ScopeNote>
            <b>타임아웃·실패 호출</b>은 호출 수에만 잡힙니다 — 토큰은 0, 속도 평균에서는 빠집니다.
          </ScopeNote>

          <TokenStatsCards stats={stats} />

          {/* 틱 단위 — 차트 바로 위 자기 줄. ⚠️ 차트 카드 머리 안으로 넣지 말 것:
              1분 조회가 실패하면 그 카드가 통째로 사라져 되돌릴 컨트롤이 없어진다. */}
          <div className="tick-bar">
            <TickSelect
              value={unit}
              options={unitOptions}
              onChange={onUnit}
              pulsing={auto && !customOpen}
            />
          </div>

          {unit === "1m" ? (
            tick && (
              <TickMonitor
                stats={tick}
                metrics={tokenMetrics(agent?.tpmLimit ?? 0, agent?.rpmLimit ?? 0)}
                rowsLabel="호출"
                limitHref="/admin"
              />
            )
          ) : (
          <section className="dash-card dash-card-hero">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">토큰 사용 추이</span>
                <span className="dash-card-sub">input / output 적층 · {granularityLabel(stats.granularity)} 단위</span>
              </div>
              <div className="dash-card-aux">
                <span className="aux-pill">
                  <span className="aux-pill-key">총 토큰</span>
                  <span className="aux-pill-val">{stats.totals.totalTokens.toLocaleString()}</span>
                </span>
                <span className="aux-pill">
                  <span className="aux-pill-key">호출</span>
                  <span className="aux-pill-val">{stats.totals.calls.toLocaleString()}</span>
                </span>
              </div>
            </div>
            <div className="dash-card-body">
              <TokenChart stats={stats} />
            </div>
          </section>
          )}

          <section className="dash-card dash-card-hero">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">LLM 속도 추이</span>
                <span className="dash-card-sub">호출당 평균 소요시간 · {granularityLabel(stats.granularity)} 단위 · 어느 시점이 느렸는지</span>
              </div>
              <div className="dash-card-aux">
                <span className="aux-pill">
                  <span className="aux-pill-key">평균 속도</span>
                  <span className="aux-pill-val">{fmtDuration(stats.avgLatencyMs)}</span>
                </span>
              </div>
            </div>
            <div className="dash-card-body">
              <TokenLatencyChart stats={stats} />
            </div>
          </section>

          <TokenBreakdown
            stats={stats}
            emptyText="데이터 없음"
            onSelectNode={onSelectNode}
            onSelectModel={onSelectModel}
            selectedNode={nodeNm || undefined}
            selectedModel={modelNm || undefined}
          />

          <section className="dash-card">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">질문별 토큰</span>
              </div>
            </div>
            <div className="dash-card-body">
              <QuestionsTable questions={stats.questions} onExpand={fetchCalls} />
            </div>
          </section>

          <section className="dash-card">
            <div className="dash-card-head">
              <span className="dash-card-title">Top 사용자</span>
              <span className="dash-card-sub">총 토큰 기준</span>
            </div>
            <div className="dash-card-body">
              <TopList items={stats.topUsers} totalForPct={stats.totals.totalTokens} emptyText="데이터 없음" tone="neutral" />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function unionKeys(prev: string[], next: string[]): string[] {
  const set = new Set(prev);
  for (const k of next) if (k && k !== "(none)") set.add(k);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

