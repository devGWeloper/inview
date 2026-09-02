"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TokenChart } from "@/components/charts/TokenChart";
import { TokenLatencyChart } from "@/components/charts/TokenLatencyChart";
import { fmtDuration } from "@/lib/format";
import { TokenBreakdown } from "@/features/tokens/TokenBreakdown";
import { TokenStatsCards } from "@/features/tokens/TokenStatsCards";
import { QuestionsTable } from "@/features/tokens/QuestionsTable";
import { TopList } from "@/components/ui/TopList";
import { TickMonitor } from "@/components/tick/TickMonitor";
import { TickMetricDef, TickStatsResponse, TokenFilter, TokenRow, TokenStatsResponse } from "@/lib/types";
import { apiJson, asArray, errMessage } from "@/lib/apiClient";
import { useAgentScope } from "@/components/agents/AgentScopeProvider";
import {
  CUSTOM_LABEL,
  RANGE_PRESETS,
  RangePreset,
  resolveRange,
  useTimeRange,
} from "@/components/ui/TimeRangeProvider";
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
  const [tickView, setTickView, tickViewReady] = useTickView("tokens");
  const { sel: tickSel, ready: tickReady, resolve: resolveTick, apply: applyTick } = useTick();

  const [stats, setStats] = useState<TokenStatsResponse | null>(null);
  const [tickClamped, setTickClamped] = useState(false);
  const [tick, setTick] = useState<TickStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nodeOptions, setNodeOptions] = useState<string[]>([]);
  const [modelOptions, setModelOptions] = useState<string[]>([]);

  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;

  const computeFilter = useCallback((): TokenFilter => {
    const r = resolveRange(sel);
    return {
      userId: userId || undefined,
      nodeNm: nodeNm || undefined,
      modelNm: modelNm || undefined,
      dateFrom: r.from,
      dateTo: r.to,
    };
  }, [sel, userId, nodeNm, modelNm]);

  const load = useCallback(async (f: TokenFilter) => {
    const requestFor = agentId; // 이 요청이 향한 에이전트 (응답 도착 시점의 선택과 비교할 기준)
    setLoading(true);
    setErr(null);
    try {
      const q = new URLSearchParams();
      if (agentId) q.set("agent", agentId);
      if (f.dateFrom) q.set("dateFrom", f.dateFrom);
      if (f.dateTo) q.set("dateTo", f.dateTo);
      if (f.userId) q.set("userId", f.userId);
      if (f.nodeNm) q.set("nodeNm", f.nodeNm);
      if (f.modelNm) q.set("modelNm", f.modelNm);
      const data = await apiJson<TokenStatsResponse>(`/api/tokens?${q.toString()}`, { cache: "no-store" });
      const echoed = data.agentId ?? requestFor;
      if (agentIdRef.current && echoed !== agentIdRef.current) return;
      setStats(data);
      setNodeOptions((prev) => unionKeys(prev, asArray<{ key: string }>(data.byNode).map((d) => d.key)));
      setModelOptions((prev) => unionKeys(prev, asArray<{ key: string }>(data.byModel).map((d) => d.key)));
    } catch (e) {
      if (agentIdRef.current !== requestFor) return; // 이미 전환된 뒤의 실패는 화면에 반영하지 않는다
      setErr(errMessage(e, "토큰 통계를 불러오지 못했습니다."));
      setStats(null);
    } finally {
      if (agentIdRef.current === requestFor) setLoading(false);
    }
  }, [agentId]);

  const loadTick = useCallback(
    async (range: TickRange, over?: { userId?: string; nodeNm?: string; modelNm?: string }) => {
      const requestFor = agentId;
      setLoading(true);
      setErr(null);
      try {
        const dateFrom = range.from;
        const dateTo = range.to;
        const q = new URLSearchParams({ dateFrom, dateTo });
        if (agentId) q.set("agent", agentId);
        const u = over && "userId" in over ? over.userId : userId;
        const n = over && "nodeNm" in over ? over.nodeNm : nodeNm;
        const m = over && "modelNm" in over ? over.modelNm : modelNm;
        if (u) q.set("userId", u);
        if (n) q.set("nodeNm", n);
        if (m) q.set("modelNm", m);
        const data = await apiJson<TickStatsResponse>(`/api/tokens/tick?${q.toString()}`, { cache: "no-store" });
        const echoed = data.agentId ?? requestFor;
        if (agentIdRef.current && echoed !== agentIdRef.current) return;
        setTick(data);
        const want = Date.parse(dateFrom);
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
    },
    [userId, nodeNm, modelNm, agentId]
  );

  const submitTick = useCallback(
    (over?: { userId?: string; nodeNm?: string; modelNm?: string }) => {
      loadTick(resolveTick(), over);
    },
    [loadTick, resolveTick]
  );

  useEffect(() => {
    if (!ready || !rangeReady || !tickReady || !tickViewReady) return;
    setUserId("");
    setNodeNm("");
    setModelNm("");
    setNodeOptions([]);
    setModelOptions([]);
    setStats(null);
    setTick(null);
    if (tickView) {
      submitTick({ userId: undefined, nodeNm: undefined, modelNm: undefined });
    } else {
      load({ ...computeFilter(), userId: undefined, nodeNm: undefined, modelNm: undefined });
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [ready, rangeReady, tickReady, tickViewReady, agentId]);

  useEffect(() => {
    if (sel.preset === "custom" && sel.customFrom && sel.customTo) {
      setCustomFrom(sel.customFrom);
      setCustomTo(sel.customTo);
    }
  }, [sel.preset, sel.customFrom, sel.customTo]);

  useEffect(() => {
    if (!tickView || tickSel.mode !== "live" || !tickSel.auto) return;
    const id = setInterval(() => loadTick(resolveTickRange(tickSel)), tickRefreshMs(tickSel.win));
    return () => clearInterval(id);
  }, [tickView, tickSel, loadTick]);

  const fetchCalls = useCallback(async (traceId: string): Promise<TokenRow[]> => {
    const query = new URLSearchParams({ traceId });
    if (agentId) query.set("agent", agentId);
    const data = await apiJson<TokenStatsResponse>(`/api/tokens?${query.toString()}`, { cache: "no-store" });
    return asArray<TokenRow>(data.calls);
  }, [agentId]);

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (tickView) {
      submitTick();
      return;
    }

    if (draftCustom) {
      if (!customFrom || !customTo) {
        setErr("시작·끝 시각을 모두 입력하세요.");
        return;
      }
      setCustom(customFrom, customTo);
      setDraftCustom(false);
      const r = resolveRange({ preset: "custom", customFrom, customTo });
      load({
        dateFrom: r.from,
        dateTo: r.to,
        userId: userId || undefined,
        nodeNm: nodeNm || undefined,
        modelNm: modelNm || undefined,
      });
      return;
    }
    load(computeFilter());
  };

  const onPresetClick = (k: RangePreset) => {
    const r = resolveRange({ ...sel, preset: k });
    setPreset(k);
    setDraftCustom(false);
    setTickView(false);
    load({
      dateFrom: r.from,
      dateTo: r.to,
      userId: userId || undefined,
      nodeNm: nodeNm || undefined,
      modelNm: modelNm || undefined,
    });
  };

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
      submitTick();
    } else {
      if (tickSel.mode === "custom" && tickSel.from && tickSel.to) {
        setCustom(tickSel.from, tickSel.to);
        const r = resolveRange({ preset: "custom", customFrom: tickSel.from, customTo: tickSel.to });
        load({
          dateFrom: r.from, dateTo: r.to,
          userId: userId || undefined, nodeNm: nodeNm || undefined, modelNm: modelNm || undefined,
        });
        return;
      }
      const need = analysisMinutesForTickWin(tickSel.win);
      const p = RANGE_PRESETS.find((x) => x.hours * 60 >= need) ?? RANGE_PRESETS[0];
      setPreset(p.key);
      const r = resolveRange({ ...sel, preset: p.key });
      load({
        dateFrom: r.from, dateTo: r.to,
        userId: userId || undefined, nodeNm: nodeNm || undefined, modelNm: modelNm || undefined,
      });
    }
  };

  const onCustomClick = () => {
    setTickView(false);
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
    load({ ...computeFilter(), nodeNm: next || undefined });
  };

  const onSelectModel = (k: string) => {
    const next = modelNm === k ? "" : k;
    setModelNm(next);
    load({ ...computeFilter(), modelNm: next || undefined });
  };

  const reloadWith = (over: { userId?: string; nodeNm?: string; modelNm?: string }) => {
    if (tickView) submitTick(over);
    else load({ ...computeFilter(), ...over });
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
        {/* 1줄 — 제목 + 보기 전환(우상단 고정). ⚠️ 토글을 조회 줄로 되돌리지 말 것: 폭이 모자라면 그것만 위로 튀어 올라 줄이 깨진다. */}
        <div className="dash-head-row">
          <div className="dash-title">
            <div className="dash-title-main">Token Usage</div>
            <div className="dash-title-sub">
              {tickView
                ? tick ? fmtRange(tick.range.from, tick.range.to) : "—"
                : stats ? fmtRange(stats.range.from, stats.range.to) : "—"}
              <span className="dash-title-note">
                {tickView ? " · TPM/RPM" : " · LLM 호출 기준"}
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

        <form className="dash-filter" onSubmit={onApply}>
          {/* 보기에 따라 통째로 교체되는 자리. .preset-slot 이 넓은 쪽 폭을 미리 확보해
                  토글할 때 뒤따르는 컨트롤이 밀리지 않게 한다. */}
          <div className="preset-slot">
          {tickView ? (
            <TickPresets loading={loading} onSubmit={() => submitTick()} />
          ) : (
            <>
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
            </>
          )}
          </div>
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
          {/* 동작 버튼은 두 보기가 **같은 자리**를 쓴다 (조회 ↔ 새로고침) */}
          {tickView
            ? <TickActions loading={loading} onSubmit={() => submitTick()} />
            : <button type="submit" className="btn primary">조회</button>}
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

      {tickView && tick && (
        <TickMonitor
          stats={tick}
          metrics={tokenMetrics(agent?.tpmLimit ?? 0, agent?.rpmLimit ?? 0)}
          rowsLabel="호출"
          clamped={tickClamped}
          limitHref="/admin"
        />
      )}

      {!tickView && stats && (
        <>
          <TokenStatsCards stats={stats} />

          <section className="dash-card dash-card-hero">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">토큰 사용 추이</span>
                <span className="dash-card-sub">input / output 적층 · {granText(stats.granularity)} 단위</span>
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

          <section className="dash-card dash-card-hero">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">LLM 속도 추이</span>
                <span className="dash-card-sub">호출당 평균 소요시간 · {granText(stats.granularity)} 단위 · 어느 시점이 느렸는지</span>
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

function granText(g: TokenStatsResponse["granularity"]): string {
  return g === "5m" ? "5분" : g === "1h" ? "시간" : "일";
}
