"use client";

import { TimeoutReason } from "@/lib/types";

export function ReasonList({ reasons, totalFailed }: { reasons: TimeoutReason[]; totalFailed: number }) {
  return (
    <ol className="rs-list">
      {reasons.map((r, i) => {
        const share = totalFailed > 0 ? (r.failed / totalFailed) * 100 : 0;
        return (
          <li key={`${r.reason}-${i}`} className="rs-item">
            <span className="rs-rank">{i + 1}</span>
            <span className="rs-text" title={r.reason}>{r.reason}</span>
            <span className="rs-stats mono">
              <b>{r.failed.toLocaleString()}</b>
              <span className="rs-stats-sub">{share.toFixed(0)}%</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
