"use client";

import { useMemo } from "react";
import { TimeoutDimStat } from "@/lib/types";

/** 실패가 0.1% 여도 채움이 사라지면 "실패 없음" 으로 읽힌다 — 1건이라도 있으면 최소 폭을 준다. */
const MIN_SEG = "3px";

/** 숫자 색은 카드끼리 견주지 않고 이 절대 임계로 정한다 — "가장 나쁜 놈" 은 표본이 바뀌면 따라 바뀐다. */
const RATE_CRIT = 0.1;
const RATE_WARN = 0.03;

const rateOf = (m: TimeoutDimStat): number => (m.calls > 0 ? m.failed / m.calls : 0);

function toneOf(m: TimeoutDimStat): string {
  if (m.calls === 0) return "";
  if (m.failed === 0) return " is-clean";
  const r = rateOf(m);
  if (r >= RATE_CRIT) return " is-crit";
  if (r >= RATE_WARN) return " is-warn";
  return "";
}

export function ModelFailureTiles({
  models,
  selectedModel,
  onSelectModel,
}: {
  models: TimeoutDimStat[];
  selectedModel?: string;
  onSelectModel?: (model: string) => void;
}) {
  // 서버는 **호출 많은 순**으로 상위 N 을 고르고(적게 쓴 모델이 100% 실패로 올라오는 걸 막는다)
  // 표시 순서만 여기서 실패율 순으로 뒤집는다 — 격자는 읽는 순서가 곧 우선순위다.
  const sorted = useMemo(
    () => [...models].sort((a, b) => rateOf(b) - rateOf(a) || b.calls - a.calls),
    [models]
  );

  if (sorted.length === 0) {
    return <div className="top-empty">모델별 데이터가 없습니다</div>;
  }

  // 막대 전체 = 그 모델의 전체 호출. 카드마다 닫힌 절대 눈금이라 기준선이 표본에 따라 움직이지 않는다.
  const barW = (n: number, calls: number) => (calls > 0 ? `${(n / calls) * 100}%` : "0%");

  return (
    <div className="mt">
      <div className="mt-legend">
        <span className="mt-leg-item">
          <span className="legend-swatch mt-sw-timeout" />타임아웃
        </span>
        <span className="mt-leg-item">
          <span className="legend-swatch mt-sw-other" />LLM 오류
        </span>
        <span className="mt-leg-spacer" />
        <span className="mt-leg-hint">막대 전체 = 그 모델의 전체 호출 · 채워진 만큼이 실패분</span>
      </div>

      <div className="mt-grid">
        {sorted.map((m) => {
          const other = Math.max(0, m.failed - m.timeout);
          const rate = rateOf(m);
          const isSel = selectedModel === m.key;
          return (
            <button
              key={m.key}
              type="button"
              className={"mt-tile" + toneOf(m) + (isSel ? " is-selected" : "")}
              onClick={onSelectModel ? () => onSelectModel(m.key) : undefined}
              disabled={!onSelectModel}
              title={onSelectModel ? `${m.key} — 이 모델로 좁히기` : m.key}
            >
              <span className="mt-name qmodel">{m.key}</span>

              <span className="mt-rate mono">
                {m.calls > 0 ? (rate * 100).toFixed(1) : "—"}
                <span className="mt-rate-unit">%</span>
              </span>
              <span className="mt-rate-lbl">실패율</span>

              <span className="mt-bar">
                {m.timeout > 0 && (
                  <span className="mt-seg-timeout" style={{ width: barW(m.timeout, m.calls), minWidth: MIN_SEG }} />
                )}
                {other > 0 && (
                  <span className="mt-seg-other" style={{ width: barW(other, m.calls), minWidth: MIN_SEG }} />
                )}
              </span>

              <span className="mt-foot">
                <span className="mt-foot-main">
                  <b className="mono">{m.calls.toLocaleString()}</b>건 중{" "}
                  <b className="mono">{m.failed.toLocaleString()}</b>건 실패
                </span>
                <span className="mt-foot-sub">
                  타임아웃 <b className="mono">{m.timeout.toLocaleString()}</b>
                  {other > 0 && (
                    <>
                      {" · "}LLM 오류 <b className="mono">{other.toLocaleString()}</b>
                    </>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
