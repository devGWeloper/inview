"use client";


import { Fragment, useState } from "react";
import { fmtDuration } from "@/lib/format";
import { DailyRow } from "@/lib/dailyRows";

const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return ((n / total) * 100).toFixed(1) + "%";
}

function dayLabel(date: string): { label: string; dow: number } {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return { label: `${pad(m)}/${pad(d)} (${DAY_KO[dow]})`, dow };
}

export function DailyTable({
  rows,
  labelAction,
}: {
  rows: DailyRow[];
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

