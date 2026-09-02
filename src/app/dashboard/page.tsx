"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CubeLatencyChart } from "@/features/dashboard/CubeLatencyChart"; // Action end-to-end 응답 지연 (Tokens 탭 LLM 지연과 별개)
import { fmtDuration } from "@/lib/format";
import { DimensionBreakdown } from "@/features/dashboard/DimensionBreakdown";
import { LayerBudget } from "@/features/dashboard/LayerBudget";
import { StatsCards } from "@/features/dashboard/StatsCards";
import { StatusDonut } from "@/features/dashboard/StatusDonut";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { TopList } from "@/components/ui/TopList";
import { ScopeNote } from "@/components/ui/ScopeNote";
import { StatsFilter, StatsResponse, TickMetricDef, TickStatsResponse } from "@/lib/types";
import { apiJson, asArray, errMessage } from "@/lib/apiClient";
import { TickMonitor } from "@/components/tick/TickMonitor";
import { TickUnit, granOfTickUnit, granularityLabel, isoNoTz } from "@/lib/timeBuckets";
import { TickSelect, useTickUnit } from "@/components/charts/TickSelect";
import { AutoRefreshToggle, refreshMs, useAutoRefresh } from "@/components/charts/AutoRefresh";

type Preset = "1h" | "6h" | "24h" | "7d" | "30d" | "custom";

const PRESETS: { key: Preset; label: string; hours: number }[] = [
  { key: "1h",  label: "1H",  hours: 1   },
  { key: "6h",  label: "6H",  hours: 6   },
  { key: "24h", label: "24H", hours: 24  },
  { key: "7d",  label: "7D",  hours: 168 },
  { key: "30d", label: "30D", hours: 720 },
];

const BIZ_METRICS: [TickMetricDef, TickMetricDef] = [
  { name: "요청", unitText: "건/분", unit: "건", limit: 0 },
  { name: "실패", unitText: "건/분", unit: "건", limit: 0 },
];

function fmtRange(from: string | null, to: string | null): string {
  if (!from || !to) return "—";
  return `${from.replace("T", " ").slice(0, 16)}  →  ${to.replace("T", " ").slice(0, 16)}`;
}

function spanOf(p: Preset, from: string, to: string): number {
  if (p === "custom") {
    const a = Date.parse(from);
    const b = Date.parse(to);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) return b - a;
    return 24 * 3_600_000;
  }
  return (PRESETS.find((x) => x.key === p) ?? PRESETS[0]).hours * 3_600_000;
}

// 프리셋 구간은 초 정밀이다 — 분 정밀 + ":00" 을 쓰면 현재 분이 통째로 잘려
// 1분 틱에서 방금 난 버스트가 안 잡힌다.
function rangeOf(p: Preset, from: string, to: string): { from: string; to: string } {
  if (p === "custom") return { from: from ? `${from}:00` : "", to: to ? `${to}:59` : "" };
  const hours = (PRESETS.find((x) => x.key === p) ?? PRESETS[0]).hours;
  const now = Date.now();
  return { from: isoNoTz(now - hours * 3_600_000), to: isoNoTz(now) };
}

export default function DashboardPage() {
  const [preset, setPreset] = useState<Preset>("30d");
  const [userId, setUserId] = useState("");
  const [actionTyp, setActionTyp] = useState("");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [excludeErrCds, setExcludeErrCds] = useState<string[]>([]);

  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [tick, setTick] = useState<TickStatsResponse | null>(null);

  const spanMs = useMemo(() => spanOf(preset, customFrom, customTo), [preset, customFrom, customTo]);
  const { unit, enabled: unitEnabled, ready: unitReady, setUnit, unitFor } = useTickUnit("dashboard", spanMs);
  const [auto, setAuto] = useAutoRefresh("dashboard");

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
      }
    })();
    return () => { alive = false; };
  }, []);

  const filterFor = useCallback(
    (p: Preset, u: TickUnit, over: Partial<StatsFilter> = {}): StatsFilter => {
      const range = rangeOf(p, customFrom, customTo);
      return {
        userId: userId || undefined,
        actionTyp: actionTyp || undefined,
        excludeErrCds: excludeErrCds.length > 0 ? excludeErrCds : undefined,
        dateFrom: range.from || undefined,
        dateTo: range.to || undefined,
        // 집계·1분은 g 를 안 보낸다 — 집계는 서버가 고르고, 1분은 틱 라우트가 그린다.
        gran: granOfTickUnit(u),
        ...over,
      };
    },
    [customFrom, customTo, userId, actionTyp, excludeErrCds]
  );

  // 1분에서는 두 번 조회한다 — 집계(KPI·나머지 카드) + 틱(추이·게이지·순간목록).
  // 화면을 통째로 갈아끼우지 않는 대가이고, 1분은 24시간 이하에서만 고를 수 있어 감당된다.
  const load = useCallback(async (f: StatsFilter, u: TickUnit) => {
    setLoading(true);
    setErr(null);

    const q = new URLSearchParams();
    if (f.dateFrom)  q.set("dateFrom",  f.dateFrom);
    if (f.dateTo)    q.set("dateTo",    f.dateTo);
    if (f.userId)    q.set("userId",    f.userId);
    if (f.actionTyp) q.set("actionTyp", f.actionTyp);
    if (f.excludeErrCds && f.excludeErrCds.length > 0) {
      q.set("excludeErrCds", f.excludeErrCds.join(","));
    }
    if (f.gran) q.set("g", f.gran);

    const tq = new URLSearchParams();
    if (f.dateFrom) tq.set("dateFrom", f.dateFrom);
    if (f.dateTo)   tq.set("dateTo",   f.dateTo);
    if (f.userId)   tq.set("userId",   f.userId);

    let tickErr: string | null = null;
    try {
      const [nextStats, nextTick] = await Promise.all([
        apiJson<StatsResponse>(`/api/stats?${q.toString()}`, { cache: "no-store" }),
        u === "1m"
          ? apiJson<TickStatsResponse>(`/api/stats/tick?${tq.toString()}`, { cache: "no-store" })
              .catch((e) => {
                tickErr = errMessage(e, "틱 조회를 불러오지 못했습니다.");
                return null;
              })
          : Promise.resolve(null),
      ]);
      setStats(nextStats);
      setTick(nextTick);
      setErr(tickErr);
    } catch (e) {
      setErr(errMessage(e, "통계를 불러오지 못했습니다."));
      setStats(null);
      setTick(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const run = useCallback(
    (p: Preset, u: TickUnit, over: Partial<StatsFilter> = {}) => load(filterFor(p, u, over), u),
    [load, filterFor]
  );

  useEffect(() => {
    if (!unitReady) return;
    run(preset, unit);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [unitReady]);

  useEffect(() => {
    if (!auto || preset === "custom") return;
    const id = setInterval(() => run(preset, unit), refreshMs(unit));
    return () => clearInterval(id);
  }, [auto, preset, unit, run]);

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    run(preset, unit);
  };

  // 기간을 바꾸면 고른 틱 단위가 무효가 될 수 있다 — 새 구간 기준으로 다시 고른다.
  const onPresetClick = (k: Preset) => {
    setPreset(k);
    if (k !== "custom") run(k, unitFor(spanOf(k, customFrom, customTo)));
  };

  const onUnit = (r: TickUnit) => {
    setUnit(r);
    run(preset, r);
  };

  const onSelectAction = (k: string) => {
    const next = actionTyp === k ? "" : k;
    setActionTyp(next);
    run(preset, unit, { actionTyp: next || undefined });
  };

  const hasFilter = !!(userId || actionTyp);
  const clearFilters = () => {
    setUserId("");
    setActionTyp("");
    run(preset, unit, { userId: undefined, actionTyp: undefined });
  };

  const addExclude = (code: string) => {
    if (excludeErrCds.includes(code)) return;
    const next = [...excludeErrCds, code];
    setExcludeErrCds(next);
    run(preset, unit, { excludeErrCds: next });
  };
  const removeExclude = (code: string) => {
    const next = excludeErrCds.filter((c) => c !== code);
    setExcludeErrCds(next);
    run(preset, unit, { excludeErrCds: next.length > 0 ? next : undefined });
  };
  const clearExcludes = () => {
    setExcludeErrCds([]);
    run(preset, unit, { excludeErrCds: undefined });
  };

  const tickCtl = (
    <TickSelect
      value={unit}
      enabled={unitEnabled}
      onChange={onUnit}
      pulsing={auto && preset !== "custom"}
    />
  );

  return (
    <div className="dash">
      <div className="dash-header stacked">
        <div className="dash-head-row">
          <div className="dash-title">
            <div className="dash-title-main">Usage Dashboard</div>
            <div className="dash-title-sub">
              {stats ? fmtRange(stats.range.from, stats.range.to) : "—"}
            </div>
          </div>
        </div>

        <form className="dash-filter" onSubmit={onApply}>
          {/* 기간만 고르는 줄이다. 틱 단위는 차트 바로 위에 있고, 이 줄은 그것에 따라 바뀌지 않는다. */}
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
          <input
            type="text"
            className="user-input"
            placeholder="USER_ID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
          <select
            className="user-input user-select"
            value={actionTyp}
            onChange={(e) => {
              const v = e.target.value;
              setActionTyp(v);
              run(preset, unit, { actionTyp: v || undefined });
            }}
            aria-label="ACTION_TYP"
          >
            <option value="">ACTION_TYP (전체)</option>
            {actionTypeOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          {hasFilter && (
            <button type="button" className="btn ghost" onClick={clearFilters}>
              필터 초기화
            </button>
          )}
          <AutoRefreshToggle on={auto} onChange={setAuto} disabled={preset === "custom"} />
          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? "조회 중…" : "조회"}
          </button>
        </form>
      </div>

      {loading && <div className="dash-banner loading">집계 중…</div>}
      {err && <div className="dash-banner err">불러오기 실패: {err}</div>}

      {stats && (
        <>
          <ScopeNote>
            BIZ 트레이스 기준입니다. <b>LLM 타임아웃</b>은 이 화면 숫자에 따로 잡히지 않습니다.
          </ScopeNote>

          {/* 1. Hero KPIs — 한눈에 보는 핵심 지표 */}
          <StatsCards stats={stats} />

          {unit === "1m" && actionTyp && (
            <div className="tick-notice warn">
              1분 추이는 진입 레이어 행에서 세므로 <b>ACTION_TYP 이 걸리지 않습니다</b> — 위 KPI 와 대상이 다릅니다.
            </div>
          )}

          {/* 2. 일별/시간별 추이 — 임원이 가장 보고 싶어하는 차트, 메인으로 노출.
              단위 선택(TickSelect)은 이 카드 머리 안에 있고, 틱 보기도 **같은 자리**를 쓴다.
              ⚠️ 틱 조회가 비어도 카드 껍데기는 그려야 한다 — 안 그리면 되돌릴 컨트롤이 사라진다. */}
          {unit === "1m" ? (
            tick ? (
              <TickMonitor stats={tick} metrics={BIZ_METRICS} title="사용 추이" rowsLabel="요청" headSlot={tickCtl} />
            ) : (
              <section className="dash-card dash-card-hero">
                <div className="dash-card-head">
                  <div className="dash-card-title-group">
                    <span className="dash-card-title">사용 추이</span>
                  </div>
                  <div className="dash-card-aux">{tickCtl}</div>
                </div>
                <div className="dash-card-body"><div className="tick-empty">—</div></div>
              </section>
            )
          ) : (
          <>
          <section className="dash-card dash-card-hero">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">사용 추이</span>
                <span className="dash-card-sub">상태별 적층 · {granularityLabel(stats.granularity)} 단위</span>
              </div>
              <div className="dash-card-aux">
                {tickCtl}
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
          </>
          )}

          {/* 평균 응답 속도 추이 — Action end-to-end 응답시간(CUBE send→resp, LLM 포함 전 구간).
              Tokens 탭의 LLM 호출 지연(1콜 단위, 전 노드)과는 재는 대상이 다른 정규 지표다. */}
          <section className="dash-card">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">평균 응답 속도</span>
                <span className="dash-card-sub">
                  Action 전체 응답시간 · CUBE 수신→응답(LLM 포함 전 구간) · {granularityLabel(stats.granularity)} 단위
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

