import { StatsResponse, TimeBucket } from "@/lib/types";

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return ((n / total) * 100).toFixed(1) + "%";
}

function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function Sparkline({
  values, color, fillOpacity = 0.16,
}: { values: number[]; color: string; fillOpacity?: number }) {
  const n = values.length;
  if (n === 0) return null;
  const w = 120;
  const h = 34;
  const max = Math.max(1, ...values);
  const step = n === 1 ? 0 : w / (n - 1);
  const pts: [number, number][] = values.map((v, i) => {
    const x = n === 1 ? w / 2 : i * step;
    const y = h - (v / max) * (h - 2) - 1;
    return [x, y];
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${w.toFixed(2)},${h} L0,${h} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="kpi-spark"
      aria-hidden
    >
      <path d={area} fill={color} opacity={fillOpacity} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function StatsCards({ stats }: { stats: StatsResponse }) {
  const { totals, avgLatencyMs, buckets } = stats;
  const total = totals.total;
  const failures = totals.fail + totals.error;
  const successRate = total > 0 ? (totals.ok / total) * 100 : 0;

  const totalSpark   = buckets.map((b: TimeBucket) => b.ok + b.fail + b.error + b.pending);
  const okSpark      = buckets.map((b: TimeBucket) => b.ok);
  const failSpark    = buckets.map((b: TimeBucket) => b.fail + b.error);
  const peakValue    = Math.max(0, ...totalSpark);

  return (
    <div className="kpi-grid">
      <HeroCard
        title="Total Traces"
        value={total.toLocaleString()}
        sub={`peak ${peakValue.toLocaleString()} / ${granLabel(stats.granularity)}`}
        spark={totalSpark}
        color="var(--accent)"
        tone="default"
      />
      <HeroCard
        title="Success Rate"
        value={pct(totals.ok, total)}
        sub={`${totals.ok.toLocaleString()} OK`}
        spark={okSpark}
        color="var(--ok)"
        tone="ok"
      />
      <HeroCard
        title="Failures"
        value={failures.toLocaleString()}
        sub={`${totals.fail.toLocaleString()} fail · ${totals.error.toLocaleString()} error`}
        spark={failSpark}
        color="var(--err)"
        tone={failures > 0 ? "err" : "default"}
      />
      <HeroCard
        title="Avg Latency"
        value={fmtMs(avgLatencyMs)}
        sub={totals.pending > 0 ? `${totals.pending.toLocaleString()} pending` : "trace end-to-end"}
        color="var(--accent)"
        tone={totals.pending > 0 ? "warn" : "default"}
      />
    </div>
  );
}

function granLabel(g: StatsResponse["granularity"]): string {
  return g === "5m" ? "5m" : g === "1h" ? "hr" : "day";
}

function HeroCard({
  title, value, sub, spark, color, tone,
}: {
  title: string;
  value: string;
  sub: string;
  spark?: number[];
  color: string;
  tone: "default" | "ok" | "fail" | "err" | "warn";
}) {
  return (
    <div className={`kpi-card tone-${tone}`}>
      <div className="kpi-title">{title}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
      {spark && spark.length > 0 && (
        <div className="kpi-spark-wrap">
          <Sparkline values={spark} color={color} />
        </div>
      )}
    </div>
  );
}
