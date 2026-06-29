import { TokenBucket, TokenStatsResponse } from "@/lib/types";

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString();
}

// 큰 토큰 수를 읽기 쉽게 (1.2M / 340K). 카드 메인 값에 사용.
function fmtCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + "K";
  return String(Math.round(n));
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
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="kpi-spark" aria-hidden>
      <path d={area} fill={color} opacity={fillOpacity} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function TokenStatsCards({ stats }: { stats: TokenStatsResponse }) {
  const { totals, avgTotalPerCall, buckets, granularity } = stats;

  const totalSpark = buckets.map((b: TokenBucket) => b.totalTokens);
  const inputSpark = buckets.map((b: TokenBucket) => b.inputTokens);
  const outputSpark = buckets.map((b: TokenBucket) => b.outputTokens);
  const callsSpark = buckets.map((b: TokenBucket) => b.calls);
  const peak = Math.max(0, ...totalSpark);

  return (
    <div className="kpi-grid">
      <Card
        title="Total Tokens"
        value={fmtCompact(totals.totalTokens)}
        sub={`peak ${fmtCompact(peak)} / ${granLabel(granularity)}`}
        spark={totalSpark}
        color="var(--accent)"
        tone="default"
      />
      <Card
        title="Input Tokens"
        value={fmtCompact(totals.inputTokens)}
        sub={`입력 · ${pct(totals.inputTokens, totals.totalTokens)}`}
        spark={inputSpark}
        color="#0ea5e9"
        tone="default"
      />
      <Card
        title="Output Tokens"
        value={fmtCompact(totals.outputTokens)}
        sub={`출력 · ${pct(totals.outputTokens, totals.totalTokens)}`}
        spark={outputSpark}
        color="#a855f7"
        tone="default"
      />
      <Card
        title="LLM Calls"
        value={fmtInt(totals.calls)}
        sub={avgTotalPerCall !== null ? `평균 ${fmtInt(avgTotalPerCall)} tok/call` : "호출 없음"}
        spark={callsSpark}
        color="var(--ok)"
        tone="default"
      />
    </div>
  );
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return ((n / total) * 100).toFixed(1) + "%";
}

function granLabel(g: TokenStatsResponse["granularity"]): string {
  return g === "5m" ? "5m" : g === "1h" ? "hr" : "day";
}

function Card({
  title, value, sub, spark, color, tone,
}: {
  title: string;
  value: string;
  sub: string;
  spark?: number[];
  color: string;
  tone: "default" | "ok" | "err" | "warn";
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
