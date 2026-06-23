"use client";

import { useCallback, useEffect, useState } from "react";
import { DimensionBreakdown } from "@/components/DimensionBreakdown";
import { ProfileStrip } from "@/components/ProfileStrip";
import { LayerBars } from "@/components/LayerBars";
import { StatsCards } from "@/components/StatsCards";
import { StatusDonut } from "@/components/StatusDonut";
import { TimeSeriesChart } from "@/components/TimeSeriesChart";
import { TopList } from "@/components/TopList";
import { StatsFilter, StatsResponse } from "@/lib/types";

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
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [actionTypeOptions, setActionTypeOptions] = useState<string[]>([]);
  const [errorCodeMap, setErrorCodeMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/action-types", { cache: "no-store" });
        if (!res.ok) return;
        const data: { values: string[] } = await res.json();
        if (alive) setActionTypeOptions(data.values ?? []);
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
        const res = await fetch("/api/error-codes", { cache: "no-store" });
        if (!res.ok) return;
        const data: { codes: Record<string, string> } = await res.json();
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
      const res = await fetch(`/api/stats?${q.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: StatsResponse = await res.json();
      setStats(data);
    } catch (e) {
      setErr(String(e));
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(computeFilter()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    load(computeFilter());
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
      <div className="dash-header">
        <div className="dash-title">
          <div className="dash-title-main">Usage Dashboard</div>
          <div className="dash-title-sub">
            {stats ? fmtRange(stats.range.from, stats.range.to) : "—"}
          </div>
        </div>
        <form className="dash-filter" onSubmit={onApply}>
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
              load({ ...computeFilter(), actionTyp: v || undefined });
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
          <button type="submit" className="btn primary">조회</button>
        </form>
      </div>

      {loading && <div className="dash-banner loading">집계 중…</div>}
      {err && <div className="dash-banner err">불러오기 실패: {err}</div>}

      {stats && (
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

          {/* 4. 액션 — 어디서 많이 쓰이는지 */}
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

          {/* 5. FAC 별 — MCP send 단계에서 확정되는 FAC 기준 분포 */}
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

          {/* 6. 사용자 Top — 헤비 유저 파악 */}
          <section className="dash-card">
            <div className="dash-card-head">
              <span className="dash-card-title">Top 사용자</span>
              <span className="dash-card-sub">트레이스 수 기준</span>
            </div>
            <div className="dash-card-body">
              <TopList items={stats.topUsers} totalForPct={stats.totals.total} emptyText="데이터 없음" tone="neutral" />
            </div>
          </section>

          {/* 7. 레이어 — 엔지니어용 디테일, 접근성 위해 유지하되 가장 아래 */}
          <section className="dash-card dash-card-muted">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">레이어별 호출</span>
                <span className="dash-card-sub">행 단위 호출량 · 평균 응답시간 (engineering view)</span>
              </div>
            </div>
            <div className="dash-card-body">
              <LayerBars stats={stats} />
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
