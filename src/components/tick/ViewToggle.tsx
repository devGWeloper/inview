"use client";
// 집계 ↔ 틱 토글. **기간은 안 바뀌고 차트만 바뀐다.** docs/screens/tick.md

import { useCallback, useEffect, useMemo, useState } from "react";
import { canTick } from "@/lib/timeBuckets";

const storageKey = (k: string) => `tracex.tick.${k}`;

export interface TickViewCtl {
  on: boolean;
  canTick: boolean;
  ready: boolean;
  setOn: (v: boolean) => void;
  // 기간을 바꾸는 핸들러용 — 아직 state 에 반영되지 않은 새 구간에서 틱이 켜지는지.
  onFor: (spanMs: number) => boolean;
}

// 저장하는 건 사용자가 **켜둔** 값이고, 화면에 쓰는 값은 기간에 맞춰 파생한다.
// 그래서 24H 에서 틱을 켜고 30D 로 갔다 돌아오면 틱이 저절로 살아난다.
// 클램프를 state 에 써넣지 말 것 — 그러면 그 왕복이 깨진다.
export function useTickView(key: string, spanMs: number): TickViewCtl {
  const [want, setWant] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(storageKey(key)) === "1") setWant(true);
    } catch {
    }
    setReady(true);
  }, [key]);

  const setOn = useCallback(
    (v: boolean) => {
      setWant(v);
      try {
        window.localStorage.setItem(storageKey(key), v ? "1" : "0");
      } catch {
      }
    },
    [key]
  );

  const allowed = useMemo(() => canTick(spanMs), [spanMs]);
  const onFor = useCallback((ms: number) => want && canTick(ms), [want]);

  return { on: want && allowed, canTick: allowed, ready, setOn, onFor };
}

export function ViewToggle({
  on, canTick: allowed, onChange, pulsing,
}: {
  on: boolean;
  canTick: boolean;
  onChange: (v: boolean) => void;
  pulsing?: boolean;
}) {
  return (
    <div
      className={"view-toggle" + (on ? " is-live" : "") + (allowed ? "" : " locked")}
      role="tablist"
      aria-label="보기 전환"
    >
      {/* 미끄러지는 배경. 버튼 뒤에 깔리므로 클릭을 가로채지 않는다. */}
      <span className="view-toggle-thumb" aria-hidden="true" />
      <button
        type="button"
        role="tab"
        aria-selected={!on}
        className={"view-toggle-btn" + (on ? "" : " active")}
        onClick={() => onChange(false)}
      >
        집계
      </button>
      {/* 24시간을 넘는 기간에서는 틱 쪽이 잠긴다. 왜 잠겼는지는 적지 않는다. */}
      <button
        type="button"
        role="tab"
        disabled={!allowed}
        aria-selected={on}
        className={"view-toggle-btn live" + (on ? " active" : "")}
        onClick={() => onChange(true)}
      >
        <span className={"live-dot" + (on && pulsing ? " pulse" : "")} aria-hidden="true" />
        틱
      </button>
    </div>
  );
}
