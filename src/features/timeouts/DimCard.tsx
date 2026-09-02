"use client";

import { TimeoutDimStat } from "@/lib/types";

const pct = (n: number, total: number): string => (total > 0 ? ((n / total) * 100).toFixed(1) + "%" : "—");

export function DimCard({
  title, sub, dims, selected, onSelect,
}: {
  title: string;
  sub: string;
  dims: TimeoutDimStat[];
  selected?: string;
  onSelect?: (key: string) => void;
}) {
  const max = Math.max(1, ...dims.map((d) => d.failed));
  return (
    <section className="dash-card">
      <div className="dash-card-head">
        <div className="dash-card-title-group">
          <span className="dash-card-title">{title}</span>
          <span className="dash-card-sub">{sub}</span>
        </div>
      </div>
      <div className="dash-card-body">
        {dims.length === 0 ? (
          <div className="top-empty">데이터 없음</div>
        ) : (
          <div className="to-dims">
            {dims.map((d) => (
              <button
                key={d.key}
                type="button"
                className={"to-dim" + (selected === d.key ? " active" : "")}
                onClick={onSelect ? () => onSelect(d.key) : undefined}
                disabled={!onSelect}
                title={`실패 ${d.failed.toLocaleString()} / 전체 호출 ${d.calls.toLocaleString()} · 타임아웃 ${d.timeout.toLocaleString()}`}
              >
                <span className="to-dim-key">{d.key}</span>
                {/* 막대는 추이 차트와 같은 색 규칙 — 타임아웃(진한 빨강) + LLM 오류(앰버) */}
                <span className="to-dim-bar">
                  <span className="seg-t" style={{ width: `${(d.timeout / max) * 100}%` }} />
                  <span className="seg-o" style={{ width: `${(Math.max(0, d.failed - d.timeout) / max) * 100}%` }} />
                </span>
                <span className="to-dim-val mono">{d.failed.toLocaleString()}</span>
                <span className="to-dim-rate mono">{pct(d.failed, d.calls)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
