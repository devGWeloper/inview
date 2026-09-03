"use client";
// 차트 틱 단위 — 기간과 독립된 축이다. 기본은 `집계`. docs/screens/tick.md

import { useCallback, useEffect, useMemo, useState } from "react";
import { TICK_UNITS, TickUnit, clampTickUnit, isTickUnit, tickUnitLabel, tickUnitsFor } from "@/lib/timeBuckets";

const storageKey = (k: string) => `tracex.tick.${k}`;

export interface TickCtl {
  unit: TickUnit;
  // 그 기간에서 **누를 수 있는** 단위들. 목록에서 빼는 게 아니라 나머지를 잠그는 데 쓴다.
  enabled: TickUnit[];
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
  const enabled = useMemo(() => tickUnitsFor(spanMs), [spanMs]);
  const unit = useMemo(() => clampTickUnit(want, spanMs), [want, spanMs]);

  return { unit, enabled, ready, setUnit, unitFor };
}

export function TickSelect({
  value, enabled, onChange, pulsing,
}: {
  value: TickUnit;
  enabled: TickUnit[];
  onChange: (u: TickUnit) => void;
  pulsing?: boolean;
}) {
  // ⚠️ 못 고르는 단위도 **자리는 그대로 두고 잠근다.** 목록에서 빼면 기간을 바꿀 때마다
  //    폭이 흔들리고 "아까 있던 게 어디 갔지" 가 된다. 왜 잠겼는지는 적지 않는다.
  const btn = (u: TickUnit) => {
    const off = !enabled.includes(u);
    return (
      <button
        key={u}
        type="button"
        role="tab"
        disabled={off}
        aria-selected={value === u}
        className={"tick-select-btn" + (value === u ? " active" : "") + (off ? " off" : "")}
        onClick={() => onChange(u)}
      >
        {u === "1m" && (
          <span className={"live-dot" + (value === u && pulsing ? " pulse" : "")} aria-hidden="true" />
        )}
        {tickUnitLabel(u)}
      </button>
    );
  };

  return (
    <div className="tick-select" role="tablist" aria-label="차트 단위">
      {btn("agg")}
      <span className="tick-select-key" aria-hidden="true">틱</span>
      {TICK_UNITS.filter((u) => u !== "agg").map(btn)}
    </div>
  );
}
