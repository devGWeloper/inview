"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Brush,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TimeoutBucket, TimeoutStatsResponse } from "@/lib/types";
import { granularityLabel, tickAxis } from "@/lib/timeBuckets";

const SERIES = ["timeout", "other"] as const;
type SeriesKey = typeof SERIES[number];

const SERIES_COLOR: Record<SeriesKey, string> = {
  timeout: "#b42318",
  other:   "#d97706",
};

const SERIES_LABEL: Record<SeriesKey, string> = {
  timeout: "타임아웃",
  other:   "LLM 오류",
};

type Gran = TimeoutStatsResponse["granularity"];

export type TimeoutSeries = { granularity: Gran; buckets: TimeoutBucket[] };


function fmtFullTs(ts: string, g: Gran): string {
  if (g === "1d") return ts.slice(0, 10);
  return ts.slice(0, 16).replace("T", " ");
}

type Row = { ts: string; tick: string; total: number } & Record<SeriesKey, number>;

function CustomTooltip({
  active, payload, granularity,
}: {
  active?: boolean;
  payload?: Array<{ payload: Row }>;
  granularity: Gran;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <div className="ts-tooltip">
      <div className="ts-tooltip-head">{fmtFullTs(row.ts, granularity)}</div>
      <div className="ts-tooltip-body">
        {SERIES.map((k) => {
          const v = row[k] ?? 0;
          if (v === 0) return null;
          return (
            <div key={k} className="ts-tooltip-row">
              <span className="ts-tooltip-swatch" style={{ background: SERIES_COLOR[k] }} />
              <span className="ts-tooltip-key">{SERIES_LABEL[k]}</span>
              <span className="ts-tooltip-val">{v.toLocaleString()}</span>
            </div>
          );
        })}
        <div className="ts-tooltip-row total">
          <span className="ts-tooltip-key">TOTAL</span>
          <span className="ts-tooltip-val">{row.total.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

export function TimeoutTrendChart({ stats }: { stats: TimeoutSeries }) {
  const granularity = stats.granularity;
  // 눈금 key 는 유일해야 하고(안 그러면 라벨이 날마다 되돌아온다) 보이는 글자는 짧아야 한다.
  const axis = useMemo(
    () => tickAxis(stats.buckets.map((b) => b.ts), granularity),
    [stats.buckets, granularity]
  );
  const [hidden, setHidden] = useState<Record<SeriesKey, boolean>>({
    timeout: false,
    other: false,
  });

  const data: Row[] = useMemo(
    () =>
      stats.buckets.map((b: TimeoutBucket) => ({
        ts: b.ts,
        tick: axis.key(b.ts),
        timeout: b.timeout,
        other: Math.max(0, b.failed - b.timeout),
        total: b.failed,
      })),
    [stats.buckets, axis]
  );

  const { peakIdx, peakVal, peakTs } = useMemo(() => {
    let pIdx = -1, pVal = 0;
    data.forEach((d, i) => {
      if (d.total > pVal) { pVal = d.total; pIdx = i; }
    });
    return { peakIdx: pIdx, peakVal: pVal, peakTs: pIdx >= 0 ? data[pIdx].ts : null };
  }, [data]);

  const toggle = (k: SeriesKey) => setHidden((h) => ({ ...h, [k]: !h[k] }));

  return (
    <div className="ts-wrap">
      <div className="ts-legend">
        {SERIES.map((k) => (
          <button
            type="button"
            key={k}
            className={"ts-legend-item" + (hidden[k] ? " off" : "")}
            onClick={() => toggle(k)}
            aria-pressed={!hidden[k]}
          >
            <span className="legend-swatch" style={{ background: SERIES_COLOR[k] }} />
            {SERIES_LABEL[k]}
          </button>
        ))}
        <span className="ts-legend-spacer" />
        <span className="ts-meta">{data.length} buckets · {granularityLabel(granularity)}</span>
      </div>

      <div className="ts-chart">
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={data} margin={{ top: 10, right: 18, bottom: 0, left: 0 }}>
            <defs>
              {SERIES.map((k) => (
                <linearGradient key={k} id={`to-grad-${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES_COLOR[k]} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={SERIES_COLOR[k]} stopOpacity={0.05} />
                </linearGradient>
              ))}
            </defs>
            <XAxis
              dataKey="tick"
              ticks={axis.ticks}
              tickFormatter={axis.short}
              tick={{ fill: "var(--text-2)", fontSize: 13, fontWeight: 600, fontFamily: "var(--mono)" }}
              tickLine={{ stroke: "var(--border-strong)" }}
              axisLine={{ stroke: "var(--border-strong)" }}
              tickMargin={8}
              height={32}
            />
            <YAxis
              tick={{ fill: "var(--text-2)", fontSize: 13, fontWeight: 600, fontFamily: "var(--mono)" }}
              tickLine={{ stroke: "var(--border-strong)" }}
              axisLine={{ stroke: "var(--border-strong)" }}
              width={52}
              allowDecimals={false}
              tickFormatter={(v) => Number(v).toLocaleString()}
            />
            <Tooltip
              content={<CustomTooltip granularity={granularity} />}
              cursor={{ stroke: "var(--accent)", strokeDasharray: "3 3", strokeOpacity: 0.4 }}
            />
            {peakIdx >= 0 && peakVal > 0 && (
              <ReferenceLine
                x={data[peakIdx].tick}
                stroke="var(--text-muted)"
                strokeDasharray="3 4"
                label={{
                  value: `peak ${peakVal.toLocaleString()}${peakTs ? ` · ${fmtFullTs(peakTs, granularity)}` : ""}`,
                  position: "insideTopRight",
                  fill: "var(--text)",
                  fontSize: 12.5,
                  fontFamily: "var(--mono)",
                  fontWeight: 700,
                }}
              />
            )}
            {SERIES.map((k) => (
              <Area
                key={k}
                type="monotone"
                dataKey={k}
                name={SERIES_LABEL[k]}
                stackId="to"
                stroke={SERIES_COLOR[k]}
                strokeWidth={k === "timeout" ? 1.8 : 1.2}
                fill={`url(#to-grad-${k})`}
                hide={hidden[k]}
                isAnimationActive
                animationDuration={500}
                activeDot={{ r: 3, stroke: "var(--surface)", strokeWidth: 1.5 }}
              />
            ))}
            {/* key = 구간이 달라졌을 때만 remount. 없으면 recharts 내부 state 에 예전 표시 구간이 남는다. */}
            {data.length > 12 && (
              <Brush
                key={data.length + ":" + (data[0]?.tick ?? "")}
                dataKey="tick"
                height={22}
                stroke="var(--accent)"
                fill="var(--surface-2)"
                travellerWidth={8}
                tickFormatter={() => ""}
              />
            )}
            <Legend content={() => null} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

