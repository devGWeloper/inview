"use client";

import { useMemo } from "react";
import {
  Bar,
  Brush,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TickMinute } from "@/lib/types";

// 1TICK 모니터 차트 — 분 격자 위에 두 가지를 겹쳐 그린다.
//   막대(연회색) = 정각 분 합계. 참고용이며 **초과 판정 기준이 아니다**.
//   선(굵게)     = 그 분에 시작하는 60초 창의 최대값 = 실제 TPM/RPM.
//   점선         = 한도(/admin 에서 설정). 선이 이 위로 올라간 분이 진짜 초과.
// 막대와 선이 다르게 나오는 분이 바로 "정각 기준으로는 안 보이던 초과" 다.

export type TickMetric = "tpm" | "rpm";

const ROLL_COLOR = "#2563eb";
const ROLL_OVER_COLOR = "#b42318";
const FIXED_COLOR = "#cbd5e1";
const FIXED_OVER_COLOR = "#f0b4ae";

export function fmtCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + "K";
  return String(Math.round(n));
}

/** 'YYYY-MM-DDTHH:MM:SS' → 'HH:MM' */
const hhmm = (ts: string) => ts.slice(11, 16);
/** 'YYYY-MM-DDTHH:MM:SS' → 'HH:MM:SS' (초 단위 창 시작 시각 표시용) */
const hhmmss = (ts: string) => ts.slice(11, 19);

type Row = {
  ts: string;
  tick: string;
  fixed: number;
  roll: number;
  rollAt: string | null;
  over: boolean;
};

export function toRows(minutes: TickMinute[], metric: TickMetric, limit: number): Row[] {
  return minutes.map((m) => {
    const roll = metric === "tpm" ? m.rollTokens : m.rollCalls;
    return {
      ts: m.ts,
      tick: hhmm(m.ts),
      fixed: metric === "tpm" ? m.fixedTokens : m.fixedCalls,
      roll,
      rollAt: metric === "tpm" ? m.rollTokensAt : m.rollCallsAt,
      over: limit > 0 && roll > limit,
    };
  });
}

function TickTooltip({
  active, payload, metric, limit,
}: {
  active?: boolean;
  payload?: Array<{ payload: Row }>;
  metric: TickMetric;
  limit: number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const unit = metric === "tpm" ? "토큰" : "호출";
  const pct = limit > 0 ? Math.round((row.roll / limit) * 100) : null;
  return (
    <div className="ts-tooltip">
      <div className="ts-tooltip-head">{row.ts.slice(0, 16).replace("T", " ")}</div>
      <div className="ts-tooltip-body">
        <div className="ts-tooltip-row">
          <span className="ts-tooltip-swatch" style={{ background: row.over ? ROLL_OVER_COLOR : ROLL_COLOR }} />
          <span className="ts-tooltip-key">{metric.toUpperCase()}</span>
          <span className="ts-tooltip-val">{row.roll.toLocaleString()} {unit}</span>
        </div>
        {row.rollAt && (
          <div className="ts-tooltip-row two-col">
            <span className="ts-tooltip-key">구간</span>
            <span className="ts-tooltip-val">{hhmmss(row.rollAt)} ~ +60s</span>
          </div>
        )}
        <div className="ts-tooltip-row">
          <span className="ts-tooltip-swatch" style={{ background: FIXED_COLOR }} />
          <span className="ts-tooltip-key">분 합계</span>
          <span className="ts-tooltip-val">{row.fixed.toLocaleString()} {unit}</span>
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
  minutes, metric, limit,
}: {
  minutes: TickMinute[];
  metric: TickMetric;
  limit: number;
}) {
  const data = useMemo(() => toRows(minutes, metric, limit), [minutes, metric, limit]);
  const unit = metric === "tpm" ? "토큰" : "호출";

  // 한도가 데이터보다 훨씬 크면 기준선이 화면 밖으로 나가 "얼마나 여유인지" 가 안 보인다.
  // 반대로 데이터가 한도를 크게 넘으면 기준선이 바닥에 깔린다. 둘 다 축 상한에 반영한다.
  const maxRoll = data.reduce((m, d) => Math.max(m, d.roll), 0);
  const yMax = Math.max(maxRoll, limit > 0 ? limit : 0) * 1.12;

  return (
    <div className="ts-wrap">
      <div className="ts-legend">
        <span className="ts-legend-item static">
          <span className="legend-swatch" style={{ background: ROLL_COLOR }} />
          {metric.toUpperCase()}
        </span>
        <span className="ts-legend-item static">
          <span className="legend-swatch" style={{ background: FIXED_COLOR }} />
          분 합계
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
          <ComposedChart data={data} margin={{ top: 14, right: 18, bottom: 0, left: 0 }}>
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
              content={<TickTooltip metric={metric} limit={limit} />}
              cursor={{ fill: "var(--accent)", fillOpacity: 0.06 }}
            />
            <Bar dataKey="fixed" name="분 합계" barSize={7} radius={[2, 2, 0, 0]} isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.over ? FIXED_OVER_COLOR : FIXED_COLOR} />
              ))}
            </Bar>
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
            <Line
              type="monotone"
              dataKey="roll"
              name={metric.toUpperCase()}
              stroke={ROLL_COLOR}
              strokeWidth={2.1}
              isAnimationActive={false}
              dot={(props: { cx?: number; cy?: number; index?: number }) => {
                const d = data[props.index ?? -1];
                // 초과한 분만 점을 찍는다 — 촘촘한 격자에서 점을 다 찍으면 선이 안 읽힌다.
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
            {data.length > 30 && (
              <Brush
                dataKey="tick"
                height={22}
                stroke="var(--accent)"
                fill="var(--surface-2)"
                travellerWidth={8}
                tickFormatter={() => ""}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
