import { StatsResponse } from "@/lib/types";

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return ((n / total) * 100).toFixed(1) + "%";
}

function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function StatsCards({ stats }: { stats: StatsResponse }) {
  const { totals, avgLatencyMs } = stats;
  const total = totals.total;
  return (
    <div className="kpi-grid">
      <Card title="Total Traces" value={total.toLocaleString()} tone="default" sub={`${stats.rowCount.toLocaleString()} rows`} />
      <Card title="Success Rate" value={pct(totals.ok, total)} tone="ok" sub={`${totals.ok.toLocaleString()} OK`} />
      <Card title="Fail Rate"    value={pct(totals.fail, total)} tone="fail" sub={`${totals.fail.toLocaleString()} FAIL`} />
      <Card title="Error Rate"   value={pct(totals.error, total)} tone="err" sub={`${totals.error.toLocaleString()} ERROR`} />
      <Card title="Pending"      value={pct(totals.pending, total)} tone="warn" sub={`${totals.pending.toLocaleString()} PENDING`} />
      <Card title="Avg Latency"  value={fmtMs(avgLatencyMs)} tone="default" sub="trace end-to-end" />
    </div>
  );
}

function Card({
  title, value, sub, tone,
}: { title: string; value: string; sub: string; tone: "default" | "ok" | "fail" | "err" | "warn" }) {
  return (
    <div className={`kpi-card tone-${tone}`}>
      <div className="kpi-title">{title}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}
