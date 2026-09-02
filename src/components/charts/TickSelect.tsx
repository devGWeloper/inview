"use client";
// 차트 틱 단위 — 기간과 독립된 축이다. 기본은 `집계`. docs/screens/tick.md

import { useCallback, useEffect, useMemo, useState } from "react";
import { TickUnit, clampTickUnit, isTickUnit, tickUnitLabel, tickUnitsFor } from "@/lib/timeBuckets";

const storageKey = (k: string) => `tracex.tick.${k}`;

export interface TickCtl {
  unit: TickUnit;
  options: TickUnit[];
  ready: boolean;
  setUnit: (u: TickUnit) => void;
  // 기간을 바꾸는 핸들러용 — 아직 state 에 반영되지 않은 새 구간의 유효 단위.
  unitFor: (spanMs: number) => TickUnit;
}

// 저장하는 건 사용자가 마지막으로 **고른** 값이고, 화면에 쓰는 값은 기간에 맞춰 파생한다.
// 그래서 24H 에서 1분을 고르고 30D 로 갔다 돌아오면 1분이 저절로 살아난다.
export function useTickUnit(key: string, spanMs: number): TickCtl {
  const [want, setWant] = useState<TickUnit>("agg");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(key));
      if (isTickUnit(raw)) setWant(raw);
    } catch {
    }
    setReady(true);
  }, [key]);

  const setUnit = useCallback(
    (u: TickUnit) => {
      setWant(u);
      try {
        window.localStorage.setItem(storageKey(key), u);
      } catch {
      }
    },
    [key]
  );

  const unitFor = useCallback((ms: number) => clampTickUnit(want, ms), [want]);
  const options = useMemo(() => tickUnitsFor(spanMs), [spanMs]);
  const unit = useMemo(() => clampTickUnit(want, spanMs), [want, spanMs]);

  return { unit, options, ready, setUnit, unitFor };
}

export function TickSelect({
  value, options, onChange, pulsing,
}: {
  value: TickUnit;
  options: TickUnit[];
  onChange: (u: TickUnit) => void;
  pulsing?: boolean;
}) {
  return (
    <div className="tick-select" role="tablist" aria-label="차트 틱 단위">
      {options.map((u) => (
        <button
          key={u}
          type="button"
          role="tab"
          aria-selected={value === u}
          className={"tick-select-btn" + (value === u ? " active" : "") + (u === "agg" ? " agg" : "")}
          onClick={() => onChange(u)}
        >
          {u === "1m" && (
            <span className={"live-dot" + (value === u && pulsing ? " pulse" : "")} aria-hidden="true" />
          )}
          {tickUnitLabel(u)}
        </button>
      ))}
    </div>
  );
}
