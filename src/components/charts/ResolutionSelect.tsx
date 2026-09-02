"use client";
// 차트 해상도 축 — 기간과 독립이다. docs/screens/tick.md

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Resolution,
  clampResolution,
  defaultResolution,
  isResolution,
  resolutionLabel,
  resolutionsFor,
} from "@/lib/timeBuckets";

const storageKey = (k: string) => `tracex.res.${k}`;

export interface ResolutionCtl {
  res: Resolution;
  options: Resolution[];
  ready: boolean;
  setRes: (r: Resolution) => void;
  // 기간을 바꾸는 핸들러용 — 아직 state 에 반영되지 않은 새 구간의 유효 해상도.
  resFor: (spanMs: number) => Resolution;
}

// 저장하는 건 사용자가 마지막으로 **고른** 값이고, 화면에 쓰는 값은 기간에 맞춰 파생한다.
// 그래서 30D 로 갔다 1H 로 돌아오면 눌러뒀던 1분이 저절로 살아난다.
// 고른 적이 없으면(null) 서버와 같은 기본 규칙을 쓴다.
export function useResolution(key: string, spanMs: number): ResolutionCtl {
  const [want, setWant] = useState<Resolution | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(key));
      if (isResolution(raw)) setWant(raw);
    } catch {
    }
    setReady(true);
  }, [key]);

  const setRes = useCallback(
    (r: Resolution) => {
      setWant(r);
      try {
        window.localStorage.setItem(storageKey(key), r);
      } catch {
      }
    },
    [key]
  );

  const resFor = useCallback(
    (ms: number) => (want ? clampResolution(want, ms) : defaultResolution(ms)),
    [want]
  );
  const options = useMemo(() => resolutionsFor(spanMs), [spanMs]);
  const res = useMemo(
    () => (want ? clampResolution(want, spanMs) : defaultResolution(spanMs)),
    [want, spanMs]
  );

  return { res, options, ready, setRes, resFor };
}

export function ResolutionSelect({
  value, options, onChange, pulsing,
}: {
  value: Resolution;
  options: Resolution[];
  onChange: (r: Resolution) => void;
  pulsing?: boolean;
}) {
  if (options.length <= 1) return null;
  return (
    <div className="res-select" role="tablist" aria-label="차트 해상도">
      <span className="res-select-key">해상도</span>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="tab"
          aria-selected={value === o}
          className={"res-select-btn" + (value === o ? " active" : "")}
          onClick={() => onChange(o)}
        >
          {o === "1m" && (
            <span className={"live-dot" + (value === o && pulsing ? " pulse" : "")} aria-hidden="true" />
          )}
          {resolutionLabel(o)}
        </button>
      ))}
    </div>
  );
}
