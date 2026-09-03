"use client";
// 조회 줄의 자동 갱신. 기간이 '지금까지' 인 프리셋일 때만 의미가 있어 custom 이면 잠근다
// (라이브 갱신은 매번 '지금' 으로 구간을 다시 잡아 지정한 구간을 덮어쓴다).

import { useCallback, useEffect, useState } from "react";
import { TickUnit } from "@/lib/timeBuckets";

const storageKey = (k: string) => `tracex.auto.${k}`;

export function refreshMs(unit: TickUnit): number {
  return unit === "1m" ? 10_000 : 30_000;
}

export function useAutoRefresh(key: string): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(storageKey(key)) === "1") setOn(true);
    } catch {
    }
  }, [key]);

  const set = useCallback(
    (v: boolean) => {
      setOn(v);
      try {
        window.localStorage.setItem(storageKey(key), v ? "1" : "0");
      } catch {
      }
    },
    [key]
  );

  return [on, set];
}

export function AutoRefreshToggle({
  on, onChange, disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={"tick-auto" + (disabled ? " off" : "")}>
      <input
        type="checkbox"
        checked={on && !disabled}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      자동 갱신
    </label>
  );
}
