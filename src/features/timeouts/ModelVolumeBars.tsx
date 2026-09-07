"use client";

import { TimeoutDimStat } from "@/lib/types";

/** 실패가 0.1% 여도 막대가 사라지면 "실패 없음" 으로 읽힌다 — 1건이라도 있으면 최소 폭을 준다. */
const MIN_SEG = "3px";

const pct = (n: number, total: number): string =>
  total > 0 ? ((n / total) * 100).toFixed(1) + "%" : "—";

export function ModelVolumeBars({
  models,
  selectedModel,
  onSelectModel,
}: {
  models: TimeoutDimStat[];
  selectedModel?: string;
  onSelectModel?: (model: string) => void;
}) {
  if (models.length === 0) {
    return <div className="top-empty">모델별 데이터가 없습니다</div>;
  }

  const maxCalls = Math.max(1, ...models.map((m) => m.calls));
  const worstRate = Math.max(0, ...models.map((m) => (m.calls > 0 ? m.failed / m.calls : 0)));
  const w = (n: number) => `${(n / maxCalls) * 100}%`;

  return (
    <div className="mv">
      <div className="mv-legend">
        <span className="mv-leg-item">
          <span className="legend-swatch mv-sw-calls" />전체 호출
        </span>
        <span className="mv-leg-item">
          <span className="legend-swatch mv-sw-timeout" />타임아웃
        </span>
        <span className="mv-leg-item">
          <span className="legend-swatch mv-sw-other" />LLM 오류
        </span>
        <span className="mv-leg-spacer" />
        <span className="mv-leg-hint">두 막대는 같은 눈금이다 — 아래가 짧을수록 안전하다</span>
      </div>

      <div className="mv-rows">
        {models.map((m) => {
          const other = Math.max(0, m.failed - m.timeout);
          const rate = m.calls > 0 ? m.failed / m.calls : 0;
          const isSel = selectedModel === m.key;
          return (
            <button
              key={m.key}
              type="button"
              className={"mv-row" + (isSel ? " is-selected" : "")}
              onClick={onSelectModel ? () => onSelectModel(m.key) : undefined}
              disabled={!onSelectModel}
              title={`${m.key} — 전체 호출 ${m.calls.toLocaleString()} · 실패 ${m.failed.toLocaleString()} (타임아웃 ${m.timeout.toLocaleString()} · LLM 오류 ${other.toLocaleString()})`}
            >
              <span className="mv-name qmodel">{m.key}</span>

              <span className="mv-bars">
                <span className="mv-bar mv-bar-calls">
                  <span className="mv-seg-calls" style={{ width: w(m.calls) }} />
                </span>
                <span className="mv-bar mv-bar-fail">
                  {m.timeout > 0 && (
                    <span className="mv-seg-timeout" style={{ width: w(m.timeout), minWidth: MIN_SEG }} />
                  )}
                  {other > 0 && (
                    <span className="mv-seg-other" style={{ width: w(other), minWidth: MIN_SEG }} />
                  )}
                </span>
              </span>

              <span className="mv-nums mono">
                <span className="mv-calls">{m.calls.toLocaleString()}</span>
                <span className="mv-failed">{m.failed.toLocaleString()} 실패</span>
              </span>

              <span className="mv-rate mono">
                <span
                  className={
                    "mv-rate-val" +
                    (m.failed === 0 ? " is-clean" : rate >= worstRate && worstRate > 0 ? " is-worst" : "")
                  }
                >
                  {pct(m.failed, m.calls)}
                </span>
                <span className="mv-rate-sub">실패율</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
