"use client";

// ─────────────────────────────────────────────────────────────────────────────
// 일별 현황 표 — /report 와 /insights 가 공유한다.
//
// 원래 report/page.tsx 안에 있었는데, 일반 사용자 실적 화면(/insights)이 같은 표를 그대로
// 써야 해서 컴포넌트로 뺐다. 두 벌로 두면 한쪽만 고쳐져 같은 기간인데 다른 표가 된다.
// 행 클릭 = 그날의 기능(액션)별 상세 펼침, "전체 펼치기" 로 한 번에 열고 닫는다.
// ─────────────────────────────────────────────────────────────────────────────

import { Fragment, useState } from "react";
import { fmtDuration } from "@/components/TokenLatencyChart";
import { DailyActionStat, TokenBucket } from "@/lib/types";

const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return ((n / total) * 100).toFixed(1) + "%";
}

// ── 일별 브레이크다운 ─────────────────────────────────────────────────────────
// 주간(또는 며칠짜리 직접 설정) 조회에서도 하루 단위 실적이 바로 보이도록,
// stats.daily(서버 집계)에 토큰(tok.buckets 를 날짜로 합산)을 붙여 하나의 행으로 만든다.
// 화면의 "일별 현황" 표와 복사 텍스트의 [일별 현황] 이 같은 데이터를 쓴다.
export interface DailyRow {
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

/** 서버가 내려주는 일별 집계 (StatsResponse.daily / InsightsResponse.daily 공용) */
export type DailySource = Omit<DailyRow, "tokens" | "llmCalls">;

export function mergeDailyRows(
  stats: { daily?: DailySource[] | null } | null,
  tok: { buckets: TokenBucket[] } | null
): DailyRow[] {
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

// ── 일별 현황 표 (주간/기간 조회 시 하루 단위 실적이 바로 보이도록) ─────────────
// 날짜 행을 클릭하면 그날의 기능(액션)별 상세가 아래로 펼쳐진다. "전체 펼치기/접기"로 한 번에 열고 닫아
// 대시보드 등에 통째로 복사·붙여넣기 하기 좋게 했다.
export function DailyTable({
  rows,
  labelAction,
}: {
  rows: DailyRow[];
  /** 기능(ACTION_TYP) 코드 → 표시 이름. 생략하면 코드 그대로 (리포트 화면 기본) */
  labelAction?: (key: string) => string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const maxTotal = Math.max(1, ...rows.map((r) => r.total));
  const peakDate =
    rows.reduce<DailyRow | null>((p, r) => (r.total > 0 && r.total > (p?.total ?? 0) ? r : p), null)?.date ?? null;
  const sum = rows.reduce(
    (a, r) => ({ total: a.total + r.total, ok: a.ok + r.ok, fail: a.fail + r.fail, tokens: a.tokens + r.tokens }),
    { total: 0, ok: 0, fail: 0, tokens: 0 }
  );

  const expandableDates = rows.filter((r) => r.byAction.length > 0).map((r) => r.date);
  const allExpanded = expandableDates.length > 0 && expandableDates.every((d) => expanded.has(d));

  const toggle = (date: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };
  const toggleAll = () => {
    setExpanded(allExpanded ? new Set() : new Set(expandableDates));
  };

  return (
    <div className="daily-table-wrap">
      {expandableDates.length > 0 && (
        <div className="daily-toolbar">
          <span className="daily-toolbar-hint">날짜를 누르면 기능별 상세가 열립니다</span>
          <button type="button" className="btn ghost sm" onClick={toggleAll}>
            {allExpanded ? "▲ 전체 접기" : "▼ 전체 펼치기"}
          </button>
        </div>
      )}
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
            const canExpand = r.byAction.length > 0;
            const isOpen = expanded.has(r.date);
            return (
              <Fragment key={r.date}>
                <tr
                  className={(empty ? "empty" : "") + (canExpand ? " expandable" : "") + (isOpen ? " open" : "")}
                  onClick={canExpand ? () => toggle(r.date) : undefined}
                >
                  <td className={`daily-date dow-${dow}`}>
                    <span className="daily-caret" aria-hidden>{canExpand ? (isOpen ? "▾" : "▸") : ""}</span>
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
                {canExpand && isOpen &&
                  r.byAction.map((a, i) => {
                    const last = i === r.byAction.length - 1;
                    return (
                      <tr key={`${r.date}::${a.key}`} className={"daily-sub" + (last ? " last" : "")}>
                        <td className="daily-sub-key" title={a.key}>{labelAction ? labelAction(a.key) : a.key}</td>
                        <td className="num">{a.total.toLocaleString()}</td>
                        <td className="num ok">{a.ok > 0 ? a.ok.toLocaleString() : "-"}</td>
                        <td className={"num" + (a.fail > 0 ? " err" : "")}>{a.fail > 0 ? a.fail.toLocaleString() : "-"}</td>
                        <td className="num">{a.total > 0 ? pct(a.ok, a.total) : "-"}</td>
                        <td className="num daily-sub-na" />
                        <td className="num daily-sub-na" />
                        <td className="num daily-sub-na" />
                      </tr>
                    );
                  })}
              </Fragment>
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

