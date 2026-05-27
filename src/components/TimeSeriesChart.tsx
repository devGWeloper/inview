import { StatsResponse, TimeBucket } from "@/lib/types";

const COLORS = {
  ok:      "var(--ok)",
  fail:    "var(--fail)",
  error:   "var(--err)",
  pending: "var(--text-muted)",
} as const;

function fmtLabel(ts: string, g: StatsResponse["granularity"]): string {
  // ts: 'YYYY-MM-DDTHH:MM:SS'
  if (g === "1d") return ts.slice(5, 10); // MM-DD
  return ts.slice(11, 16); // HH:MM
}

export function TimeSeriesChart({ stats }: { stats: StatsResponse }) {
  const buckets = stats.buckets;
  const maxTotal = Math.max(1, ...buckets.map((b) => b.ok + b.fail + b.error + b.pending));

  const VBW = 1000;
  const VBH = 240;
  const padL = 40;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const innerW = VBW - padL - padR;
  const innerH = VBH - padT - padB;

  const n = Math.max(1, buckets.length);
  const colW = innerW / n;
  const barW = Math.max(2, Math.min(colW - 2, 28));

  // y-axis ticks (4 levels)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxTotal * f));

  // x-axis label sparsity
  const labelStride = Math.max(1, Math.ceil(n / 12));

  const stackOrder: Array<keyof typeof COLORS> = ["ok", "fail", "error", "pending"];

  return (
    <div className="ts-wrap">
      <div className="ts-legend">
        {stackOrder.map((k) => (
          <span key={k} className="ts-legend-item">
            <span className="legend-swatch" style={{ background: COLORS[k] }} />
            {k.toUpperCase()}
          </span>
        ))}
        <span className="ts-legend-spacer" />
        <span className="ts-meta">{buckets.length} buckets · {labelGran(stats.granularity)}</span>
      </div>
      <svg viewBox={`0 0 ${VBW} ${VBH}`} className="ts-svg" preserveAspectRatio="none" role="img" aria-label="traces over time">
        {/* gridlines */}
        {ticks.map((v, i) => {
          const y = padT + innerH - (v / Math.max(1, maxTotal)) * innerH;
          return (
            <g key={i}>
              <line x1={padL} x2={VBW - padR} y1={y} y2={y} className="ts-grid" />
              <text x={padL - 6} y={y + 4} textAnchor="end" className="ts-axis">{v}</text>
            </g>
          );
        })}
        {/* bars */}
        {buckets.map((b, i) => {
          const x = padL + i * colW + (colW - barW) / 2;
          let yCursor = padT + innerH;
          const total = b.ok + b.fail + b.error + b.pending;
          if (total === 0) return null;
          return (
            <g key={i}>
              {stackOrder.map((k) => {
                const v = b[k as keyof TimeBucket] as number;
                if (v <= 0) return null;
                const h = (v / maxTotal) * innerH;
                yCursor -= h;
                return <rect key={k} x={x} y={yCursor} width={barW} height={h} fill={COLORS[k]} />;
              })}
            </g>
          );
        })}
        {/* x labels */}
        {buckets.map((b, i) => {
          if (i % labelStride !== 0 && i !== buckets.length - 1) return null;
          const x = padL + i * colW + colW / 2;
          return (
            <text key={i} x={x} y={VBH - 8} textAnchor="middle" className="ts-axis">
              {fmtLabel(b.ts, stats.granularity)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function labelGran(g: StatsResponse["granularity"]): string {
  return g === "5m" ? "5-min" : g === "1h" ? "hourly" : "daily";
}
