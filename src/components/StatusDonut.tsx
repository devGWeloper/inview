"use client";

import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Sector, Tooltip } from "recharts";
import { StatsResponse } from "@/lib/types";

type Segment = { key: string; label: string; count: number; color: string };

const SIZE = 220;

function renderActiveShape(props: any) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  return (
    <g>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 6}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        stroke="var(--surface)"
        strokeWidth={2}
      />
    </g>
  );
}

function DonutTooltip({ active, payload, total }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const seg: Segment = payload[0].payload;
  const pct = total > 0 ? (seg.count / total) * 100 : 0;
  return (
    <div className="ts-tooltip">
      <div className="ts-tooltip-head">
        <span className="legend-swatch" style={{ background: seg.color, marginRight: 6 }} />
        {seg.label}
      </div>
      <div className="ts-tooltip-body">
        <div className="ts-tooltip-row">
          <span className="ts-tooltip-key">COUNT</span>
          <span className="ts-tooltip-val">{seg.count.toLocaleString()}</span>
        </div>
        <div className="ts-tooltip-row">
          <span className="ts-tooltip-key">SHARE</span>
          <span className="ts-tooltip-val">{pct.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

export function StatusDonut({ stats }: { stats: StatsResponse }) {
  const { totals } = stats;
  const total = totals.total;
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const segs: Segment[] = useMemo(() => ([
    { key: "ok",      label: "OK",      count: totals.ok,      color: "#067647" },
    { key: "fail",    label: "FAIL",    count: totals.fail,    color: "#c2410c" },
    { key: "error",   label: "ERROR",   count: totals.error,   color: "#b42318" },
    { key: "pending", label: "PENDING", count: totals.pending, color: "#8a94a6" },
  ]), [totals]);

  const visible = segs.filter((s) => s.count > 0);
  const okPct = total > 0 ? (totals.ok / total) * 100 : 0;
  const pieData = visible.length > 0
    ? visible
    : [{ key: "empty", label: "—", count: 1, color: "var(--surface-3)" }];

  const pieProps: any = {
    data: pieData,
    dataKey: "count",
    nameKey: "label",
    cx: "50%",
    cy: "50%",
    innerRadius: 62,
    outerRadius: 92,
    paddingAngle: visible.length > 1 ? 2 : 0,
    stroke: "var(--surface)",
    strokeWidth: 2,
    activeShape: renderActiveShape,
    onMouseEnter: (entry: any) => setHoverKey(entry?.key ?? null),
    onMouseLeave: () => setHoverKey(null),
    isAnimationActive: true,
    animationDuration: 550,
  };

  return (
    <div className="donut-wrap">
      <div className="donut-chart" style={{ width: SIZE, height: SIZE, position: "relative" }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie {...pieProps}>
              {pieData.map((s, i) => (
                <Cell key={i} fill={s.color} />
              ))}
            </Pie>
            <Tooltip content={<DonutTooltip total={total} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center" aria-hidden>
          <div className="donut-center-pct">{okPct.toFixed(1)}%</div>
          <div className="donut-center-label">success</div>
        </div>
      </div>
      <div className="donut-legend">
        {segs.map((s) => {
          const p = total > 0 ? (s.count / total) * 100 : 0;
          const isActive = hoverKey === s.key;
          return (
            <div
              key={s.key}
              className={"donut-legend-row" + (isActive ? " active" : "")}
              onMouseEnter={() => setHoverKey(s.key)}
              onMouseLeave={() => setHoverKey(null)}
            >
              <span className="legend-swatch" style={{ background: s.color }} />
              <span className="legend-label">{s.label}</span>
              <span className="legend-count">{s.count.toLocaleString()}</span>
              <span className="legend-pct">{p.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
