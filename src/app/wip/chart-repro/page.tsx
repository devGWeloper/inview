"use client";
// TEMP(repro): 30D × 1시간 차트 X축 확인용. 확인 끝나면 지운다.
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { isoNoTz } from "@/lib/timeBuckets";

const N = 720;
const start = Date.parse("2026-08-03T00:00:00");
const buckets = Array.from({ length: N }, (_, i) => {
  const t = start + i * 3_600_000;
  const h = new Date(t).getHours();
  return { ts: isoNoTz(t), ok: 20 + Math.round(30 * Math.sin(i / 9)) + (h === 14 ? 60 : 0), fail: i % 97 === 0 ? 12 : 0, pending: 0 };
});

export default function Repro() {
  return (
    <div className="dash" style={{ padding: 20 }}>
      <h2>30D × 1시간 · {buckets.length} buckets</h2>
      <section className="dash-card dash-card-hero">
        <div className="dash-card-body">
          <TimeSeriesChart stats={{ granularity: "1h" as const, buckets }} />
        </div>
      </section>
    </div>
  );
}
