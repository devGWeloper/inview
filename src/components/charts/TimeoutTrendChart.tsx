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

const SERIES = ["calls", "timeout", "other"] as const;
type SeriesKey = typeof SERIES[number];

const SERIES_COLOR: Record<SeriesKey, string> = {
  calls:   "#94a3b8",
  timeout: "#b42318",
  other:   "#d97706",
};

const SERIES_LABEL: Record<SeriesKey, string> = {
  calls:   "전체 호출",
  timeout: "타임아웃",
  other:   "LLM 오류",
};

/** 두 패널의 X 눈금이 어긋나면 위아래를 같은 시각으로 못 읽는다 — 축 폭과 좌우 여백을 고정한다. */
const Y_WIDTH = 52;
const MARGIN = { top: 10, right: 18, bottom: 0, left: 0 };
const SYNC_ID = "to-trend";

type Gran = TimeoutStatsResponse["granularity"];

export type TimeoutSeries = { granularity: Gran; buckets: TimeoutBucket[] };

function fmtFullTs(ts: string, g: Gran): string {
  if (g === "1d") return ts.slice(0, 10);
  return ts.slice(0, 16).replace("T", " ");
}

type Row = {
  ts: string;
  tick: string;
  failed: number;
  /** 호출이 0건인 버킷은 비율이 없다 — 0% 로 그리면 "안정" 으로 읽힌다. */
  rate: number | null;
} & Record<SeriesKey, number>;

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
          <span className="ts-tooltip-swatch" style={{ background: SERIES_COLOR.calls }} />
          <span className="ts-tooltip-key">{SERIES_LABEL.calls}</span>
          <span className="ts-tooltip-val">{row.calls.toLocaleString()}</span>
        </div>
        {(["timeout", "other"] as const).map((k) => {
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
          <span className="ts-tooltip-key">타임아웃률</span>
          <span className="ts-tooltip-val">
            {row.rate === null ? "—" : `${row.rate.toFixed(2)}%`}
          </span>
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
    calls: false,
    timeout: false,
    other: false,
  });

  const data: Row[] = useMemo(
    () =>
      stats.buckets.map((b: TimeoutBucket) => ({
        ts: b.ts,
        tick: axis.key(b.ts),
        calls: b.calls,
        timeout: b.timeout,
        other: Math.max(0, b.failed - b.timeout),
        failed: b.failed,
        rate: b.calls > 0 ? (b.timeout / b.calls) * 100 : null,
      })),
    [stats.buckets, axis]
  );

  const { peakIdx, peakVal, peakTs } = useMemo(() => {
    let pIdx = -1, pVal = 0;
    data.forEach((d, i) => {
      if (d.failed > pVal) { pVal = d.failed; pIdx = i; }
    });
    return { peakIdx: pIdx, peakVal: pVal, peakTs: pIdx >= 0 ? data[pIdx].ts : null };
  }, [data]);

  // 최대 타임아웃률이 0.2% 여도 축이 0.2% 까지만 차면 두더지 언덕이 산맥이 된다 — 1% 를 바닥으로 둔다.
  const rateMax = useMemo(() => {
    const m = Math.max(0, ...data.map((d) => d.rate ?? 0));
    return Math.max(1, Math.ceil(m * 1.15));
  }, [data]);

  const toggle = (k: SeriesKey) => setHidden((h) => ({ ...h, [k]: !h[k] }));
  const brushKey = data.length + ":" + (data[0]?.tick ?? "");

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
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={data} margin={MARGIN} syncId={SYNC_ID}>
            <defs>
              {SERIES.map((k) => (
                <linearGradient key={k} id={`to-grad-${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES_COLOR[k]} stopOpacity={k === "calls" ? 0.28 : 0.5} />
                  <stop offset="100%" stopColor={SERIES_COLOR[k]} stopOpacity={0.04} />
                </linearGradient>
              ))}
            </defs>
            <XAxis dataKey="tick" ticks={axis.ticks} hide />
            <YAxis
              tick={{ fill: "var(--text-2)", fontSize: 13, fontWeight: 600, fontFamily: "var(--mono)" }}
              tickLine={{ stroke: "var(--border-strong)" }}
              axisLine={{ stroke: "var(--border-strong)" }}
              width={Y_WIDTH}
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
            {/* 전체 호출이 먼저 그려져야 실패 스택의 배경이 된다 — 스택에 끼우지 않는다. */}
            <Area
              type="monotone"
              dataKey="calls"
              name={SERIES_LABEL.calls}
              stroke={SERIES_COLOR.calls}
              strokeWidth={1.2}
              fill="url(#to-grad-calls)"
              hide={hidden.calls}
              isAnimationActive
              animationDuration={500}
              activeDot={{ r: 3, stroke: "var(--surface)", strokeWidth: 1.5 }}
            />
            {(["timeout", "other"] as const).map((k) => (
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
            <Legend content={() => null} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* 건수와 비율은 스케일이 달라 한 축에 못 얹는다 — X 를 공유하는 아래 패널로 뗀다.
          syncId 가 툴팁 위치와 Brush 구간을 두 패널에 같이 물린다. */}
      <div className="ts-sub-label">
        <span className="ts-sub-title">타임아웃률</span>
        <span className="ts-sub-hint">전체 호출 대비 · 요청 없는 구간은 끊긴다</span>
      </div>
      <div className="ts-chart ts-chart-sub">
        <ResponsiveContainer width="100%" height={118}>
          <AreaChart data={data} margin={MARGIN} syncId={SYNC_ID}>
            <defs>
              <linearGradient id="to-grad-rate" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES_COLOR.timeout} stopOpacity={0.42} />
                <stop offset="100%" stopColor={SERIES_COLOR.timeout} stopOpacity={0.04} />
              </linearGradient>
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
              tick={{ fill: "var(--text-2)", fontSize: 12, fontWeight: 600, fontFamily: "var(--mono)" }}
              tickLine={{ stroke: "var(--border-strong)" }}
              axisLine={{ stroke: "var(--border-strong)" }}
              width={Y_WIDTH}
              domain={[0, rateMax]}
              tickCount={3}
              tickFormatter={(v) => `${Number(v)}%`}
            />
            {/* 위 패널이 상세를 띄운다 — 여기까지 툴팁을 그리면 두 개가 겹친다. 커서만 남긴다. */}
            <Tooltip
              content={() => null}
              cursor={{ stroke: "var(--accent)", strokeDasharray: "3 3", strokeOpacity: 0.4 }}
            />
            <Area
              type="monotone"
              dataKey="rate"
              name="타임아웃률"
              stroke={SERIES_COLOR.timeout}
              strokeWidth={1.8}
              fill="url(#to-grad-rate)"
              connectNulls={false}
              isAnimationActive
              animationDuration={500}
              activeDot={{ r: 3, stroke: "var(--surface)", strokeWidth: 1.5 }}
            />
            {/* key = 구간이 달라졌을 때만 remount. 없으면 recharts 내부 state 에 예전 표시 구간이 남는다. */}
            {data.length > 12 && (
              <Brush
                key={brushKey}
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
