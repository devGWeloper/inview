"use client";
// Tokens ↔ Timeout 이 공유하는 조회 기간. 페이지에 프리셋 배열이나 기간 state 를 다시 두지 말 것.
// 실제 {from,to} 는 저장하지 않고 resolveRange() 가 호출 시점에 계산한다.
// docs/architecture/ui-conventions.md

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type RangePreset = "1h" | "6h" | "24h" | "7d" | "30d";

export const RANGE_PRESETS: { key: RangePreset; label: string; hours: number }[] = [
  { key: "1h", label: "1H", hours: 1 },
  { key: "6h", label: "6H", hours: 6 },
  { key: "24h", label: "24H", hours: 24 },
  { key: "7d", label: "7D", hours: 168 },
  { key: "30d", label: "30D", hours: 720 },
];

export const CUSTOM_LABEL = "직접 설정";

export const DEFAULT_PRESET: RangePreset = "7d";

const STORAGE_KEY = "tracex.timeRange";

export interface TimeRangeSel {
  preset: RangePreset | "custom";
  customFrom: string;
  customTo: string;
}

export interface ResolvedRange {
  from: string;
  to: string;
}

const DEFAULT_SEL: TimeRangeSel = { preset: DEFAULT_PRESET, customFrom: "", customTo: "" };

export function toLocalSec(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function toLocalMin(ms: number): string {
  return toLocalSec(ms).slice(0, 16);
}

function withSec(v: string, sec: string): string {
  return v.length === 16 ? `${v}:${sec}` : v;
}

export function resolveRange(sel: TimeRangeSel): ResolvedRange {
  if (sel.preset === "custom" && sel.customFrom && sel.customTo) {
    return { from: withSec(sel.customFrom, "00"), to: withSec(sel.customTo, "59") };
  }
  const hours = (RANGE_PRESETS.find((p) => p.key === sel.preset) ?? RANGE_PRESETS.find((p) => p.key === DEFAULT_PRESET)!).hours;
  const now = Date.now();
  return { from: toLocalSec(now - hours * 3_600_000), to: toLocalSec(now) };
}

// 틱 단위 축이 쓰는 구간 길이. resolveRange() 는 매번 '지금' 을 다시 잡으므로 길이만 따로 센다.
export function spanOfSel(sel: TimeRangeSel): number {
  if (sel.preset === "custom") {
    const a = Date.parse(sel.customFrom);
    const b = Date.parse(sel.customTo);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) return b - a;
    return 24 * 3_600_000;
  }
  const p = RANGE_PRESETS.find((x) => x.key === sel.preset) ?? RANGE_PRESETS[0];
  return p.hours * 3_600_000;
}

function readStored(): TimeRangeSel {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SEL;
    const v = JSON.parse(raw) as Partial<TimeRangeSel>;
    const known = v.preset === "custom" || RANGE_PRESETS.some((p) => p.key === v.preset);
    const preset = known ? (v.preset as TimeRangeSel["preset"]) : DEFAULT_PRESET;
    const customFrom = typeof v.customFrom === "string" ? v.customFrom : "";
    const customTo = typeof v.customTo === "string" ? v.customTo : "";
    if (preset === "custom" && !(customFrom && customTo)) return DEFAULT_SEL;
    return { preset, customFrom, customTo };
  } catch {
    return DEFAULT_SEL;
  }
}

interface TimeRangeCtx {
  sel: TimeRangeSel;
  ready: boolean;
  setPreset: (p: RangePreset) => void;
  setCustom: (from: string, to: string) => void;
  resolve: () => ResolvedRange;
}

const Ctx = createContext<TimeRangeCtx>({
  sel: DEFAULT_SEL,
  ready: false,
  setPreset: () => {},
  setCustom: () => {},
  resolve: () => resolveRange(DEFAULT_SEL),
});

export function useTimeRange(): TimeRangeCtx {
  return useContext(Ctx);
}

export function TimeRangeProvider({ children }: { children: React.ReactNode }) {
  const [sel, setSel] = useState<TimeRangeSel>(DEFAULT_SEL);
  const selRef = useRef(sel);
  selRef.current = sel;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSel(readStored());
    setReady(true);
  }, []);

  const persist = useCallback((next: TimeRangeSel) => {
    setSel(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
    }
  }, []);

  const setPreset = useCallback(
    (p: RangePreset) => persist({ ...selRef.current, preset: p }),
    [persist]
  );
  const setCustom = useCallback(
    (from: string, to: string) => persist({ preset: "custom", customFrom: from, customTo: to }),
    [persist]
  );

  const resolve = useCallback(() => resolveRange(selRef.current), []);

  const value = useMemo<TimeRangeCtx>(
    () => ({ sel, ready, setPreset, setCustom, resolve }),
    [sel, ready, setPreset, setCustom, resolve]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
