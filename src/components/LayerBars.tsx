"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LAYER_COLOR, LAYER_LABEL, LayerKey, StatsResponse } from "@/lib/types";

const STATUS_COLOR = {
  ok:   "#067647",
  fail: "#b42318",
} as const;

function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

type Row = {
  layer: LayerKey;
  name: string;
  color: string;
  ok: number;
  fail: number;
  total: number;
  avgRespMs: number | null;
  totalLabel: string;
};

function LayerTooltip({ active, payload }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const row: Row = payload[0].payload;
  const pct = (v: number) => row.total > 0 ? (v / row.total) * 100 : 0;
  return (
    <div className="ts-tooltip">
      <div className="ts-tooltip-head">
        <span className="legend-swatch" style={{ background: row.color, marginRight: 6 }} />
        {row.name}
      </div>
      <div className="ts-tooltip-body">
        <div className="ts-tooltip-row two-col">
          <span className="ts-tooltip-key">TOTAL</span>
          <span className="ts-tooltip-val">{row.total.toLocaleString()}</span>
        </div>
        <div className="ts-tooltip-row">
          <span className="ts-tooltip-swatch" style={{ background: STATUS_COLOR.ok }} />
          <span className="ts-tooltip-key">OK</span>
          <span className="ts-tooltip-val">{row.ok.toLocaleString()} ({pct(row.ok).toFixed(1)}%)</span>
        </div>
        <div className="ts-tooltip-row">
          <span className="ts-tooltip-swatch" style={{ background: STATUS_COLOR.fail }} />
          <span className="ts-tooltip-key">FAIL</span>
          <span className="ts-tooltip-val">{row.fail.toLocaleString()} ({pct(row.fail).toFixed(1)}%)</span>
        </div>
        <div className="ts-tooltip-row total">
          <span className="ts-tooltip-key">AVG RESP</span>
          <span className="ts-tooltip-val">{fmtMs(row.avgRespMs)}</span>
        </div>
      </div>
    </div>
  );
}

export function LayerBars({ stats }: { stats: StatsResponse }) {
  const data: Row[] = useMemo(() => stats.layers.map((l) => ({
    layer: l.layer,
    name: LAYER_LABEL[l.layer],
    color: LAYER_COLOR[l.layer],
    ok: l.okRows,
    fail: l.failCount,
    total: l.total,
    avgRespMs: l.avgRespMs,
    totalLabel: `${l.total.toLocaleString()} · ${fmtMs(l.avgRespMs)}`,
  })), [stats.layers]);

  const height = Math.max(180, data.length * 56 + 28);

  return (
    <div className="layer-bars-chart">
      <div className="layer-bars-legend">
        <span className="ts-legend-item"><span className="legend-swatch" style={{ background: STATUS_COLOR.ok }} />OK</span>
        <span className="ts-legend-item"><span className="legend-swatch" style={{ background: STATUS_COLOR.fail }} />FAIL</span>
        <span className="ts-legend-spacer" />
        <span className="ts-meta">stacked rows · avg resp on hover</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 36, left: 8, bottom: 8 }}
          barCategoryGap={14}
        >
          <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: "var(--text-3)", fontSize: 11, fontFamily: "var(--mono)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border-strong)" }}
            allowDecimals={false}
            tickFormatter={(v) => v.toLocaleString()}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={(props: any) => {
              const { x, y, payload, index } = props;
              const row = data[index];
              return (
                <g transform={`translate(${x},${y})`}>
                  <rect x={-110} y={-9} width={4} height={18} rx={2} fill={row?.color ?? "var(--text-muted)"} />
                  <text x={-100} y={4} fill="var(--text)" fontSize={13} fontWeight={600}>{payload.value}</text>
                </g>
              );
            }}
            width={120}
            tickLine={false}
            axisLine={false}
            interval={0}
          />
          <Tooltip
            content={<LayerTooltip />}
            cursor={{ fill: "var(--accent-soft)", opacity: 0.4 }}
          />
          <Bar dataKey="ok"   stackId="s" fill={STATUS_COLOR.ok}   isAnimationActive animationDuration={500} />
          <Bar
            dataKey="fail"
            stackId="s"
            fill={STATUS_COLOR.fail}
            isAnimationActive
            animationDuration={500}
            radius={[0, 4, 4, 0]}
          >
            <LabelList
              dataKey="totalLabel"
              position="right"
              style={{
                fill: "var(--text-2)",
                fontSize: 11,
                fontFamily: "var(--mono)",
                fontWeight: 600,
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
