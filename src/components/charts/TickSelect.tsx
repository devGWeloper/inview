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
  const on = value !== "agg";

  // 켜짐/꺼짐 토글이다 — 아무것도 안 눌린 상태가 집계다.
  // 같은 칩을 다시 누르면 꺼지고 집계로 돌아온다. `집계` 버튼을 다시 만들지 말 것:
  // 성격이 다른 둘을 같은 줄에 세우면 무엇을 고르는 줄인지 흐려진다.
  return (
    <div className={"tick-select" + (on ? " on" : "")}>
      <span className="tick-select-key">틱</span>
      {TICK_UNITS.filter((u) => u !== "agg").map((u) => {
        const off = !enabled.includes(u);
        const active = value === u;
        return (
          <button
            key={u}
            type="button"
            disabled={off}
            aria-pressed={active}
            className={"tick-select-btn" + (active ? " active" : "") + (off ? " off" : "")}
            onClick={() => onChange(active ? "agg" : u)}
          >
            {/* 점은 켜졌을 때만. 꺼진 칩에 회색 점이 있으면 그것도 골라진 것처럼 읽힌다. */}
            {u === "1m" && active && (
              <span className={"live-dot" + (pulsing ? " pulse" : "")} aria-hidden="true" />
            )}
            {tickUnitLabel(u)}
          </button>
        );
      })}
    </div>
  );
}
