"use client";

import { useMemo } from "react";
import { TimeoutDimStat } from "@/lib/types";

/** 실패가 0.1% 여도 채움이 사라지면 "실패 없음" 으로 읽힌다 — 1건이라도 있으면 최소 폭을 준다. */
const MIN_SEG = "3px";

const rateOf = (m: TimeoutDimStat): number => (m.calls > 0 ? m.failed / m.calls : 0);

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

  const worstRate = Math.max(0, ...sorted.map(rateOf));
  // 미니바는 카드끼리 비교하라고 있는 것이다 — 스케일은 카드마다가 아니라 격자 전체에서 하나.
  const barW = (n: number, calls: number) =>
    worstRate > 0 && calls > 0 ? `${(n / calls / worstRate) * 100}%` : "0%";

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
        <span className="mt-leg-hint">막대 눈금은 카드 전체가 공유한다 — 가장 나쁜 모델이 꽉 찬다</span>
      </div>

      <div className="mt-grid">
        {sorted.map((m) => {
          const other = Math.max(0, m.failed - m.timeout);
          const rate = rateOf(m);
          const isSel = selectedModel === m.key;
          const tone = m.failed === 0 ? " is-clean" : rate >= worstRate && worstRate > 0 ? " is-worst" : "";
          return (
            <button
              key={m.key}
              type="button"
              className={"mt-tile" + tone + (isSel ? " is-selected" : "")}
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
