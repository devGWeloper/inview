"use client";

import { useMemo, useState } from "react";
import { TokenDimStat, TokenStatsResponse } from "@/lib/types";
import { fmtDuration } from "@/components/TokenLatencyChart";

// 노드별 / 모델별 리더보드 — 두 개의 분리된 카드.
// 행 = 순위 배지 + 이름 + 큰 값 + 상대 바(1위 = 100%) + 보조 스탯 한 줄.
// 메트릭 토글(토큰/호출/토큰·호출/지연)은 두 카드가 공유하고, 행 클릭 = 해당 노드/모델 필터.
// 카드 색: 노드 = 파랑, 모델 = 보라 (지연 메트릭의 바만 빨강 = 느림).

type MetricKey = "tokens" | "calls" | "perCall" | "latency";

const METRICS: { key: MetricKey; label: string; hint: string }[] = [
  { key: "tokens",  label: "토큰",      hint: "총 토큰" },
  { key: "calls",   label: "호출",      hint: "LLM 호출 수" },
  { key: "perCall", label: "토큰/호출", hint: "호출당 평균 토큰 — 어디가 비싼가" },
  { key: "latency", label: "지연",      hint: "평균 호출 소요시간 — 어디가 느린가" },
];

const HUE = {
  node:  { main: "#2563eb", soft: "#e8efff" },
  model: { main: "#7c3aed", soft: "#f3edfe" },
} as const;
const LATENCY_BAR = "#dc2626";

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(Math.round(n));
}

function metricOf(d: TokenDimStat, m: MetricKey): number | null {
  if (m === "tokens") return d.totalTokens;
  if (m === "calls") return d.calls;
  if (m === "perCall") return d.calls > 0 ? d.totalTokens / d.calls : null;
  return d.avgLatencyMs;
}

function fmtMetric(v: number | null, m: MetricKey): string {
  if (v == null) return "—";
  if (m === "latency") return fmtDuration(v);
  if (m === "calls") return v < 10_000 ? Math.round(v).toLocaleString() : fmtCompact(v);
  return fmtCompact(v);
}

function rowTitle(d: TokenDimStat): string {
  return (
    `${d.key}\n` +
    `호출 ${d.calls.toLocaleString()}\n` +
    `IN ${d.inputTokens.toLocaleString()} · OUT ${d.outputTokens.toLocaleString()}\n` +
    `총 토큰 ${d.totalTokens.toLocaleString()}\n` +
    `평균 지연 ${d.avgLatencyMs == null ? "측정 없음" : fmtDuration(d.avgLatencyMs)}`
  );
}

function Board({
  title,
  sub,
  hue,
  dims,
  metric,
  shareBase,
  onSelect,
  selected,
  emptyText,
}: {
  title: string;
  sub: string;
  hue: { main: string; soft: string };
  dims: TokenDimStat[];
  metric: MetricKey;
  shareBase: { tokens: number; calls: number };
  onSelect?: (key: string) => void;
  selected?: string;
  emptyText: string;
}) {
  const sorted = useMemo(() => {
    const arr = [...dims];
    arr.sort((a, b) => {
      const va = metricOf(a, metric);
      const vb = metricOf(b, metric);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return vb - va;
    });
    return arr;
  }, [dims, metric]);

  const vals = sorted.map((d) => metricOf(d, metric)).filter((v): v is number => v != null);
  const maxV = vals.length ? Math.max(...vals) : 0;
  const showShare = metric === "tokens" || metric === "calls";
  const base = metric === "calls" ? shareBase.calls : shareBase.tokens;
  const barColor = metric === "latency" ? LATENCY_BAR : hue.main;

  return (
    <div
      className="tbd-board"
      style={{ "--hue": hue.main, "--hue-soft": hue.soft } as React.CSSProperties}
    >
      <div className="tbd-board-head">
        <span className="tbd-dot" aria-hidden />
        <span className="tbd-board-title">{title}</span>
        <span className="tbd-board-sub">{sub} · {dims.length}개</span>
        {selected && <span className="tbd-filterchip">필터: {selected}</span>}
      </div>

      {sorted.length === 0 ? (
        <div className="top-empty">{emptyText}</div>
      ) : (
        <div className="tbd-rows">
          {sorted.map((d, i) => {
            const v = metricOf(d, metric);
            const isNone = d.key === "(none)";
            const clickable = !!onSelect && !isNone;
            const active = selected === d.key;
            // 바 길이는 보드 1위 대비 상대값 (1위 = 100%), % 라벨은 전체 대비 비중
            const barRatio = v != null && maxV > 0 ? v / maxV : 0;
            const pct = base > 0 ? ((metric === "calls" ? d.calls : d.totalTokens) / base) * 100 : 0;
            const per = d.calls > 0 ? d.totalTokens / d.calls : null;
            const meta = (
              [
                ["tokens", `${fmtCompact(d.totalTokens)} tok`],
                ["calls", `${d.calls.toLocaleString()} 호출`],
                ["perCall", per == null ? "—/호출" : `${fmtCompact(per)}/호출`],
                ["latency", d.avgLatencyMs == null ? "지연 —" : `지연 ${fmtDuration(d.avgLatencyMs)}`],
              ] as [MetricKey, string][]
            )
              .filter(([k]) => k !== metric)
              .map(([, s]) => s)
              .join(" · ");
            return (
              <button
                key={d.key}
                type="button"
                className={"tbd-row" + (active ? " active" : "")}
                onClick={clickable ? () => onSelect!(d.key) : undefined}
                disabled={!clickable}
                title={rowTitle(d) + (clickable ? `\n\n클릭 = ${active ? "필터 해제" : "이 값으로 필터"}` : "")}
              >
                <span className={"tbd-rank" + (i === 0 ? " top" : "")}>{i + 1}</span>
                <span className="tbd-main">
                  <span className="tbd-line1">
                    <span className={"tbd-key" + (isNone ? " none" : "")}>{d.key}</span>
                    <span className="tbd-val">{fmtMetric(v, metric)}</span>
                  </span>
                  <span className="tbd-barrow">
                    <span className="tbd-bar">
                      <span
                        className="tbd-bar-f"
                        style={{
                          width: `${Math.min(100, barRatio * 100)}%`,
                          background: `linear-gradient(90deg, ${barColor}99, ${barColor})`,
                        }}
                      />
                    </span>
                    {showShare && v != null && <span className="tbd-pct">{pct.toFixed(1)}%</span>}
                  </span>
                  <span className="tbd-meta">{meta}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TokenBreakdown({
  stats,
  emptyText,
  onSelectNode,
  onSelectModel,
  selectedNode,
  selectedModel,
}: {
  stats: TokenStatsResponse;
  emptyText: string;
  onSelectNode?: (key: string) => void;
  onSelectModel?: (key: string) => void;
  selectedNode?: string;
  selectedModel?: string;
}) {
  const [metric, setMetric] = useState<MetricKey>("tokens");
  const current = METRICS.find((x) => x.key === metric)!;
  const shareBase = { tokens: stats.totals.totalTokens, calls: stats.totals.calls };

  return (
    <div className="tbd">
      <div className="tbd-toolbar">
        <div className="tbd-metrics" role="tablist" aria-label="breakdown metric">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={metric === m.key}
              className={"tbd-metric-btn" + (metric === m.key ? " active" : "")}
              onClick={() => setMetric(m.key)}
              title={m.hint}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="tbd-hint">{current.hint} · 행 클릭 = 필터</span>
      </div>

      <div className="tbd-grid">
        <Board
          title="노드별"
          sub="NODE_NM"
          hue={HUE.node}
          dims={stats.byNode}
          metric={metric}
          shareBase={shareBase}
          onSelect={onSelectNode}
          selected={selectedNode}
          emptyText={emptyText}
        />
        <Board
          title="모델별"
          sub="MODEL_NM"
          hue={HUE.model}
          dims={stats.byModel}
          metric={metric}
          shareBase={shareBase}
          onSelect={onSelectModel}
          selected={selectedModel}
          emptyText={emptyText}
        />
      </div>
    </div>
  );
}
