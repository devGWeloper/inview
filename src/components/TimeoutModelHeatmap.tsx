"use client";

import { useMemo, useState } from "react";
import { TimeoutStatsResponse, TimeoutModelSeries, TimeoutModelCell } from "@/lib/types";

// 모델 × 시간 히트맵 — "이 시간대에 이 모델이 몇 건 요청 중 몇 건 실패했나".
// 셀 색상: 실패율(fail/calls) 6단계 (0% → 100%).
// 요청이 아예 없던 셀은 색 없음(비활동) — 실패가 "얼마나 자주" 있는지와 별개로
// "이 모델이 그 시간에 안 쓰였다" 를 구분해 보여준다.
//
// 셀 hover = 그 슬롯 상세 팝업 (모델·시각·요청/실패/타임아웃)
// 셀 클릭 = 그 모델 서버 필터 (KPI/추이/분포/목록 전부 좁혀짐)

type Gran = TimeoutStatsResponse["granularity"];

function fmtFullTs(ts: string, g: Gran): string {
  if (g === "1d") return ts.slice(0, 10);
  return ts.slice(0, 16).replace("T", " ");
}
function fmtTick(ts: string, g: Gran): string {
  return g === "1d" ? ts.slice(5, 10) : ts.slice(11, 16);
}

/** 실패율(0~1) → 색상 레벨. 요청 없음(calls=0)은 별도 레벨(-1). */
function levelOf(cell: TimeoutModelCell): number {
  if (cell.calls === 0) return -1;
  if (cell.failed === 0) return 0;
  const r = cell.failed / cell.calls;
  if (r < 0.05) return 1;
  if (r < 0.15) return 2;
  if (r < 0.35) return 3;
  if (r < 0.7) return 4;
  return 5;
}

const LEVEL_LABEL = ["안정", "<5%", "5–15%", "15–35%", "35–70%", "70–100%"];

export function TimeoutModelHeatmap({
  stats,
  selectedModel,
  onSelectModel,
}: {
  stats: TimeoutStatsResponse;
  selectedModel?: string;
  onSelectModel?: (model: string) => void;
}) {
  const { modelTrend, buckets, granularity } = stats;
  const [hover, setHover] = useState<{ m: string; i: number } | null>(null);

  const bucketCount = buckets.length;
  // 첫/중/마지막 눈금만 표기 (버킷이 많으면 다 못 넣는다)
  const tickIdx = useMemo(() => {
    if (bucketCount === 0) return [] as number[];
    if (bucketCount <= 4) return buckets.map((_, i) => i);
    const mid = Math.floor(bucketCount / 2);
    return [0, mid, bucketCount - 1];
  }, [bucketCount, buckets]);

  if (modelTrend.length === 0 || bucketCount === 0) {
    return <div className="top-empty">모델별 데이터가 없습니다</div>;
  }

  const gridCols = `160px 84px repeat(${bucketCount}, minmax(0, 1fr)) 84px`;
  const worstRate = Math.max(
    0,
    ...modelTrend.map((m) => (m.totalCalls > 0 ? m.totalFailed / m.totalCalls : 0))
  );
  const hoverCell = hover ? modelTrend.find((m) => m.model === hover.m)?.cells[hover.i] : null;

  return (
    <div className="hm">
      {/* 범례 — 실패율 스케일 */}
      <div className="hm-legend">
        <span className="hm-leg-lbl">실패율</span>
        <span className="hm-scale">
          {LEVEL_LABEL.map((l, i) => (
            <span key={i} className={`hm-swatch lvl-${i}`} title={l} aria-label={l} />
          ))}
        </span>
        <span className="hm-leg-hint">낮음 → 높음</span>
        <span className="hm-leg-hint">
          <span className="hm-swatch lvl--1" /> 요청 없음
        </span>
        <span className="hm-leg-spacer" />
        <span className="hm-leg-hint mono">
          {bucketCount} buckets · {granText(granularity)} · 모델 {modelTrend.length}개
        </span>
      </div>

      <div className="hm-grid" role="table">
        {/* 헤더: 왼쪽 라벨 + 시각 눈금 */}
        <div className="hm-head" style={{ gridTemplateColumns: gridCols }}>
          <span className="hm-h-lbl">모델</span>
          <span className="hm-h-lbl num">총 호출</span>
          {buckets.map((b, i) =>
            tickIdx.includes(i) ? (
              <span key={b.ts} className="hm-tick mono">
                {fmtTick(b.ts, granularity)}
              </span>
            ) : (
              <span key={b.ts} className="hm-tick-empty" />
            )
          )}
          <span className="hm-h-lbl num">실패율</span>
        </div>

        {/* 각 모델 행 */}
        {modelTrend.map((m) => {
          const rate = m.totalCalls > 0 ? m.totalFailed / m.totalCalls : 0;
          const isSel = selectedModel === m.model;
          return (
            <div
              key={m.model}
              className={"hm-row" + (isSel ? " is-selected" : "")}
              style={{ gridTemplateColumns: gridCols }}
              onMouseLeave={() => setHover(null)}
            >
              <button
                type="button"
                className="hm-model qmodel"
                onClick={onSelectModel ? () => onSelectModel(m.model) : undefined}
                disabled={!onSelectModel}
                title={onSelectModel ? "이 모델로 좁히기" : undefined}
              >
                {m.model}
              </button>
              <span className="hm-total mono">{m.totalCalls.toLocaleString()}</span>
              {m.cells.map((c, i) => {
                const lv = levelOf(c);
                const isHov = hover?.m === m.model && hover?.i === i;
                return (
                  <button
                    key={c.ts}
                    type="button"
                    className={`hm-cell lvl-${lv}` + (isHov ? " is-hover" : "")}
                    onMouseEnter={() => setHover({ m: m.model, i })}
                    onFocus={() => setHover({ m: m.model, i })}
                    onClick={onSelectModel ? () => onSelectModel(m.model) : undefined}
                    aria-label={`${m.model} · ${fmtFullTs(c.ts, granularity)} · 요청 ${c.calls} · 실패 ${c.failed}`}
                    tabIndex={c.calls > 0 ? 0 : -1}
                  />
                );
              })}
              <span className="hm-rate mono">
                <span className={"hm-rate-val" + (rate >= worstRate && worstRate > 0 ? " is-worst" : "")}>
                  {(rate * 100).toFixed(1)}%
                </span>
                <span className="hm-rate-sub">{m.totalFailed.toLocaleString()} 실패</span>
              </span>
            </div>
          );
        })}
      </div>

      {/* hover 상세 카드 — 그리드 아래 고정 슬롯. 항상 자리는 잡되 내용이 없으면 안내문 */}
      <div className={"hm-detail" + (hoverCell ? " is-active" : "")}>
        {hoverCell ? (
          <>
            <span className="hm-detail-head mono">{fmtFullTs(hoverCell.ts, granularity)}</span>
            <span className="hm-detail-chip qmodel">{hover!.m}</span>
            <span className="hm-detail-stat">
              요청 <b className="mono">{hoverCell.calls.toLocaleString()}</b>
            </span>
            <span className="hm-detail-stat is-fail">
              실패 <b className="mono">{hoverCell.failed.toLocaleString()}</b>
              <span className="hm-detail-rate">
                ({hoverCell.calls > 0 ? ((hoverCell.failed / hoverCell.calls) * 100).toFixed(1) : "0"}%)
              </span>
            </span>
            <span className="hm-detail-stat is-timeout">
              그중 타임아웃 <b className="mono">{hoverCell.timeout.toLocaleString()}</b>
            </span>
          </>
        ) : (
          <span className="hm-detail-hint">셀을 가리키면 상세가 표시됩니다 · 모델 이름/셀 클릭 = 모델 필터</span>
        )}
      </div>
    </div>
  );
}

function granText(g: Gran): string {
  return g === "5m" ? "5-min" : g === "1h" ? "hourly" : "daily";
}
