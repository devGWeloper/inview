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
import { StatsResponse, TimeBucket } from "@/lib/types";

const STATUS_KEYS = ["ok", "fail", "pending"] as const;
type StatusKey = typeof STATUS_KEYS[number];

const STATUS_COLOR: Record<StatusKey, string> = {
  ok:      "#067647",
  fail:    "#b42318",
  pending: "#8a94a6",
};

const STATUS_LABEL: Record<StatusKey, string> = {
  ok:      "OK",
  fail:    "FAIL",
  pending: "PENDING",
};

function fmtTick(ts: string, g: StatsResponse["granularity"]): string {
  if (g === "1d") return ts.slice(5, 10);
  return ts.slice(11, 16);
}

function fmtFullTs(ts: string, g: StatsResponse["granularity"]): string {
  if (g === "1d") return ts.slice(0, 10);
  return ts.slice(0, 16).replace("T", " ");
}

type Row = { ts: string; tick: string; total: number } & Record<StatusKey, number>;

function CustomTooltip({
  active, payload, label, granularity,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; dataKey: string; payload: Row }>;
  label?: string;
  granularity: StatsResponse["granularity"];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const fullTs = fmtFullTs(row.ts, granularity);
  return (
    <div className="ts-tooltip">
      <div className="ts-tooltip-head">{fullTs}</div>
      <div className="ts-tooltip-body">
        {STATUS_KEYS.map((k) => {
          const v = row[k] ?? 0;
          if (v === 0) return null;
          return (
            <div key={k} className="ts-tooltip-row">
              <span className="ts-tooltip-swatch" style={{ background: STATUS_COLOR[k] }} />
              <span className="ts-tooltip-key">{STATUS_LABEL[k]}</span>
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

export function TimeSeriesChart({ stats }: { stats: StatsResponse }) {
  const granularity = stats.granularity;
  const [hidden, setHidden] = useState<Record<StatusKey, boolean>>({
    ok: false, fail: false, pending: false,
  });

  const data: Row[] = useMemo(() => {
    return stats.buckets.map((b: TimeBucket) => ({
      ts: b.ts,
      tick: fmtTick(b.ts, granularity),
      ok: b.ok,
      fail: b.fail,
      pending: b.pending,
      total: b.ok + b.fail + b.pending,
    }));
  }, [stats.buckets, granularity]);

  const { peakIdx, peakVal, peakTs, avgSuccess } = useMemo(() => {
    let pIdx = -1, pVal = 0, totalAll = 0, okAll = 0;
    data.forEach((d, i) => {
      if (d.total > pVal) { pVal = d.total; pIdx = i; }
      totalAll += d.total;
      okAll += d.ok;
    });
    return {
      peakIdx: pIdx,
      peakVal: pVal,
      peakTs: pIdx >= 0 ? data[pIdx].ts : null,
      avgSuccess: totalAll > 0 ? (okAll / totalAll) * 100 : null,
    };
  }, [data]);

  const toggle = (k: StatusKey) =>
    setHidden((h) => ({ ...h, [k]: !h[k] }));

  return (
    <div className="ts-wrap">
      <div className="ts-legend">
        {STATUS_KEYS.map((k) => (
          <button
            type="button"
            key={k}
            className={"ts-legend-item" + (hidden[k] ? " off" : "")}
            onClick={() => toggle(k)}
            aria-pressed={!hidden[k]}
          >
            <span className="legend-swatch" style={{ background: STATUS_COLOR[k] }} />
            {STATUS_LABEL[k]}
          </button>
        ))}
        <span className="ts-legend-spacer" />
        {avgSuccess !== null && (
          <span className="ts-meta">avg success {avgSuccess.toFixed(1)}%</span>
        )}
        <span className="ts-meta">
          {data.length} buckets · {granText(granularity)}
        </span>
      </div>

      <div className="ts-chart">
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart
            data={data}
            margin={{ top: 10, right: 18, bottom: 0, left: 0 }}
          >
            <defs>
              {STATUS_KEYS.map((k) => (
                <linearGradient key={k} id={`ts-grad-${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"  stopColor={STATUS_COLOR[k]} stopOpacity={k === "pending" ? 0.18 : 0.55} />
                  <stop offset="100%" stopColor={STATUS_COLOR[k]} stopOpacity={0.05} />
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
              tickFormatter={(v) => v.toLocaleString()}
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
            {STATUS_KEYS.map((k) => (
              <Area
                key={k}
                type="monotone"
                dataKey={k}
                name={STATUS_LABEL[k]}
                stackId="status"
                stroke={STATUS_COLOR[k]}
                strokeWidth={k === "ok" ? 1.8 : 1}
                fill={`url(#ts-grad-${k})`}
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

function granText(g: StatsResponse["granularity"]): string {
  return g === "5m" ? "5-min" : g === "1h" ? "hourly" : "daily";
}
