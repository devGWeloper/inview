import { StatsResponse, TimeBucket } from "@/lib/types";

const COLORS = {
  ok:      "var(--ok)",
  fail:    "var(--fail)",
  error:   "var(--err)",
  pending: "var(--text-muted)",
} as const;

type StackKey = keyof typeof COLORS;

function fmtLabel(ts: string, g: StatsResponse["granularity"]): string {
  if (g === "1d") return ts.slice(5, 10);
  return ts.slice(11, 16);
}

function fmtTooltipTs(ts: string, g: StatsResponse["granularity"]): string {
  if (g === "1d") return ts.slice(0, 10);
  return ts.slice(0, 16).replace("T", " ");
}

function totalOf(b: TimeBucket): number {
  return b.ok + b.fail + b.error + b.pending;
}

export function TimeSeriesChart({ stats }: { stats: StatsResponse }) {
  const buckets = stats.buckets;
  const n = buckets.length;

  const VBW = 1000;
  const VBH = 280;
  const padL = 48;
  const padR = 18;
  const padT = 18;
  const padB = 32;
  const innerW = VBW - padL - padR;
  const innerH = VBH - padT - padB;

  const totals = buckets.map(totalOf);
  const maxTotal = Math.max(1, ...totals);
  const peakIdx = totals.reduce((mi, v, i, a) => (v > a[mi] ? i : mi), 0);
  const peakVal = totals[peakIdx] ?? 0;

  const xAt = (i: number) =>
    padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) =>
    padT + innerH - (v / maxTotal) * innerH;

  // Stacked tops (cumulative). Order from bottom to top.
  const stackOrder: StackKey[] = ["ok", "fail", "error", "pending"];
  const cumulative = buckets.map(() => 0);
  const layers = stackOrder.map((k) => {
    const bottom = cumulative.slice();
    const top: number[] = [];
    for (let i = 0; i < n; i++) {
      cumulative[i] += buckets[i][k] ?? 0;
      top.push(cumulative[i]);
    }
    return { key: k, top, bottom };
  });

  // Build closed area path for each stacked layer.
  const areaPath = (top: number[], bottom: number[]): string => {
    if (top.length === 0) return "";
    const segs: string[] = [];
    for (let i = 0; i < top.length; i++) {
      segs.push(`${i === 0 ? "M" : "L"}${xAt(i).toFixed(2)},${yAt(top[i]).toFixed(2)}`);
    }
    for (let i = bottom.length - 1; i >= 0; i--) {
      segs.push(`L${xAt(i).toFixed(2)},${yAt(bottom[i]).toFixed(2)}`);
    }
    segs.push("Z");
    return segs.join(" ");
  };

  // Top-of-stack outline (success volume line) — gives the chart a clean "trend line" look.
  const okLine = buckets
    .map((b, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(2)},${yAt(b.ok).toFixed(2)}`)
    .join(" ");

  // Y-axis ticks (4 evenly spaced)
  const tickValues = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxTotal * f));
  const uniqueTicks = Array.from(new Set(tickValues));

  // x-label sparsity
  const labelStride = Math.max(1, Math.ceil(n / 10));

  const successRateAvg = (() => {
    const tot = totals.reduce((a, b) => a + b, 0);
    if (tot === 0) return null;
    const ok = buckets.reduce((a, b) => a + b.ok, 0);
    return (ok / tot) * 100;
  })();

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
        {successRateAvg !== null && (
          <span className="ts-meta">avg success {successRateAvg.toFixed(1)}%</span>
        )}
        <span className="ts-meta">
          {buckets.length} buckets · {granText(stats.granularity)}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${VBW} ${VBH}`}
        className="ts-svg"
        preserveAspectRatio="none"
        role="img"
        aria-label="traces over time"
      >
        <defs>
          <linearGradient id="ts-grad-ok" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--ok)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--ok)" stopOpacity="0.04" />
          </linearGradient>
        </defs>

        {/* y-grid */}
        {uniqueTicks.map((v, i) => {
          const y = yAt(v);
          return (
            <g key={i}>
              <line x1={padL} x2={VBW - padR} y1={y} y2={y} className="ts-grid" />
              <text x={padL - 8} y={y + 4} textAnchor="end" className="ts-axis">
                {v.toLocaleString()}
              </text>
            </g>
          );
        })}

        {/* baseline */}
        <line
          x1={padL}
          x2={VBW - padR}
          y1={padT + innerH}
          y2={padT + innerH}
          className="ts-axis-line"
        />

        {/* stacked areas — ok rendered with gradient, others as flat tints */}
        {layers.map((L) => {
          const d = areaPath(L.top, L.bottom);
          if (!d) return null;
          if (L.key === "ok") {
            return (
              <path
                key={L.key}
                d={d}
                fill="url(#ts-grad-ok)"
                stroke="none"
              />
            );
          }
          return (
            <path
              key={L.key}
              d={d}
              fill={COLORS[L.key]}
              fillOpacity={L.key === "pending" ? 0.18 : 0.55}
              stroke="none"
            />
          );
        })}

        {/* success volume top line */}
        {okLine && (
          <path
            d={okLine}
            fill="none"
            stroke="var(--ok)"
            strokeWidth={1.8}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* peak marker */}
        {peakVal > 0 && n > 0 && (
          <g className="ts-peak">
            <line
              x1={xAt(peakIdx)}
              x2={xAt(peakIdx)}
              y1={padT}
              y2={padT + innerH}
              strokeDasharray="3 4"
            />
            <circle cx={xAt(peakIdx)} cy={yAt(peakVal)} r={4} />
            <g transform={`translate(${xAt(peakIdx) + 8}, ${Math.max(padT + 10, yAt(peakVal))})`}>
              <rect x={0} y={-12} rx={4} ry={4} width={peakLabelWidth(peakVal, stats.granularity, buckets[peakIdx]?.ts)} height={22} />
              <text x={8} y={3} className="ts-peak-text">
                peak {peakVal.toLocaleString()} · {fmtTooltipTs(buckets[peakIdx].ts, stats.granularity)}
              </text>
            </g>
          </g>
        )}

        {/* x labels */}
        {buckets.map((b, i) => {
          if (i % labelStride !== 0 && i !== buckets.length - 1) return null;
          const x = xAt(i);
          return (
            <text key={i} x={x} y={VBH - 10} textAnchor="middle" className="ts-axis">
              {fmtLabel(b.ts, stats.granularity)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function granText(g: StatsResponse["granularity"]): string {
  return g === "5m" ? "5-min" : g === "1h" ? "hourly" : "daily";
}

function peakLabelWidth(v: number, g: StatsResponse["granularity"], ts?: string): number {
  const tsTxt = ts ? (g === "1d" ? ts.slice(0, 10) : ts.slice(0, 16).replace("T", " ")) : "";
  const text = `peak ${v.toLocaleString()} · ${tsTxt}`;
  return Math.max(80, text.length * 6.6 + 16);
}
