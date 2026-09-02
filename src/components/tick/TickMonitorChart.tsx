"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Brush,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TickMinute } from "@/lib/types";


export type TickSlot = "a" | "b";

const ROLL_COLOR = "#2563eb";
const ROLL_OVER_COLOR = "#b42318";

export function fmtCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + "K";
  return String(Math.round(n));
}

const hhmm = (ts: string) => ts.slice(11, 16);
const hhmmss = (ts: string) => ts.slice(11, 19);

export function windowLabel(startTs: string | null): string | null {
  if (!startTs) return null;
  const ms = Date.parse(startTs);
  if (!Number.isFinite(ms)) return null;
  const end = new Date(ms + 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${hhmmss(startTs)} ~ ${pad(end.getHours())}:${pad(end.getMinutes())}:${pad(end.getSeconds())}`;
}

type Row = {
  ts: string;
  tick: string;
  roll: number;
  window: string | null;
  over: boolean;
};

export function toRows(minutes: TickMinute[], slot: TickSlot, limit: number): Row[] {
  return minutes.map((m) => {
    const roll = slot === "a" ? m.rollA : m.rollB;
    const at = slot === "a" ? m.rollAAt : m.rollBAt;
    return {
      ts: m.ts,
      tick: hhmm(m.ts),
      roll,
      window: windowLabel(at),
      over: limit > 0 && roll > limit,
    };
  });
}

function TickTooltip({
  active, payload, label, unit, limit,
}: {
  active?: boolean;
  payload?: Array<{ payload: Row }>;
  label: string;
  unit: string;
  limit: number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const pct = limit > 0 ? Math.round((row.roll / limit) * 100) : null;
  return (
    <div className="ts-tooltip">
      {/* 제목이 곧 이 값이 측정된 60초 구간 — 별도 라벨을 두지 않는다 */}
      <div className="ts-tooltip-head">{row.window ?? row.ts.slice(0, 16).replace("T", " ")}</div>
      <div className="ts-tooltip-body">
        <div className="ts-tooltip-row">
          <span className="ts-tooltip-swatch" style={{ background: row.over ? ROLL_OVER_COLOR : ROLL_COLOR }} />
          <span className="ts-tooltip-key">{label}</span>
          <span className="ts-tooltip-val">{row.roll.toLocaleString()} {unit}</span>
        </div>
        {pct !== null && (
          <div className="ts-tooltip-row total">
            <span className="ts-tooltip-key">한도</span>
            <span className="ts-tooltip-val" style={{ color: row.over ? ROLL_OVER_COLOR : undefined }}>
              {pct}%{row.over ? " · 초과" : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function TickMonitorChart({
  minutes, slot, label, unit, limit,
}: {
  minutes: TickMinute[];
  slot: TickSlot;
  label: string;
  unit: string;
  limit: number;
}) {
  const data = useMemo(() => toRows(minutes, slot, limit), [minutes, slot, limit]);

  const maxRoll = data.reduce((m, d) => Math.max(m, d.roll), 0);
  const yMax = Math.max(maxRoll, limit > 0 ? limit : 0) * 1.12;

  return (
    <div className="ts-wrap">
      <div className="ts-legend">
        <span className="ts-legend-item static">
          <span className="legend-swatch" style={{ background: ROLL_COLOR }} />
          {label}
        </span>
        {limit > 0 && (
          <span className="ts-legend-item static">
            <span className="legend-swatch dashed" style={{ background: ROLL_OVER_COLOR }} />
            한도 {limit.toLocaleString()}
          </span>
        )}
        <span className="ts-legend-spacer" />
        <span className="ts-meta">{data.length}분</span>
      </div>

      <div className="ts-chart">
        <ResponsiveContainer width="100%" height={340}>
          <AreaChart data={data} margin={{ top: 14, right: 18, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="tick-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ROLL_COLOR} stopOpacity={0.42} />
                <stop offset="100%" stopColor={ROLL_COLOR} stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="tick"
              tick={{ fill: "var(--text-2)", fontSize: 12, fontWeight: 600, fontFamily: "var(--mono)" }}
              tickLine={{ stroke: "var(--border-strong)" }}
              axisLine={{ stroke: "var(--border-strong)" }}
              tickMargin={8}
              height={32}
              minTickGap={22}
            />
            <YAxis
              tick={{ fill: "var(--text-2)", fontSize: 12, fontWeight: 600, fontFamily: "var(--mono)" }}
              tickLine={{ stroke: "var(--border-strong)" }}
              axisLine={{ stroke: "var(--border-strong)" }}
              width={54}
              allowDecimals={false}
              domain={[0, yMax > 0 ? Math.ceil(yMax) : "auto"]}
              tickFormatter={(v) => fmtCompact(Number(v))}
            />
            <Tooltip
              content={<TickTooltip label={label} unit={unit} limit={limit} />}
              cursor={{ stroke: "var(--accent)", strokeDasharray: "3 3", strokeOpacity: 0.4 }}
            />
            {limit > 0 && (
              <ReferenceLine
                y={limit}
                stroke={ROLL_OVER_COLOR}
                strokeDasharray="5 4"
                strokeWidth={1.4}
                label={{
                  value: `한도 ${fmtCompact(limit)}`,
                  position: "insideTopLeft",
                  fill: ROLL_OVER_COLOR,
                  fontSize: 12,
                  fontFamily: "var(--mono)",
                  fontWeight: 700,
                }}
              />
            )}
            <Area
              type="monotone"
              dataKey="roll"
              name={label}
              stroke={ROLL_COLOR}
              strokeWidth={2.1}
              fill="url(#tick-grad)"
              isAnimationActive={false}
              dot={(props: { cx?: number; cy?: number; index?: number }) => {
                const d = data[props.index ?? -1];
                if (!d?.over || props.cx == null || props.cy == null) {
                  return <g key={props.index} />;
                }
                return (
                  <circle
                    key={props.index}
                    cx={props.cx}
                    cy={props.cy}
                    r={3.4}
                    fill={ROLL_OVER_COLOR}
                    stroke="var(--surface)"
                    strokeWidth={1.4}
                  />
                );
              }}
              activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 1.5 }}
            />
            {/* key = 구간이 달라졌을 때만 remount. 없으면 recharts 내부 state 에 예전 표시 구간이 남는다. */}
            {data.length > 30 && (
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
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
