"use client";

import { useCallback, useEffect, useState } from "react";
import { CubeLatencyChart } from "@/components/CubeLatencyChart"; // Action end-to-end 응답 지연 (Tokens 탭 LLM 지연과 별개)
import { fmtDuration } from "@/components/TokenLatencyChart";
import { DimensionBreakdown } from "@/components/DimensionBreakdown";
import { ProfileStrip } from "@/components/ProfileStrip";
import { LayerBudget } from "@/components/LayerBudget";
import { StatsCards } from "@/components/StatsCards";
import { StatusDonut } from "@/components/StatusDonut";
import { TimeSeriesChart } from "@/components/TimeSeriesChart";
import { TopList } from "@/components/TopList";
import { StatsFilter, StatsResponse, TickMetricDef, TickStatsResponse } from "@/lib/types";
import { apiJson, asArray, errMessage } from "@/lib/apiClient";
import { TickMonitor } from "@/components/TickMonitor";
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

type Preset = "1h" | "6h" | "24h" | "7d" | "30d" | "custom";

const PRESETS: { key: Preset; label: string; hours: number }[] = [
  { key: "1h",  label: "1H",  hours: 1   },
  { key: "6h",  label: "6H",  hours: 6   },
  { key: "24h", label: "24H", hours: 24  },
  { key: "7d",  label: "7D",  hours: 168 },
  { key: "30d", label: "30D", hours: 720 },
];

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 틱 뷰의 게이지/차트 정의 (BIZ 진입 레이어 기준).
 * ⚠️ 한도(limit)는 0 이다 — 요청 수에는 사내 rate limit 같은 상한이 없다. 0 이면 기준선·초과
 *    판정 없이 추이만 그리고, 아래 목록은 "가장 몰린 순간" 이 된다.
 */
const BIZ_METRICS: [TickMetricDef, TickMetricDef] = [
  { name: "요청", unitText: "건/분", unit: "건", limit: 0 },
  { name: "실패", unitText: "건/분", unit: "건", limit: 0 },
];

function fmtRange(from: string | null, to: string | null): string {
  if (!from || !to) return "—";
  return `${from.replace("T", " ").slice(0, 16)}  →  ${to.replace("T", " ").slice(0, 16)}`;
}

export default function DashboardPage() {
  const [preset, setPreset] = useState<Preset>("30d");
  const [userId, setUserId] = useState("");
  const [actionTyp, setActionTyp] = useState("");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [excludeErrCds, setExcludeErrCds] = useState<string[]>([]);

  const [stats, setStats] = useState<StatsResponse | null>(null);

  /** 틱 뷰인가 (화면별로 기억) + 공유 조회 창 */
  const [tickView, setTickView, tickViewReady] = useTickView("dashboard");
  const { sel: tickSel, ready: tickReady, resolve: resolveTick, apply: applyTick } = useTick();
  const [tick, setTick] = useState<TickStatsResponse | null>(null);
  const [tickClamped, setTickClamped] = useState(false);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [actionTypeOptions, setActionTypeOptions] = useState<string[]>([]);
  const [errorCodeMap, setErrorCodeMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await apiJson<{ values: string[] }>("/api/action-types", { cache: "no-store" });
        if (alive) setActionTypeOptions(asArray<string>(data.values));
      } catch {
        /* ignore — falls back to empty options, user can still type via 직접입력 if added */
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await apiJson<{ codes: Record<string, string> }>("/api/error-codes", { cache: "no-store" });
        if (alive) setErrorCodeMap(data.codes ?? {});
      } catch {
        /* ignore — 매핑 없으면 툴팁은 코드만 노출 */
      }
    })();
    return () => { alive = false; };
  }, []);

  const computeFilter = useCallback((): StatsFilter => {
    const base: StatsFilter = {
      userId: userId || undefined,
      actionTyp: actionTyp || undefined,
      excludeErrCds: excludeErrCds.length > 0 ? excludeErrCds : undefined,
    };
    if (preset === "custom") {
      return {
        ...base,
        dateFrom: customFrom || undefined,
        dateTo: customTo || undefined,
      };
    }
    const p = PRESETS.find((x) => x.key === preset)!;
    const now = Date.now();
    return {
      ...base,
      dateFrom: toLocalInput(now - p.hours * 3_600_000) + ":00",
      dateTo:   toLocalInput(now) + ":00",
    };
  }, [preset, customFrom, customTo, userId, actionTyp, excludeErrCds]);

  const load = useCallback(async (f: StatsFilter) => {
    setLoading(true);
    setErr(null);
    try {
      const q = new URLSearchParams();
      if (f.dateFrom)  q.set("dateFrom",  f.dateFrom);
      if (f.dateTo)    q.set("dateTo",    f.dateTo);
      if (f.userId)    q.set("userId",    f.userId);
      if (f.actionTyp) q.set("actionTyp", f.actionTyp);
      if (f.excludeErrCds && f.excludeErrCds.length > 0) {
        q.set("excludeErrCds", f.excludeErrCds.join(","));
      }
      const data = await apiJson<StatsResponse>(`/api/stats?${q.toString()}`, { cache: "no-store" });
      setStats(data);
    } catch (e) {
      setErr(errMessage(e, "통계를 불러오지 못했습니다."));
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 틱(롤링 60초) 조회 — 진입 레이어 기준 분당 요청/실패.
   * ⚠️ ACTION_TYP 필터는 보내지 않는다 — 진입 레이어 행에는 그 값이 없다(권위 레이어는 GAIA).
   *    보내면 조건에 맞는 행이 0 이 되어 "요청이 없다" 로 오독된다.
   */
  const loadTick = useCallback(async (r: TickRange, u: string) => {
    setLoading(true);
    setErr(null);
    try {
      const q = new URLSearchParams({ dateFrom: r.from, dateTo: r.to });
      if (u) q.set("userId", u);
      const data = await apiJson<TickStatsResponse>(`/api/stats/tick?${q.toString()}`, { cache: "no-store" });
      setTick(data);
      // 요청한 시작 시각보다 응답의 시작이 뒤면 서버가 24시간으로 자른 것이다(1분 여유).
      const want = Date.parse(r.from);
      const got = data.range.from ? Date.parse(data.range.from) : NaN;
      setTickClamped(Number.isFinite(want) && Number.isFinite(got) && got - want > 60_000);
    } catch (e) {
      setErr(errMessage(e, "틱 조회를 불러오지 못했습니다."));
      setTick(null);
      setTickClamped(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // 최초 조회. 틱 뷰로 저장돼 있었으면 그쪽을 부른다 —
  // 복원(tickReady/tickViewReady) 전에 부르면 기본값으로 한 번, 복원값으로 한 번 이중 조회가 된다.
  useEffect(() => {
    if (!tickReady || !tickViewReady) return;
    if (tickView) loadTick(resolveTick(), userId);
    else load(computeFilter());
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [tickReady, tickViewReady]);

  // 자동 갱신 — 틱 뷰의 live 모드에서만. 주기는 창 길이에 맞춘다.
  useEffect(() => {
    if (!tickView || tickSel.mode !== "live" || !tickSel.auto) return;
    const id = setInterval(() => loadTick(resolveTickRange(tickSel), userId), tickRefreshMs(tickSel.win));
    return () => clearInterval(id);
  }, [tickView, tickSel, userId, loadTick]);

  /**
   * 보기 전환. 켜는 즉시 조회한다 — 토글을 눌렀는데 빈 화면이 남아 있으면 켜진 건지 알 수 없다.
   *
   * ⚠️ **조회 구간을 서로 물려준다** (rangeSync.ts) — 토글할 때마다 무관한 구간으로 튀면
   *    매번 기간을 다시 골라야 한다. 두 뷰의 후보가 겹치지 않아 정확히 같지는 않다.
   */
  const onView = (live: boolean) => {
    setTickView(live);
    if (live) {
      const cur = preset === "custom" && customFrom && customTo ? { from: customFrom, to: customTo } : null;
      const mins = cur
        ? spanMinutes(cur.from, cur.to) ?? 60
        : (PRESETS.find((p) => p.key === preset) ?? PRESETS[0]).hours * 60;
      applyTick(tickSelFor(mins, cur));
      loadTick(resolveTick(), userId);
      return;
    }
    if (tickSel.mode === "custom" && tickSel.from && tickSel.to) {
      setPreset("custom");
      setCustomFrom(tickSel.from);
      setCustomTo(tickSel.to);
      load({ ...computeFilter(), dateFrom: `${tickSel.from}:00`, dateTo: `${tickSel.to}:59` });
      return;
    }
    // 틱 창(≤180분)을 덮는 가장 짧은 집계 프리셋으로 옮긴다.
    const need = analysisMinutesForTickWin(tickSel.win);
    const p = PRESETS.find((x) => x.hours * 60 >= need) ?? PRESETS[0];
    setPreset(p.key);
    const now = Date.now();
    load({
      ...computeFilter(),
      dateFrom: toLocalInput(now - p.hours * 3_600_000) + ":00",
      dateTo: toLocalInput(now) + ":00",
    });
  };

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (tickView) loadTick(resolveTick(), userId);
    else load(computeFilter());
  };

  const onPresetClick = (k: Preset) => {
    setPreset(k);
    if (k !== "custom") {
      const p = PRESETS.find((x) => x.key === k)!;
      const now = Date.now();
      load({
        dateFrom: toLocalInput(now - p.hours * 3_600_000) + ":00",
        dateTo:   toLocalInput(now) + ":00",
        userId: userId || undefined,
        actionTyp: actionTyp || undefined,
        excludeErrCds: excludeErrCds.length > 0 ? excludeErrCds : undefined,
      });
    }
  };

  const onSelectAction = (k: string) => {
    const next = actionTyp === k ? "" : k;
    setActionTyp(next);
    load({ ...computeFilter(), actionTyp: next || undefined });
  };

  const hasFilter = !!(userId || actionTyp);
  const clearFilters = () => {
    setUserId("");
    setActionTyp("");
    load({ ...computeFilter(), userId: undefined, actionTyp: undefined });
  };

  // 에러 코드 제외: Top Errors 항목을 클릭해서 더하고, 칩의 × 로 해제한다.
  const addExclude = (code: string) => {
    if (excludeErrCds.includes(code)) return;
    const next = [...excludeErrCds, code];
    setExcludeErrCds(next);
    load({ ...computeFilter(), excludeErrCds: next });
  };
  const removeExclude = (code: string) => {
    const next = excludeErrCds.filter((c) => c !== code);
    setExcludeErrCds(next);
    load({ ...computeFilter(), excludeErrCds: next.length > 0 ? next : undefined });
  };
  const clearExcludes = () => {
    setExcludeErrCds([]);
    load({ ...computeFilter(), excludeErrCds: undefined });
  };

  return (
    <div className="dash">
      <ProfileStrip />
      <div className="dash-header stacked">
        {/* 1줄 — 제목 + 보기 전환(우상단 고정). ⚠️ 토글을 조회 줄로 되돌리지 말 것: 폭이 모자라면 그것만 위로 튀어 올라 줄이 깨진다. */}
        <div className="dash-head-row">
          <div className="dash-title">
            <div className="dash-title-main">Usage Dashboard</div>
            <div className="dash-title-sub">
              {tickView
                ? tick ? fmtRange(tick.range.from, tick.range.to) : "—"
                : stats ? fmtRange(stats.range.from, stats.range.to) : "—"}
              {tickView && <span className="dash-title-note"> · 틱 · 분당 요청/실패</span>}
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
          {/* 프리셋 줄 자리는 보기에 따라 통째로 교체된다.
              ⚠️ .preset-slot 이 두 세트 중 넓은 쪽 폭을 확보한다 — 없으면 토글할 때마다
                 뒤따르는 컨트롤이 좌우로 밀린다. */}
          <div className="preset-slot">
          {tickView ? (
            <TickPresets loading={loading} onSubmit={() => loadTick(resolveTick(), userId)} />
          ) : (
            <>
              <div className="preset-group" role="tablist" aria-label="time preset">
                {PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className={"preset-btn" + (preset === p.key ? " active" : "")}
                    onClick={() => onPresetClick(p.key)}
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={"preset-btn" + (preset === "custom" ? " active" : "")}
                  onClick={() => setPreset("custom")}
                >
                  Custom
                </button>
              </div>
              {preset === "custom" && (
                <div className="custom-range">
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
          {/* ⚠️ 틱 뷰에서는 감춘다 — 진입 레이어 행에 ACTION_TYP 이 없어 걸어도 효과가 없고,
              걸린 것처럼 보이면 "이 액션은 요청이 없다" 로 오독된다. */}
          {!tickView && (
            <select
              className="user-input user-select"
              value={actionTyp}
              onChange={(e) => {
                const v = e.target.value;
                setActionTyp(v);
                load({ ...computeFilter(), actionTyp: v || undefined });
              }}
              aria-label="ACTION_TYP"
            >
              <option value="">ACTION_TYP (전체)</option>
              {actionTypeOptions.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          )}
          {hasFilter && (
            <button type="button" className="btn ghost" onClick={clearFilters}>
              필터 초기화
            </button>
          )}
          {/* 동작 버튼은 두 보기가 **같은 자리**를 쓴다 (조회 ↔ 새로고침) */}
          {tickView
            ? <TickActions loading={loading} onSubmit={() => loadTick(resolveTick(), userId)} />
            : <button type="submit" className="btn primary">조회</button>}
        </form>
      </div>

      {loading && <div className="dash-banner loading">집계 중…</div>}
      {err && <div className="dash-banner err">불러오기 실패: {err}</div>}

      {tickView && tick && (
        <TickMonitor stats={tick} metrics={BIZ_METRICS} rowsLabel="요청" clamped={tickClamped} />
      )}

      {!tickView && stats && (
        <>
          {/* 1. Hero KPIs — 한눈에 보는 핵심 지표 */}
          <StatsCards stats={stats} />

          {/* 2. 일별/시간별 추이 — 임원이 가장 보고 싶어하는 차트, 메인으로 노출 */}
          <section className="dash-card dash-card-hero">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">사용 추이</span>
                <span className="dash-card-sub">상태별 적층 · {granText(stats.granularity)} 단위</span>
              </div>
              <div className="dash-card-aux">
                <span className="aux-pill">
                  <span className="aux-pill-key">총</span>
                  <span className="aux-pill-val">{stats.totals.total.toLocaleString()}</span>
                </span>
                <span className="aux-pill ok">
                  <span className="aux-pill-key">성공</span>
                  <span className="aux-pill-val">{stats.totals.ok.toLocaleString()}</span>
                </span>
                {stats.totals.fail > 0 && (
                  <span className="aux-pill err">
                    <span className="aux-pill-key">실패</span>
                    <span className="aux-pill-val">{stats.totals.fail.toLocaleString()}</span>
                  </span>
                )}
              </div>
            </div>
            <div className="dash-card-body">
              <TimeSeriesChart stats={stats} />
            </div>
          </section>

          {/* 평균 응답 속도 추이 — Action end-to-end 응답시간(CUBE send→resp, LLM 포함 전 구간).
              Tokens 탭의 LLM 호출 지연(1콜 단위, 전 노드)과는 재는 대상이 다른 정규 지표다. */}
          <section className="dash-card">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">평균 응답 속도</span>
                <span className="dash-card-sub">
                  Action 전체 응답시간 · CUBE 수신→응답(LLM 포함 전 구간) · {granText(stats.granularity)} 단위
                </span>
              </div>
              <div className="dash-card-aux">
                <span className="aux-pill">
                  <span className="aux-pill-key">전체 평균</span>
                  <span className="aux-pill-val">{fmtDuration(stats.cubeAvgLatencyMs ?? null)}</span>
                </span>
              </div>
            </div>
            <div className="dash-card-body">
              <CubeLatencyChart stats={stats} />
            </div>
          </section>

          {excludeErrCds.length > 0 && (
            <div className="exclude-bar" role="status" aria-live="polite">
              <span className="exclude-bar-label">
                <span className="exclude-bar-icon" aria-hidden>⊘</span>
                집계에서 제외
                {stats.excludedTraceCount > 0 && (
                  <span className="exclude-bar-count">
                    trace {stats.excludedTraceCount.toLocaleString()}건
                  </span>
                )}
              </span>
              <div className="exclude-chips">
                {excludeErrCds.map((code) => (
                  <button
                    key={code}
                    type="button"
                    className="exclude-chip"
                    onClick={() => removeExclude(code)}
                    title={`${code} — 클릭해서 다시 포함`}
                  >
                    <span className="exclude-chip-code">{code}</span>
                    <span className="exclude-chip-x" aria-hidden>×</span>
                  </button>
                ))}
              </div>
              <button type="button" className="btn ghost" onClick={clearExcludes}>
                모두 해제
              </button>
            </div>
          )}

          {/* 3. 상태 분포 + 상위 에러 — 의사결정에 바로 쓰이는 보조 정보 */}
          <div className="dash-row split">
            <section className="dash-card">
              <div className="dash-card-head">
                <span className="dash-card-title">상태 분포</span>
                <span className="dash-card-sub">trace 단위</span>
              </div>
              <div className="dash-card-body">
                <StatusDonut stats={stats} />
              </div>
            </section>

            <section className="dash-card">
              <div className="dash-card-head">
                <span className="dash-card-title">주요 에러</span>
                <span className="dash-card-sub">
                  ERR_CD 빈도 top {stats.topErrors.length || 0} · 클릭해서 집계에서 제외
                </span>
              </div>
              <div className="dash-card-body">
                <TopList
                  items={stats.topErrors}
                  totalForPct={stats.rowCount}
                  emptyText="에러 없음 ✓"
                  tone="err"
                  onItemClick={addExclude}
                  itemActionLabel="클릭해서 집계에서 제외"
                  descriptions={errorCodeMap}
                />
              </div>
            </section>
          </div>

          {/* 4. FAC / AREA 별 — MCP send 단계에서 확정되는 기준 분포 */}
          <div className="dash-row split">
            <section className="dash-card">
              <div className="dash-card-head">
                <span className="dash-card-title">FAC별</span>
                <span className="dash-card-sub">FAC_ID 별 분포 · MCP 기준 (미도달은 (none))</span>
              </div>
              <div className="dash-card-body">
                <DimensionBreakdown
                  items={stats.byFac}
                  emptyText="FAC 데이터 없음"
                />
              </div>
            </section>

            <section className="dash-card">
              <div className="dash-card-head">
                <span className="dash-card-title">AREA별</span>
                <span className="dash-card-sub">AREA_ID 별 분포 · MCP 기준 (미도달은 (none))</span>
              </div>
              <div className="dash-card-body">
                <DimensionBreakdown
                  items={stats.byArea}
                  emptyText="AREA 데이터 없음"
                />
              </div>
            </section>
          </div>

          {/* 5. 액션 타입별 / Top 사용자 — 보조 지표 (덜 중요, FAC/AREA 아래로) */}
          <div className="dash-row split">
            <section className="dash-card">
              <div className="dash-card-head">
                <span className="dash-card-title">액션 타입별</span>
                <span className="dash-card-sub">ACTION_TYP 별 분포{actionTyp ? ` · 필터: ${actionTyp}` : ""}</span>
              </div>
              <div className="dash-card-body">
                <DimensionBreakdown
                  items={stats.byAction}
                  emptyText="액션 데이터 없음"
                  onSelect={onSelectAction}
                  selected={actionTyp || undefined}
                />
              </div>
            </section>

            <section className="dash-card">
              <div className="dash-card-head">
                <span className="dash-card-title">Top 사용자</span>
                <span className="dash-card-sub">트레이스 수 기준</span>
              </div>
              <div className="dash-card-body">
                <TopList items={stats.topUsers} totalForPct={stats.totals.total} emptyText="데이터 없음" tone="neutral" />
              </div>
            </section>
          </div>

          {/* 6. 레이어 — 엔지니어용 디테일, 접근성 위해 유지하되 가장 아래 */}
          <section className="dash-card dash-card-muted">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">레이어별 소요 비중</span>
                <span className="dash-card-sub">
                  어느 레이어가 시간을 쓰고 어디서 실패가 시작되나 · 하위 대기를 뺀 자체 소요 기준
                </span>
              </div>
            </div>
            <div className="dash-card-body">
              <LayerBudget stats={stats} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function granText(g: StatsResponse["granularity"]): string {
  return g === "5m" ? "5분" : g === "1h" ? "시간" : "일";
}
