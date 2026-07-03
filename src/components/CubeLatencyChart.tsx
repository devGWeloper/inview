"use client";

// ⚠️ TEMP(Tokens 탭 차트로 대체 예정): CUBE send→resp 평균 지연 추이 차트.
// Tokens 탭에는 이미 TokenLatencyChart 가 구현되어 있고, GAIA 가 TRX_TOKEN_DET 에
// LATENCY_MS 적재를 시작하면 그쪽이 역할을 대신한다. 그때 이 파일과 /api/stats 의
// cubeLat 집계, TimeBucket 의 avgCubeLatencyMs/cubeLatencyTraces 필드를 함께 제거한다.

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
import { StatsResponse } from "@/lib/types";
import { fmtDuration } from "@/components/TokenLatencyChart";

const COLOR = "#f59e0b"; // Tokens 탭 latency 차트와 동일 톤

type Gran = StatsResponse["granularity"];

function fmtTick(ts: string, g: Gran): string {
  if (g === "1d") return ts.slice(5, 10);
  return ts.slice(11, 16);
}

function fmtFullTs(ts: string, g: Gran): string {
  if (g === "1d") return ts.slice(0, 10);
  return ts.slice(0, 16).replace("T", " ");
}

type Row = { ts: string; tick: string; avgLatencyMs: number | null; traces: number };

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
        <div className="ts-tooltip-row">
          <span className="ts-tooltip-swatch" style={{ background: COLOR }} />
          <span className="ts-tooltip-key">평균 지연</span>
          <span className="ts-tooltip-val">{fmtDuration(row.avgLatencyMs)}</span>
        </div>
        <div className="ts-tooltip-row two-col">
          <span className="ts-tooltip-key">TRACES</span>
          <span className="ts-tooltip-val">{row.traces.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

export function CubeLatencyChart({ stats }: { stats: StatsResponse }) {
  const granularity = stats.granularity;

  const data: Row[] = useMemo(
    () =>
      stats.buckets.map((b) => ({
        ts: b.ts,
        tick: fmtTick(b.ts, granularity),
        avgLatencyMs: b.avgCubeLatencyMs ?? null,
        traces: b.cubeLatencyTraces ?? 0,
      })),
    [stats.buckets, granularity]
  );

  const { peakIdx, peakVal, peakTs, hasData } = useMemo(() => {
    let pIdx = -1, pVal = 0;
    let any = false;
    data.forEach((d, i) => {
      if (d.avgLatencyMs != null) {
        any = true;
        if (d.avgLatencyMs > pVal) { pVal = d.avgLatencyMs; pIdx = i; }
      }
    });
    return { peakIdx: pIdx, peakVal: pVal, peakTs: pIdx >= 0 ? data[pIdx].ts : null, hasData: any };
  }, [data]);

  if (!hasData) {
    return (
      <div className="top-empty">
        지연 데이터가 없습니다 · CUBE 의 SEND_TM/RESP_TM 이 기록된 트레이스가 필요합니다
      </div>
    );
  }

  return (
    <div className="ts-wrap">
      <div className="ts-legend">
        <span className="ts-legend-item" aria-hidden>
          <span className="legend-swatch" style={{ background: COLOR }} />
          평균 응답 지연 (CUBE 요청→응답)
        </span>
        <span className="ts-legend-spacer" />
        <span className="ts-meta">{data.length} buckets · {granText(granularity)}</span>
      </div>

      <div className="ts-chart">
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={data} margin={{ top: 10, right: 18, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="cube-lat-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLOR} stopOpacity={0.45} />
                <stop offset="100%" stopColor={COLOR} stopOpacity={0.04} />
              </linearGradient>
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
              width={56}
              tickFormatter={(v) => fmtDuration(Number(v))}
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
                  value: `peak ${fmtDuration(peakVal)}${peakTs ? ` · ${fmtFullTs(peakTs, granularity)}` : ""}`,
                  position: "insideTopRight",
                  fill: "var(--text)",
                  fontSize: 12.5,
                  fontFamily: "var(--mono)",
                  fontWeight: 700,
                }}
              />
            )}
            <Area
              type="monotone"
              dataKey="avgLatencyMs"
              name="평균 지연"
              stroke={COLOR}
              strokeWidth={1.8}
              fill="url(#cube-lat-grad)"
              connectNulls
              isAnimationActive
              animationDuration={500}
              activeDot={{ r: 3, stroke: "var(--surface)", strokeWidth: 1.5 }}
            />
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
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function granText(g: Gran): string {
  return g === "5m" ? "5-min" : g === "1h" ? "hourly" : "daily";
}
