"use client";

// ─────────────────────────────────────────────────────────────────────────────
// /report — 종합 실적 리포트 (주간 기본).
//
// 관리자가 매주 수기로 옮겨 적던 실적을 한 화면에 모아 보여주고(FullScope 차트),
// "전체 복사" 한 번으로 보고용 텍스트를 클립보드에 담는다.
//   - 기간 기본 = 주 단위 (월요일 00:00 ~ 다음주 월요일 00:00), ◀▶ 로 주 이동
//   - 직접 설정 모드에서 시각까지 자유 지정 가능
//   - Action Agent 실적: /api/stats (트레이스 단위 — 성공률/지연/사용자 수/액션별/에러)
//   - LLM 토큰 실적: /api/tokens (TRX_TOKEN_DET — action 외 judge/setup_guide 노드 구분 포함)
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CubeLatencyChart } from "@/components/CubeLatencyChart";
import { DimensionBreakdown } from "@/components/DimensionBreakdown";
import { StatusDonut } from "@/components/StatusDonut";
import { TimeSeriesChart } from "@/components/TimeSeriesChart";
import { TokenBreakdown } from "@/components/TokenBreakdown";
import { TokenChart } from "@/components/TokenChart";
import { TokenLatencyChart, fmtDuration } from "@/components/TokenLatencyChart";
import { TokenStatsCards } from "@/components/TokenStatsCards";
import { TopList } from "@/components/TopList";
import { AgentProfile, StatsResponse, TokenStatsResponse } from "@/lib/types";

type RangeMode = "week" | "custom";

const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date → 'YYYY-MM-DDTHH:MM:SS' (로컬, TZ 없음 — API 시각 규칙과 동일) */
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** offset 주(0 = 이번 주, -1 = 지난주)의 [월요일 00:00, 다음주 월요일 00:00) */
function weekRange(offset: number): { from: Date; to: Date } {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  const from = new Date(d);
  const to = new Date(d);
  to.setDate(to.getDate() + 7);
  return { from, to };
}

function fmtDateKo(d: Date, withTime: boolean): string {
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} (${DAY_KO[d.getDay()]})`;
  return withTime ? `${base} ${pad(d.getHours())}:${pad(d.getMinutes())}` : base;
}

function weekBadge(offset: number): string {
  if (offset === 0) return "이번 주";
  if (offset === -1) return "지난주";
  return `${-offset}주 전`;
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return ((n / total) * 100).toFixed(1) + "%";
}

// ── 복사용 텍스트 생성 ────────────────────────────────────────────────────────
function buildReportText(opts: {
  agentName: string;
  from: string;
  to: string;
  rangeLabel: string;
  stats: StatsResponse | null;
  tok: TokenStatsResponse | null;
  errDescs: Record<string, string>;
}): string {
  const { agentName, rangeLabel, stats, tok, errDescs } = opts;
  const L: string[] = [];
  const line = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

  L.push(line);
  L.push(`■ ${agentName} 실적 리포트`);
  L.push(`■ 기간: ${rangeLabel}`);
  L.push(line);
  L.push("");

  L.push("[Action Agent 실적]");
  if (!stats) {
    L.push("  (데이터 없음)");
  } else {
    const t = stats.totals;
    L.push(`  · 총 실행       ${t.total.toLocaleString()}건`);
    L.push(`  · 성공          ${t.ok.toLocaleString()}건 (${pct(t.ok, t.total)})`);
    L.push(`  · 실패          ${t.fail.toLocaleString()}건 (${pct(t.fail, t.total)})`);
    if (t.pending > 0) L.push(`  · 진행중        ${t.pending.toLocaleString()}건`);
    L.push(`  · 평균 응답시간  ${fmtDuration(stats.cubeAvgLatencyMs ?? null)} (수신→응답, LLM 포함 전 구간)`);
    L.push(`  · 사용자        ${stats.uniqueUsers != null ? `${stats.uniqueUsers.toLocaleString()}명` : "—"}`);

    if (stats.byAction.length > 0) {
      L.push("");
      L.push("[액션 타입별]");
      for (const a of stats.byAction) {
        const detail = [`성공 ${a.ok.toLocaleString()}`, `실패 ${a.fail.toLocaleString()}`];
        if (a.pending > 0) detail.push(`진행중 ${a.pending.toLocaleString()}`);
        L.push(`  · ${a.key}: ${a.total.toLocaleString()}건 (${detail.join(" · ")})`);
      }
    }

    if (stats.topErrors.length > 0) {
      L.push("");
      L.push("[주요 에러]");
      for (const e of stats.topErrors) {
        const desc = errDescs[e.key];
        L.push(`  · ${e.key}: ${e.count.toLocaleString()}건${desc ? ` — ${desc}` : ""}`);
      }
    }

    if (stats.topUsers.length > 0) {
      L.push("");
      L.push(`[Top 사용자] (전체 ${stats.uniqueUsers != null ? `${stats.uniqueUsers.toLocaleString()}명` : "—"})`);
      for (const u of stats.topUsers) {
        L.push(`  · ${u.key}: ${u.count.toLocaleString()}건`);
      }
    }

    const facTop = stats.byFac.filter((f) => f.key !== "(none)").slice(0, 5);
    if (facTop.length > 0) {
      L.push("");
      L.push("[FAC별 TOP]");
      for (const f of facTop) L.push(`  · ${f.key}: ${f.total.toLocaleString()}건`);
    }
    const areaTop = stats.byArea.filter((a) => a.key !== "(none)").slice(0, 5);
    if (areaTop.length > 0) {
      L.push("");
      L.push("[AREA별 TOP]");
      for (const a of areaTop) L.push(`  · ${a.key}: ${a.total.toLocaleString()}건`);
    }
  }

  L.push("");
  L.push("[LLM 토큰 사용 · GAIA 전 노드]");
  if (!tok || tok.totals.calls === 0) {
    L.push("  (데이터 없음)");
  } else {
    const t = tok.totals;
    L.push(`  · 총 호출        ${t.calls.toLocaleString()}회`);
    L.push(`  · 총 토큰        ${t.totalTokens.toLocaleString()} (IN ${t.inputTokens.toLocaleString()} / OUT ${t.outputTokens.toLocaleString()})`);
    L.push(`  · 호출당 평균    ${tok.avgTotalPerCall != null ? `${Math.round(tok.avgTotalPerCall).toLocaleString()} tok` : "—"}`);
    L.push(`  · 평균 호출 지연 ${fmtDuration(tok.avgLatencyMs)}`);

    if (tok.byNode.length > 0) {
      L.push("");
      L.push("[노드별 토큰] (action = Action Agent / 그 외 노드 구분)");
      for (const n of tok.byNode) {
        L.push(
          `  · ${n.key}: ${n.totalTokens.toLocaleString()} tok (${pct(n.totalTokens, t.totalTokens)})` +
            ` · 호출 ${n.calls.toLocaleString()}` +
            ` · 지연 ${fmtDuration(n.avgLatencyMs)}`
        );
      }
    }
    if (tok.byModel.length > 0) {
      L.push("");
      L.push("[모델별 토큰]");
      for (const m of tok.byModel) {
        L.push(
          `  · ${m.key}: ${m.totalTokens.toLocaleString()} tok (${pct(m.totalTokens, t.totalTokens)})` +
            ` · 호출 ${m.calls.toLocaleString()}`
        );
      }
    }
  }

  L.push("");
  L.push(line);
  L.push(`(TraceX 실적 리포트 · 생성 ${isoLocal(new Date()).replace("T", " ").slice(0, 16)})`);
  return L.join("\n");
}

// ── KPI 카드 (report 전용 — 사용자 수 포함 5칸) ────────────────────────────────
function ReportKpis({ stats }: { stats: StatsResponse }) {
  const t = stats.totals;
  const cards: { title: string; value: string; sub: string; tone: string }[] = [
    { title: "총 실행", value: t.total.toLocaleString(), sub: "트레이스 단위", tone: "default" },
    { title: "성공률", value: pct(t.ok, t.total), sub: `${t.ok.toLocaleString()} OK`, tone: "ok" },
    {
      title: "실패",
      value: t.fail.toLocaleString(),
      sub: `${pct(t.fail, t.total)} of ${t.total.toLocaleString()}`,
      tone: t.fail > 0 ? "err" : "default",
    },
    {
      title: "평균 응답시간",
      value: fmtDuration(stats.cubeAvgLatencyMs ?? null),
      sub: "수신→응답 · LLM 포함",
      tone: "default",
    },
    {
      title: "사용자",
      value: stats.uniqueUsers != null ? `${stats.uniqueUsers.toLocaleString()}명` : "—",
      sub: "USER_ID 고유 수",
      tone: "default",
    },
  ];
  return (
    <div className="kpi-grid kpi-grid-5">
      {cards.map((c) => (
        <div key={c.title} className={`kpi-card tone-${c.tone}`}>
          <div className="kpi-title">{c.title}</div>
          <div className="kpi-value">{c.value}</div>
          <div className="kpi-sub">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

export default function ReportPage() {
  const [mode, setMode] = useState<RangeMode>("week");
  const [weekOffset, setWeekOffset] = useState(0);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // 실제 조회에 적용된 기간 (week 이동/custom 적용 시 갱신)
  const [applied, setApplied] = useState<{ from: string; to: string }>(() => {
    const { from, to } = weekRange(0);
    return { from: isoLocal(from), to: isoLocal(to) };
  });

  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [tok, setTok] = useState<TokenStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [errorCodeMap, setErrorCodeMap] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  // 보조 데이터 (실패해도 리포트는 동작)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/profile", { cache: "no-store" });
        if (!res.ok) return;
        const data: { profile: AgentProfile } = await res.json();
        if (alive) setProfile(data.profile);
      } catch { /* ignore */ }
    })();
    (async () => {
      try {
        const res = await fetch("/api/error-codes", { cache: "no-store" });
        if (!res.ok) return;
        const data: { codes: Record<string, string> } = await res.json();
        if (alive) setErrorCodeMap(data.codes ?? {});
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, []);

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setErr(null);
    try {
      const q = new URLSearchParams({ dateFrom: from, dateTo: to });
      const [sRes, tRes] = await Promise.all([
        fetch(`/api/stats?${q.toString()}`, { cache: "no-store" }),
        fetch(`/api/tokens?${q.toString()}`, { cache: "no-store" }),
      ]);
      if (!sRes.ok) throw new Error(`stats HTTP ${sRes.status}`);
      if (!tRes.ok) throw new Error(`tokens HTTP ${tRes.status}`);
      const [sData, tData] = await Promise.all([sRes.json(), tRes.json()]);
      setStats(sData as StatsResponse);
      setTok(tData as TokenStatsResponse);
    } catch (e) {
      setErr(String(e));
      setStats(null);
      setTok(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(applied.from, applied.to);
  }, [applied, load]);

  const goWeek = (offset: number) => {
    setMode("week");
    setWeekOffset(offset);
    const { from, to } = weekRange(offset);
    setApplied({ from: isoLocal(from), to: isoLocal(to) });
  };

  const applyCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customFrom || !customTo) return;
    // datetime-local 은 'YYYY-MM-DDTHH:MM' — 초 단위 보정
    const norm = (s: string) => (s.length === 16 ? s + ":00" : s);
    setApplied({ from: norm(customFrom), to: norm(customTo) });
  };

  const enterCustom = () => {
    setMode("custom");
    // 현재 적용 기간을 초깃값으로 (초 절삭)
    if (!customFrom) setCustomFrom(applied.from.slice(0, 16));
    if (!customTo) setCustomTo(applied.to.slice(0, 16));
  };

  const rangeLabel = useMemo(() => {
    const from = new Date(applied.from);
    const to = new Date(applied.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return "—";
    return `${fmtDateKo(from, true)} ~ ${fmtDateKo(to, true)}`;
  }, [applied]);

  const agentName = profile?.name ?? "AI Agent";

  const reportText = useMemo(
    () =>
      buildReportText({
        agentName,
        from: applied.from,
        to: applied.to,
        rangeLabel,
        stats,
        tok,
        errDescs: errorCodeMap,
      }),
    [agentName, applied, rangeLabel, stats, tok, errorCodeMap]
  );

  const doCopy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(reportText);
      ok = true;
    } catch {
      // http/구형 브라우저 폴백
      const ta = document.createElement("textarea");
      ta.value = reportText;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      document.body.removeChild(ta);
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="dash report">
      <div className="dash-header">
        <div className="dash-title">
          <div className="dash-title-main">실적 리포트</div>
          <div className="dash-title-sub">
            {rangeLabel}
            {mode === "week" && <span className="report-week-badge">{weekBadge(weekOffset)}</span>}
          </div>
        </div>

        <div className="dash-filter report-controls">
          {mode === "week" && (
            <div className="week-nav" role="group" aria-label="주 이동">
              <button type="button" onClick={() => goWeek(weekOffset - 1)} aria-label="이전 주">◀</button>
              <span className="week-nav-label">{weekBadge(weekOffset)}</span>
              <button
                type="button"
                onClick={() => goWeek(weekOffset + 1)}
                disabled={weekOffset >= 0}
                aria-label="다음 주"
              >
                ▶
              </button>
            </div>
          )}
          <div className="preset-group" role="tablist" aria-label="기간 모드">
            <button
              type="button"
              className={"preset-btn" + (mode === "week" && weekOffset === 0 ? " active" : "")}
              onClick={() => goWeek(0)}
            >
              이번 주
            </button>
            <button
              type="button"
              className={"preset-btn" + (mode === "week" && weekOffset === -1 ? " active" : "")}
              onClick={() => goWeek(-1)}
            >
              지난주
            </button>
            <button
              type="button"
              className={"preset-btn" + (mode === "custom" ? " active" : "")}
              onClick={enterCustom}
            >
              직접 설정
            </button>
          </div>
          {mode === "custom" && (
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
          <button
            type="button"
            className={"btn primary copy-btn" + (copied ? " copied" : "")}
            onClick={doCopy}
            disabled={loading || (!stats && !tok)}
            title="리포트 전체를 텍스트로 복사"
          >
            {copied ? "✓ 복사됨" : "📋 전체 복사"}
          </button>
        </div>
      </div>

      {loading && <div className="dash-banner loading">집계 중…</div>}
      {err && <div className="dash-banner err">불러오기 실패: {err}</div>}

      {stats && (
        <>
          <div className="report-h">
            <span className="report-h-num">1</span>
            <span className="report-h-title">Action Agent 실적</span>
            <span className="report-h-sub">트레이스 단위 · BIZ_AIACTIONTXN_HIS</span>
          </div>

          <ReportKpis stats={stats} />

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

          <section className="dash-card">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">평균 응답 지연</span>
                <span className="dash-card-sub">Action 전체 응답시간 · CUBE 수신→응답(LLM 포함 전 구간)</span>
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
                <span className="dash-card-sub">ERR_CD 빈도 top {stats.topErrors.length || 0}</span>
              </div>
              <div className="dash-card-body">
                <TopList
                  items={stats.topErrors}
                  totalForPct={stats.rowCount}
                  emptyText="에러 없음 ✓"
                  tone="err"
                  descriptions={errorCodeMap}
                />
              </div>
            </section>
          </div>

          <div className="dash-row split">
            <section className="dash-card">
              <div className="dash-card-head">
                <span className="dash-card-title">액션 타입별</span>
                <span className="dash-card-sub">ACTION_TYP 별 분포</span>
              </div>
              <div className="dash-card-body">
                <DimensionBreakdown items={stats.byAction} emptyText="액션 데이터 없음" />
              </div>
            </section>

            <section className="dash-card">
              <div className="dash-card-head">
                <span className="dash-card-title">주간 사용자</span>
                <span className="dash-card-sub">
                  고유 {stats.uniqueUsers != null ? `${stats.uniqueUsers.toLocaleString()}명` : "—"} · 트레이스 수 기준 top
                </span>
              </div>
              <div className="dash-card-body">
                <TopList
                  items={stats.topUsers}
                  totalForPct={stats.totals.total}
                  emptyText="데이터 없음"
                  tone="neutral"
                />
              </div>
            </section>
          </div>

          <div className="dash-row split">
            <section className="dash-card">
              <div className="dash-card-head">
                <span className="dash-card-title">FAC별</span>
                <span className="dash-card-sub">FAC_ID 별 분포 · MCP 기준 (미도달은 (none))</span>
              </div>
              <div className="dash-card-body">
                <DimensionBreakdown items={stats.byFac} emptyText="FAC 데이터 없음" />
              </div>
            </section>

            <section className="dash-card">
              <div className="dash-card-head">
                <span className="dash-card-title">AREA별</span>
                <span className="dash-card-sub">AREA_ID 별 분포 · MCP 기준 (미도달은 (none))</span>
              </div>
              <div className="dash-card-body">
                <DimensionBreakdown items={stats.byArea} emptyText="AREA 데이터 없음" />
              </div>
            </section>
          </div>
        </>
      )}

      {tok && (
        <>
          <div className="report-h">
            <span className="report-h-num">2</span>
            <span className="report-h-title">LLM 토큰 사용</span>
            <span className="report-h-sub">GAIA 전 노드 (action / judge / setup_guide …) · TRX_TOKEN_DET</span>
          </div>

          <TokenStatsCards stats={tok} />

          <section className="dash-card dash-card-hero">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">토큰 사용 추이</span>
                <span className="dash-card-sub">input / output 적층 · {granText(tok.granularity)} 단위</span>
              </div>
              <div className="dash-card-aux">
                <span className="aux-pill">
                  <span className="aux-pill-key">총 토큰</span>
                  <span className="aux-pill-val">{tok.totals.totalTokens.toLocaleString()}</span>
                </span>
                <span className="aux-pill">
                  <span className="aux-pill-key">호출</span>
                  <span className="aux-pill-val">{tok.totals.calls.toLocaleString()}</span>
                </span>
              </div>
            </div>
            <div className="dash-card-body">
              <TokenChart stats={tok} />
            </div>
          </section>

          <section className="dash-card">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">LLM 호출 지연 추이</span>
                <span className="dash-card-sub">호출당 평균 소요시간 · {granText(tok.granularity)} 단위</span>
              </div>
              <div className="dash-card-aux">
                <span className="aux-pill">
                  <span className="aux-pill-key">평균 지연</span>
                  <span className="aux-pill-val">{fmtDuration(tok.avgLatencyMs)}</span>
                </span>
              </div>
            </div>
            <div className="dash-card-body">
              <TokenLatencyChart stats={tok} />
            </div>
          </section>

          {/* 노드별(action/judge/setup_guide) · 모델별 리더보드 — 리포트에선 필터 없이 조회 전용 */}
          <TokenBreakdown stats={tok} emptyText="데이터 없음" />
        </>
      )}

      {(stats || tok) && (
        <section className="dash-card report-preview">
          <div className="dash-card-head">
            <div className="dash-card-title-group">
              <span className="dash-card-title">리포트 텍스트</span>
              <span className="dash-card-sub">전체 복사 시 이 내용이 클립보드에 담긴다</span>
            </div>
            <button
              type="button"
              className={"btn primary copy-btn" + (copied ? " copied" : "")}
              onClick={doCopy}
            >
              {copied ? "✓ 복사됨" : "📋 전체 복사"}
            </button>
          </div>
          <div className="dash-card-body">
            <pre className="report-preview-text">{reportText}</pre>
          </div>
        </section>
      )}

      <div className="report-footer">
        <Link href="/agent" className="btn ghost" prefetch={false}>← Agent 프로필</Link>
        <Link href="/dashboard" className="btn ghost" prefetch={false}>Dashboard</Link>
      </div>
    </div>
  );
}

function granText(g: StatsResponse["granularity"]): string {
  return g === "5m" ? "5분" : g === "1h" ? "시간" : "일";
}
