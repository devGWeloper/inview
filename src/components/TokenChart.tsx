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
import { TokenBucket, TokenStatsResponse } from "@/lib/types";
import { isBucketInProgress } from "@/lib/timeBuckets";

const SERIES = ["inputTokens", "outputTokens"] as const;
type SeriesKey = typeof SERIES[number];

const SERIES_COLOR: Record<SeriesKey, string> = {
  inputTokens: "#0ea5e9",
  outputTokens: "#a855f7",
};

const SERIES_LABEL: Record<SeriesKey, string> = {
  inputTokens: "INPUT",
  outputTokens: "OUTPUT",
};

type Gran = TokenStatsResponse["granularity"];

function fmtTick(ts: string, g: Gran): string {
  if (g === "1d") return ts.slice(5, 10);
  return ts.slice(11, 16);
}

function fmtFullTs(ts: string, g: Gran): string {
  if (g === "1d") return ts.slice(0, 10);
  return ts.slice(0, 16).replace("T", " ");
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(Math.round(n));
}

// k: 실제 값(툴팁/통계용) · kDone: 완결 구간 실선 · kLive: 집계 중 꼬리(점선, 앵커+마지막 점만)
type Row = { ts: string; tick: string; total: number; calls: number; live?: boolean } &
  Record<SeriesKey, number> &
  Record<`${SeriesKey}Done` | `${SeriesKey}Live`, number | null>;

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
      <div className="ts-tooltip-head">
        {fmtFullTs(row.ts, granularity)}
        {row.live && <span className="ts-tooltip-live">집계 중</span>}
      </div>
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
        <div className="ts-tooltip-row two-col">
          <span className="ts-tooltip-key">CALLS</span>
          <span className="ts-tooltip-val">{row.calls.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

export function TokenChart({ stats }: { stats: TokenStatsResponse }) {
  const granularity = stats.granularity;
  const [hidden, setHidden] = useState<Record<SeriesKey, boolean>>({
    inputTokens: false,
    outputTokens: false,
  });

  // 마지막 버킷이 아직 집계 중이면 그 인덱스 (아니면 -1)
  const liveIdx = useMemo(() => {
    const last = stats.buckets[stats.buckets.length - 1];
    if (!last) return -1;
    return isBucketInProgress(last.ts, granularity) ? stats.buckets.length - 1 : -1;
  }, [stats.buckets, granularity]);

  const data: Row[] = useMemo(
    () =>
      stats.buckets.map((b: TokenBucket, i) => {
        const row = {
          ts: b.ts,
          tick: fmtTick(b.ts, granularity),
          inputTokens: b.inputTokens,
          outputTokens: b.outputTokens,
          total: b.totalTokens,
          calls: b.calls,
          live: i === liveIdx,
        } as Row;
        for (const k of SERIES) {
          row[`${k}Done`] = i === liveIdx ? null : row[k];
          row[`${k}Live`] = liveIdx >= 0 && i >= liveIdx - 1 ? row[k] : null;
        }
        return row;
      }),
    [stats.buckets, granularity, liveIdx]
  );

  const { peakIdx, peakVal, peakTs } = useMemo(() => {
    let pIdx = -1, pVal = 0;
    data.forEach((d, i) => {
      if (!d.live && d.total > pVal) { pVal = d.total; pIdx = i; }
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
        {liveIdx >= 0 && <span className="ts-live-badge">마지막 구간 집계 중</span>}
        <span className="ts-meta">{data.length} buckets · {granText(granularity)}</span>
      </div>

      <div className="ts-chart">
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={data} margin={{ top: 10, right: 18, bottom: 0, left: 0 }}>
            <defs>
              {SERIES.map((k) => (
                <linearGradient key={k} id={`tok-grad-${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES_COLOR[k]} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={SERIES_COLOR[k]} stopOpacity={0.05} />
                </linearGradient>
              ))}
            </defs>
            <XAxis
              dataKey="tick"
              tick={{ fill: "var(--text-2)", fontSize: 13, fontWeight: 600, fontFamily: "var(--mono)" }}
              tickLine={{ stroke: "var(--border-strong)" }}
              axisLine={{ stroke: "var(--border-strong)" }}
              tickMargin={8}
              height={32}
              minTickGap={28}
            />
            <YAxis
              tick={{ fill: "var(--text-2)", fontSize: 13, fontWeight: 600, fontFamily: "var(--mono)" }}
              tickLine={{ stroke: "var(--border-strong)" }}
              axisLine={{ stroke: "var(--border-strong)" }}
              width={52}
              allowDecimals={false}
              tickFormatter={(v) => fmtCompact(Number(v))}
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
                  value: `peak ${fmtCompact(peakVal)}${peakTs ? ` · ${fmtFullTs(peakTs, granularity)}` : ""}`,
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
                dataKey={`${k}Done`}
                name={SERIES_LABEL[k]}
                stackId="tok"
                stroke={SERIES_COLOR[k]}
                strokeWidth={1.4}
                fill={`url(#tok-grad-${k})`}
                hide={hidden[k]}
                isAnimationActive
                animationDuration={500}
                activeDot={{ r: 3, stroke: "var(--surface)", strokeWidth: 1.5 }}
              />
            ))}
            {/* 집계 중 꼬리 — 마지막 완결점→진행 버킷 구간만 점선 + 옅은 채움으로 */}
            {liveIdx >= 0 && SERIES.map((k) => (
              <Area
                key={`${k}-live`}
                type="monotone"
                dataKey={`${k}Live`}
                name={SERIES_LABEL[k]}
                stackId="tokLive"
                stroke={SERIES_COLOR[k]}
                strokeWidth={1.4}
                strokeDasharray="5 4"
                fill={`url(#tok-grad-${k})`}
                fillOpacity={0.45}
                hide={hidden[k]}
                isAnimationActive
                animationDuration={500}
                activeDot={{ r: 3, stroke: "var(--surface)", strokeWidth: 1.5 }}
              />
            ))}
            {data.length > 12 && (
              <Brush
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

function granText(g: Gran): string {
  return g === "5m" ? "5-min" : g === "1h" ? "hourly" : "daily";
}
