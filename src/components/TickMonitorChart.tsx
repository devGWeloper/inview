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

// 1TICK 모니터 차트 — 1분 격자에 값 하나만 그린다.
//   면/선 = 그 분에서 가장 몰린 연속 60초의 값 = 실제 TPM/RPM (초과 판정값).
//   점선  = 한도(/admin 에서 설정). 면이 이 위로 올라간 분이 초과.
// ⚠️ 정각 분 합계(TickMinute.fixed*)는 판정에 안 쓰이므로 **그리지 않는다** —
//    한 화면에 판정값과 비판정값을 같이 두면 어느 게 기준인지 읽는 사람이 혼란스럽다.

export type TickMetric = "tpm" | "rpm";

const ROLL_COLOR = "#2563eb";
const ROLL_OVER_COLOR = "#b42318";

export function fmtCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + "K";
  return String(Math.round(n));
}

/** 'YYYY-MM-DDTHH:MM:SS' → 'HH:MM' */
const hhmm = (ts: string) => ts.slice(11, 16);
/** 'YYYY-MM-DDTHH:MM:SS' → 'HH:MM:SS' */
const hhmmss = (ts: string) => ts.slice(11, 19);

/**
 * 60초 구간을 '시작 ~ 끝' 으로 적는다 (예: "09:16:30 ~ 09:17:30").
 * 끝 시각을 직접 보여준다 — "+60s" 같은 표기는 한 번 더 계산해야 읽힌다.
 */
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
  /** roll 을 만든 60초 구간의 시작~끝 (예: "09:16:30 ~ 09:17:30"). 값이 0 이면 null */
  window: string | null;
  over: boolean;
};

export function toRows(minutes: TickMinute[], metric: TickMetric, limit: number): Row[] {
  return minutes.map((m) => {
    const roll = metric === "tpm" ? m.rollTokens : m.rollCalls;
    const at = metric === "tpm" ? m.rollTokensAt : m.rollCallsAt;
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
        {row.window && (
          <div className="ts-tooltip-row two-col">
            <span className="ts-tooltip-key">가장 몰린 60초</span>
            <span className="ts-tooltip-val">{row.window}</span>
          </div>
        )}
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
              content={<TickTooltip metric={metric} limit={limit} />}
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
              name={metric.toUpperCase()}
              stroke={ROLL_COLOR}
              strokeWidth={2.1}
              fill="url(#tick-grad)"
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
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
