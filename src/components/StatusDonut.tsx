import { StatsResponse } from "@/lib/types";

type Segment = { key: string; label: string; count: number; color: string };

/**
 * SVG 도넛 세그먼트 path 계산.
 * cx, cy: center, rOuter: outer radius, rInner: inner radius
 * a0, a1: start/end angle in radians (0 = 12시 방향)
 */
function arcPath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const sx0 = cx + rOuter * Math.sin(a0);
  const sy0 = cy - rOuter * Math.cos(a0);
  const sx1 = cx + rOuter * Math.sin(a1);
  const sy1 = cy - rOuter * Math.cos(a1);
  const ix0 = cx + rInner * Math.sin(a0);
  const iy0 = cy - rInner * Math.cos(a0);
  const ix1 = cx + rInner * Math.sin(a1);
  const iy1 = cy - rInner * Math.cos(a1);
  return [
    `M ${sx0} ${sy0}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${sx1} ${sy1}`,
    `L ${ix1} ${iy1}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${ix0} ${iy0}`,
    "Z",
  ].join(" ");
}

export function StatusDonut({ stats }: { stats: StatsResponse }) {
  const { totals } = stats;
  const total = totals.total;
  const segs: Segment[] = [
    { key: "ok",      label: "OK",      count: totals.ok,      color: "var(--ok)"   },
    { key: "fail",    label: "FAIL",    count: totals.fail,    color: "var(--fail)" },
    { key: "error",   label: "ERROR",   count: totals.error,   color: "var(--err)"  },
    { key: "pending", label: "PENDING", count: totals.pending, color: "var(--text-muted)" },
  ];

  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = 90;
  const rInner = 58;

  let acc = 0;
  const paths = segs.map((s) => {
    if (s.count <= 0) return null;
    const a0 = (acc / Math.max(1, total)) * 2 * Math.PI;
    acc += s.count;
    const a1 = (acc / Math.max(1, total)) * 2 * Math.PI;
    return { key: s.key, color: s.color, d: arcPath(cx, cy, rOuter, rInner, a0, a1) };
  });

  const okPct = total > 0 ? (totals.ok / total) * 100 : 0;

  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="status distribution">
        <circle cx={cx} cy={cy} r={rOuter} fill="var(--surface-3)" />
        <circle cx={cx} cy={cy} r={rInner} fill="var(--surface)" />
        {paths.map((p) => p && <path key={p.key} d={p.d} fill={p.color} />)}
        <text x={cx} y={cy - 6} textAnchor="middle" className="donut-center-pct">{okPct.toFixed(1)}%</text>
        <text x={cx} y={cy + 14} textAnchor="middle" className="donut-center-label">success</text>
      </svg>
      <div className="donut-legend">
        {segs.map((s) => {
          const p = total > 0 ? (s.count / total) * 100 : 0;
          return (
            <div key={s.key} className="donut-legend-row">
              <span className="legend-swatch" style={{ background: s.color }} />
              <span className="legend-label">{s.label}</span>
              <span className="legend-count">{s.count.toLocaleString()}</span>
              <span className="legend-pct">{p.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
