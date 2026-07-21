"use client";

// ─────────────────────────────────────────────────────────────────────────────
// /report — 종합 실적 리포트 (주간 기본 · 일간 지원). AdminGate 뒤에 있다.
//
// 관리자가 매주 수기로 옮겨 적던 실적을 한 화면에 모아 보여주고(FullScope 차트),
// "전체 복사" 한 번으로 보고용 텍스트를 클립보드에 담는다.
//   - 주간 = 월요일 00:00 ~ 다음주 월요일 00:00 / 일간 = 자정 ~ 다음날 자정, ◀▶ 로 기간 이동
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
import { AdminGate } from "@/components/AdminGate";
import { AgentProfile, DailyActionStat, StatsResponse, TokenStatsResponse } from "@/lib/types";

type PeriodUnit = "day" | "week";
type RangeMode = PeriodUnit | "custom";

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

/** offset 일(0 = 오늘, -1 = 어제)의 [자정, 다음날 자정) */
function dayRange(offset: number): { from: Date; to: Date } {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  const from = new Date(d);
  const to = new Date(d);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

function periodRange(unit: PeriodUnit, offset: number): { from: Date; to: Date } {
  return unit === "day" ? dayRange(offset) : weekRange(offset);
}

function fmtDateKo(d: Date, withTime: boolean): string {
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} (${DAY_KO[d.getDay()]})`;
  return withTime ? `${base} ${pad(d.getHours())}:${pad(d.getMinutes())}` : base;
}

function periodBadge(unit: PeriodUnit, offset: number): string {
  if (unit === "day") {
    if (offset === 0) return "오늘";
    if (offset === -1) return "어제";
    return `${-offset}일 전`;
  }
  if (offset === 0) return "이번 주";
  if (offset === -1) return "지난주";
  return `${-offset}주 전`;
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return ((n / total) * 100).toFixed(1) + "%";
}

// ── 일별 브레이크다운 ─────────────────────────────────────────────────────────
// 주간(또는 며칠짜리 직접 설정) 조회에서도 하루 단위 실적이 바로 보이도록,
// stats.daily(서버 집계)에 토큰(tok.buckets 를 날짜로 합산)을 붙여 하나의 행으로 만든다.
// 화면의 "일별 현황" 표와 복사 텍스트의 [일별 현황] 이 같은 데이터를 쓴다.
interface DailyRow {
  date: string; // "YYYY-MM-DD"
  total: number;
  ok: number;
  fail: number;
  pending: number;
  users: number;
  avgCubeLatencyMs: number | null;
  byAction: DailyActionStat[];
  tokens: number;
  llmCalls: number;
}

function mergeDailyRows(stats: StatsResponse | null, tok: TokenStatsResponse | null): DailyRow[] {
  const daily = stats?.daily ?? [];
  if (daily.length === 0) return [];
  const tokByDate = new Map<string, { tokens: number; calls: number }>();
  for (const b of tok?.buckets ?? []) {
    const key = b.ts.slice(0, 10);
    const t = tokByDate.get(key) ?? { tokens: 0, calls: 0 };
    t.tokens += b.totalTokens;
    t.calls += b.calls;
    tokByDate.set(key, t);
  }
  return daily.map((d) => ({
    ...d,
    tokens: tokByDate.get(d.date)?.tokens ?? 0,
    llmCalls: tokByDate.get(d.date)?.calls ?? 0,
  }));
}

/** "YYYY-MM-DD" → { label: "07/07 (월)", dow: 0~6 } — Date.parse 의 UTC 해석을 피해 직접 파싱 */
function dayLabel(date: string): { label: string; dow: number } {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return { label: `${pad(m)}/${pad(d)} (${DAY_KO[dow]})`, dow };
}

// ── 일별 기능(액션) 구성 ──────────────────────────────────────────────────────
// "그날 어떤 기능이 얼마나 돌았나" 를 한눈에 — 날짜별 스택 바(기능별 색) + 범례.
// 색은 기간 전체 실행수 desc 로 안정 배정한다(날짜가 바뀌어도 같은 기능=같은 색).
const ACTION_PALETTE = [
  "#2563eb", "#7c3aed", "#0891b2", "#c2410c",
  "#0d9488", "#db2777", "#65a30d", "#4f46e5",
];
const ACTION_NONE_COLOR = "#94a3b8";

interface ActionMeta {
  key: string;
  total: number;
  color: string;
}

/** 기간 전체 기능별 합계(desc) + 색 배정. '(none)' 는 항상 회색으로 뒤에. */
function buildActionMeta(rows: DailyRow[]): { list: ActionMeta[]; colorOf: (k: string) => string } {
  const totals = new Map<string, number>();
  for (const r of rows) {
    for (const a of r.byAction) totals.set(a.key, (totals.get(a.key) ?? 0) + a.total);
  }
  const ordered = Array.from(totals.entries())
    .filter(([k]) => k !== "(none)")
    .sort((a, b) => b[1] - a[1]);
  const list: ActionMeta[] = ordered.map(([key, total], i) => ({
    key,
    total,
    color: ACTION_PALETTE[i % ACTION_PALETTE.length],
  }));
  if (totals.has("(none)")) {
    list.push({ key: "(none)", total: totals.get("(none)")!, color: ACTION_NONE_COLOR });
  }
  const map = new Map(list.map((m) => [m.key, m.color]));
  return { list, colorOf: (k) => map.get(k) ?? ACTION_NONE_COLOR };
}

function DailyActionBreakdown({ rows }: { rows: DailyRow[] }) {
  const { list, colorOf } = useMemo(() => buildActionMeta(rows), [rows]);
  const activeRows = rows.filter((r) => r.total > 0);
  const maxTotal = Math.max(1, ...activeRows.map((r) => r.total));

  if (list.length === 0 || activeRows.length === 0) {
    return <div className="top-empty">기능 데이터 없음</div>;
  }

  return (
    <div className="dab">
      <div className="dab-legend">
        {list.map((m) => (
          <span key={m.key} className="dab-legend-item" title={`${m.key} · 기간 합계 ${m.total.toLocaleString()}건`}>
            <span className="dab-dot" style={{ background: m.color }} aria-hidden />
            <span className="dab-legend-key">{m.key}</span>
            <span className="dab-legend-val">{m.total.toLocaleString()}</span>
          </span>
        ))}
      </div>
      <ul className="dab-rows">
        {activeRows.map((r) => {
          const { label, dow } = dayLabel(r.date);
          return (
            <li key={r.date} className="dab-row">
              <span className={`dab-date dow-${dow}`}>{label}</span>
              <span className="dab-track" style={{ width: `${(r.total / maxTotal) * 100}%` }}>
                {r.byAction.map((a) => (
                  <span
                    key={a.key}
                    className="dab-seg"
                    style={{ width: `${(a.total / r.total) * 100}%`, background: colorOf(a.key) }}
                    title={`${a.key}: ${a.total.toLocaleString()}건 (성공 ${a.ok} · 실패 ${a.fail})`}
                  />
                ))}
              </span>
              <span className="dab-total">{r.total.toLocaleString()}</span>
              <span className="dab-chips">
                {r.byAction.map((a) => (
                  <span key={a.key} className="dab-chip" title={`${a.key} 성공 ${a.ok} · 실패 ${a.fail}`}>
                    <span className="dab-dot sm" style={{ background: colorOf(a.key) }} aria-hidden />
                    {a.key}
                    <b>{a.total.toLocaleString()}</b>
                  </span>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── 복사용 텍스트 생성 ────────────────────────────────────────────────────────
function buildReportText(opts: {
  agentName: string;
  from: string;
  to: string;
  rangeLabel: string;
  stats: StatsResponse | null;
  tok: TokenStatsResponse | null;
  dailyRows: DailyRow[];
  errDescs: Record<string, string>;
}): string {
  const { agentName, rangeLabel, stats, tok, dailyRows, errDescs } = opts;
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

    // 하루짜리 조회(오늘/어제)에선 KPI 와 동어반복이라 2일 이상일 때만 싣는다
    if (dailyRows.length >= 2) {
      L.push("");
      L.push("[일별 현황]");
      for (const d of dailyRows) {
        const { label } = dayLabel(d.date);
        if (d.total === 0 && d.tokens === 0) {
          L.push(`  · ${label}: -`);
          continue;
        }
        const parts = [`실행 ${d.total.toLocaleString()}`];
        parts.push(`성공 ${d.ok.toLocaleString()}`);
        if (d.fail > 0) parts.push(`실패 ${d.fail.toLocaleString()}`);
        if (d.pending > 0) parts.push(`진행중 ${d.pending.toLocaleString()}`);
        parts.push(`사용자 ${d.users.toLocaleString()}명`);
        if (d.tokens > 0) parts.push(`토큰 ${d.tokens.toLocaleString()}`);
        L.push(`  · ${label}: ${parts.join(" · ")}`);
        // 그날 기능(액션)별 세부 — 실행이 있는 날만
        const acts = d.byAction.filter((a) => a.total > 0);
        if (acts.length > 0) {
          const detail = acts
            .map((a) => `${a.key} ${a.total.toLocaleString()}${a.fail > 0 ? `(실패 ${a.fail})` : ""}`)
            .join(", ");
          L.push(`      └ 기능: ${detail}`);
        }
      }
    }

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

// ── 일별 현황 표 (주간/기간 조회 시 하루 단위 실적이 바로 보이도록) ─────────────
function DailyTable({ rows }: { rows: DailyRow[] }) {
  const maxTotal = Math.max(1, ...rows.map((r) => r.total));
  const peakDate =
    rows.reduce<DailyRow | null>((p, r) => (r.total > 0 && r.total > (p?.total ?? 0) ? r : p), null)?.date ?? null;
  const sum = rows.reduce(
    (a, r) => ({ total: a.total + r.total, ok: a.ok + r.ok, fail: a.fail + r.fail, tokens: a.tokens + r.tokens }),
    { total: 0, ok: 0, fail: 0, tokens: 0 }
  );
  return (
    <div className="daily-table-wrap">
      <table className="daily-table">
        <thead>
          <tr>
            <th>날짜</th>
            <th className="num">실행</th>
            <th className="num">성공</th>
            <th className="num">실패</th>
            <th className="num">성공률</th>
            <th className="num">사용자</th>
            <th className="num">평균 응답</th>
            <th className="num">LLM 토큰</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const { label, dow } = dayLabel(r.date);
            const empty = r.total === 0 && r.tokens === 0;
            return (
              <tr key={r.date} className={empty ? "empty" : undefined}>
                <td className={`daily-date dow-${dow}`}>
                  {label}
                  {r.date === peakDate && <span className="daily-peak">peak</span>}
                </td>
                <td className="num daily-run">
                  <span className="daily-bar" style={{ width: `${(r.total / maxTotal) * 100}%` }} aria-hidden />
                  <span className="daily-run-val">{r.total > 0 ? r.total.toLocaleString() : "-"}</span>
                </td>
                <td className="num ok">{r.ok > 0 ? r.ok.toLocaleString() : "-"}</td>
                <td className={"num" + (r.fail > 0 ? " err" : "")}>{r.fail > 0 ? r.fail.toLocaleString() : "-"}</td>
                <td className="num">{r.total > 0 ? pct(r.ok, r.total) : "-"}</td>
                <td className="num">{r.users > 0 ? `${r.users.toLocaleString()}명` : "-"}</td>
                <td className="num">{r.avgCubeLatencyMs != null ? fmtDuration(r.avgCubeLatencyMs) : "-"}</td>
                <td className="num">{r.tokens > 0 ? r.tokens.toLocaleString() : "-"}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>합계</td>
            <td className="num">{sum.total.toLocaleString()}</td>
            <td className="num ok">{sum.ok.toLocaleString()}</td>
            <td className={"num" + (sum.fail > 0 ? " err" : "")}>{sum.fail.toLocaleString()}</td>
            <td className="num">{sum.total > 0 ? pct(sum.ok, sum.total) : "-"}</td>
            <td className="num">—</td>
            <td className="num">—</td>
            <td className="num">{sum.tokens > 0 ? sum.tokens.toLocaleString() : "-"}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default function ReportPage() {
  return (
    <AdminGate
      title="실적 리포트"
      sub="관리자 전용 화면입니다. 비밀번호를 입력하면 실적을 볼 수 있습니다."
      icon="📋"
    >
      <ReportContent />
    </AdminGate>
  );
}

function ReportContent() {
  const [mode, setMode] = useState<RangeMode>("week");
  // 일간/주간 공통 기간 오프셋 (0 = 오늘/이번 주). 단위 전환 시 프리셋 버튼이 다시 지정한다.
  const [offset, setOffset] = useState(0);
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

  const goPeriod = (unit: PeriodUnit, next: number) => {
    setMode(unit);
    setOffset(next);
    const { from, to } = periodRange(unit, next);
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

  // 일별 브레이크다운 — 표와 복사 텍스트가 같은 행을 공유한다 (2일 이상 조회 시에만 노출)
  const dailyRows = useMemo(() => mergeDailyRows(stats, tok), [stats, tok]);

  const reportText = useMemo(
    () =>
      buildReportText({
        agentName,
        from: applied.from,
        to: applied.to,
        rangeLabel,
        stats,
        tok,
        dailyRows,
        errDescs: errorCodeMap,
      }),
    [agentName, applied, rangeLabel, stats, tok, dailyRows, errorCodeMap]
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
            {mode !== "custom" && (
              <span className="report-week-badge">{periodBadge(mode, offset)}</span>
            )}
          </div>
        </div>

        <div className="dash-filter report-controls">
          {mode !== "custom" && (
            <div className="week-nav" role="group" aria-label="기간 이동">
              <button
                type="button"
                onClick={() => goPeriod(mode, offset - 1)}
                aria-label={mode === "day" ? "이전 일" : "이전 주"}
              >
                ◀
              </button>
              <span className="week-nav-label">{periodBadge(mode, offset)}</span>
              <button
                type="button"
                onClick={() => goPeriod(mode, offset + 1)}
                disabled={offset >= 0}
                aria-label={mode === "day" ? "다음 일" : "다음 주"}
              >
                ▶
              </button>
            </div>
          )}
          <div className="preset-group" role="tablist" aria-label="기간 모드">
            <button
              type="button"
              className={"preset-btn" + (mode === "day" && offset === 0 ? " active" : "")}
              onClick={() => goPeriod("day", 0)}
            >
              오늘
            </button>
            <button
              type="button"
              className={"preset-btn" + (mode === "day" && offset === -1 ? " active" : "")}
              onClick={() => goPeriod("day", -1)}
            >
              어제
            </button>
            <button
              type="button"
              className={"preset-btn" + (mode === "week" && offset === 0 ? " active" : "")}
              onClick={() => goPeriod("week", 0)}
            >
              이번 주
            </button>
            <button
              type="button"
              className={"preset-btn" + (mode === "week" && offset === -1 ? " active" : "")}
              onClick={() => goPeriod("week", -1)}
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

          {/* 일별 현황 — 주간/기간 조회에서도 하루 단위 실적이 바로 튀어나오게 */}
          {dailyRows.length >= 2 && (
            <section className="dash-card">
              <div className="dash-card-head">
                <div className="dash-card-title-group">
                  <span className="dash-card-title">일별 현황</span>
                  <span className="dash-card-sub">
                    기간 내 하루 단위 실적 · {dailyRows.length}일 · 복사 텍스트에 포함
                  </span>
                </div>
              </div>
              <div className="dash-card-body">
                <DailyTable rows={dailyRows} />
              </div>
            </section>
          )}

          {/* 일별 기능 구성 — 그날 어떤 기능(액션)이 얼마나 돌았는지 스택 바로 */}
          {dailyRows.length >= 2 && stats.byAction.some((a) => a.key !== "(none)") && (
            <section className="dash-card">
              <div className="dash-card-head">
                <div className="dash-card-title-group">
                  <span className="dash-card-title">일별 기능 구성</span>
                  <span className="dash-card-sub">
                    하루별 액션(ACTION_TYP) 실행 분포 · 막대 길이 = 실행 규모 · 색 = 기능
                  </span>
                </div>
              </div>
              <div className="dash-card-body">
                <DailyActionBreakdown rows={dailyRows} />
              </div>
            </section>
          )}

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
