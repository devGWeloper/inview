"use client";

import { useMemo } from "react";
import {
  Area,
  Bar,
  Brush,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TokenBucket, TokenStatsResponse } from "@/lib/types";

const COLOR = "#f59e0b";     // latency 전용 색 (토큰 차트와 구분)
const ERR_COLOR = "#dc2626"; // 실패 호출 막대

type Gran = TokenStatsResponse["granularity"];

function fmtTick(ts: string, g: Gran): string {
  if (g === "1d") return ts.slice(5, 10);
  return ts.slice(11, 16);
}

function fmtFullTs(ts: string, g: Gran): string {
  if (g === "1d") return ts.slice(0, 10);
  return ts.slice(0, 16).replace("T", " ");
}

/** ms → 사람이 읽기 쉬운 소요시간 (s 우선, 1초 미만은 ms) */
export function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

type Row = {
  ts: string;
  tick: string;
  avgLatencyMs: number | null;
  calls: number;
  errorCalls: number;
};

function CustomTooltip({
  active, payload, granularity, showErrors,
}: {
  active?: boolean;
  payload?: Array<{ payload: Row }>;
  granularity: Gran;
  showErrors: boolean;
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
        {showErrors && (
          <div className="ts-tooltip-row">
            <span className="ts-tooltip-swatch" style={{ background: ERR_COLOR }} />
            <span className="ts-tooltip-key">실패 호출</span>
            <span className="ts-tooltip-val">{row.errorCalls.toLocaleString()}</span>
          </div>
        )}
        <div className="ts-tooltip-row two-col">
          <span className="ts-tooltip-key">CALLS</span>
          <span className="ts-tooltip-val">{row.calls.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

export function TokenLatencyChart({ stats }: { stats: TokenStatsResponse }) {
  const granularity = stats.granularity;

  const data: Row[] = useMemo(
    () =>
      stats.buckets.map((b: TokenBucket) => ({
        ts: b.ts,
        tick: fmtTick(b.ts, granularity),
        avgLatencyMs: b.avgLatencyMs,
        calls: b.calls,
        errorCalls: b.errorCalls,
      })),
    [stats.buckets, granularity]
  );

  // 실패 호출 막대는 실제로 실패가 있을 때만 (0 뿐인 축을 늘 그리지 않는다)
  const totalErrors = stats.totals.errorCalls;
  const showErrors = stats.statusAvailable && totalErrors > 0;

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

  if (!hasData && !showErrors) {
    return (
      <div className="top-empty">
        지연 데이터가 없습니다 · GAIA 가 LATENCY_MS 를 적재하면 표시됩니다
      </div>
    );
  }

  return (
    <div className="ts-wrap">
      <div className="ts-legend">
        <span className="ts-legend-item" aria-hidden>
          <span className="legend-swatch" style={{ background: COLOR }} />
          평균 LLM 호출 지연{showErrors ? " (성공 호출만)" : ""}
        </span>
        {showErrors && (
          <span className="ts-legend-item" aria-hidden>
            <span className="legend-swatch" style={{ background: ERR_COLOR }} />
            실패 호출 수
          </span>
        )}
        <span className="ts-legend-spacer" />
        <span className="ts-meta">{data.length} buckets · {granText(granularity)}</span>
      </div>

      <div className="ts-chart">
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data} margin={{ top: 10, right: 18, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="lat-grad" x1="0" y1="0" x2="0" y2="1">
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
              yAxisId="lat"
              tick={{ fill: "var(--text-2)", fontSize: 13, fontWeight: 600, fontFamily: "var(--mono)" }}
              tickLine={{ stroke: "var(--border-strong)" }}
              axisLine={{ stroke: "var(--border-strong)" }}
              width={56}
              tickFormatter={(v) => fmtDuration(Number(v))}
            />
            {showErrors && (
              <YAxis
                yAxisId="err"
                orientation="right"
                allowDecimals={false}
                tick={{ fill: ERR_COLOR, fontSize: 12.5, fontWeight: 600, fontFamily: "var(--mono)" }}
                tickLine={{ stroke: "var(--border-strong)" }}
                axisLine={{ stroke: "var(--border-strong)" }}
                width={38}
              />
            )}
            <Tooltip
              content={<CustomTooltip granularity={granularity} showErrors={showErrors} />}
              cursor={{ stroke: "var(--accent)", strokeDasharray: "3 3", strokeOpacity: 0.4 }}
            />
            {peakIdx >= 0 && peakVal > 0 && (
              <ReferenceLine
                yAxisId="lat"
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
            {showErrors && (
              <Bar
                yAxisId="err"
                dataKey="errorCalls"
                name="실패 호출"
                fill={ERR_COLOR}
                fillOpacity={0.5}
                barSize={10}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
            )}
            <Area
              yAxisId="lat"
              type="monotone"
              dataKey="avgLatencyMs"
              name="평균 지연"
              stroke={COLOR}
              strokeWidth={1.8}
              fill="url(#lat-grad)"
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
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function granText(g: Gran): string {
  return g === "5m" ? "5-min" : g === "1h" ? "hourly" : "daily";
}
