"use client";
// 틱 뷰의 창 길이·모드를 Dashboard/Tokens/Timeout 이 공유한다 (뷰 on/off 만 화면별).
// docs/screens/tick.md

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export const TICK_WINDOWS = [1, 5, 10, 15, 30, 60, 180] as const;
export type TickWindowMin = typeof TICK_WINDOWS[number];

export type TickMode = "live" | "custom";

export const DEFAULT_TICK_WINDOW: TickWindowMin = 15;

const STORAGE_KEY = "tracex.tick";

export function tickRefreshMs(win: TickWindowMin): number {
  return win <= 10 ? 10_000 : 30_000;
}

export function tickWindowLabel(win: number): string {
  return win < 60 ? `${win}분` : `${win / 60}시간`;
}

export interface TickSel {
  win: TickWindowMin;
  mode: TickMode;
  from: string;
  to: string;
  auto: boolean;
}

export interface TickRange {
  from: string;
  to: string;
}

const DEFAULT_SEL: TickSel = {
  win: DEFAULT_TICK_WINDOW,
  mode: "live",
  from: "",
  to: "",
  auto: false,
};

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

export function resolveTickRange(sel: TickSel): TickRange {
  if (sel.mode === "custom" && sel.from && sel.to) {
    return { from: withSec(sel.from, "00"), to: withSec(sel.to, "59") };
  }
  const now = Date.now();
  return { from: toLocalSec(now - sel.win * 60_000), to: toLocalSec(now) };
}

function readStored(): TickSel {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SEL;
    const v = JSON.parse(raw) as Partial<TickSel>;
    const win = TICK_WINDOWS.includes(v.win as TickWindowMin)
      ? (v.win as TickWindowMin)
      : DEFAULT_TICK_WINDOW;
    const from = typeof v.from === "string" ? v.from : "";
    const to = typeof v.to === "string" ? v.to : "";
    const mode: TickMode = v.mode === "custom" && from && to ? "custom" : "live";
    return { win, mode, from, to, auto: v.auto === true };
  } catch {
    return DEFAULT_SEL;
  }
}

interface TickCtx {
  sel: TickSel;
  ready: boolean;
  setWin: (w: TickWindowMin) => void;
  setCustom: (from: string, to: string) => void;
  apply: (patch: Partial<TickSel>) => void;
  setAuto: (v: boolean) => void;
  resolve: () => TickRange;
}

const Ctx = createContext<TickCtx>({
  sel: DEFAULT_SEL,
  ready: false,
  setWin: () => {},
  setCustom: () => {},
  apply: () => {},
  setAuto: () => {},
  resolve: () => resolveTickRange(DEFAULT_SEL),
});

export function useTick(): TickCtx {
  return useContext(Ctx);
}

export function TickProvider({ children }: { children: React.ReactNode }) {
  const [sel, setSel] = useState<TickSel>(DEFAULT_SEL);
  const selRef = useRef(sel);
  selRef.current = sel;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSel(readStored());
    setReady(true);
  }, []);

  const persist = useCallback((next: TickSel) => {
    selRef.current = next;
    setSel(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
    }
  }, []);

  const setWin = useCallback(
    (w: TickWindowMin) => persist({ ...selRef.current, win: w, mode: "live" }),
    [persist]
  );
  const setCustom = useCallback(
    (from: string, to: string) => persist({ ...selRef.current, mode: "custom", from, to }),
    [persist]
  );
  const apply = useCallback(
    (patch: Partial<TickSel>) => persist({ ...selRef.current, ...patch }),
    [persist]
  );
  const setAuto = useCallback((v: boolean) => persist({ ...selRef.current, auto: v }), [persist]);

  const resolve = useCallback(() => resolveTickRange(selRef.current), []);

  const value = useMemo<TickCtx>(
    () => ({ sel, ready, setWin, setCustom, apply, setAuto, resolve }),
    [sel, ready, setWin, setCustom, apply, setAuto, resolve]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTickView(key: string): [boolean, (v: boolean) => void, boolean] {
  const storageKey = `${STORAGE_KEY}.view.${key}`;
  const [on, setOnState] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === "1") {
        setOnState(true);
      } else if (raw === null && key === "tokens") {
        const legacy = window.localStorage.getItem(STORAGE_KEY);
        if (legacy && (JSON.parse(legacy) as { view?: boolean }).view === true) setOnState(true);
      }
    } catch {
    }
    setReady(true);
  }, [storageKey, key]);

  const setOn = useCallback(
    (v: boolean) => {
      setOnState(v);
      try {
        window.localStorage.setItem(storageKey, v ? "1" : "0");
      } catch {
      }
    },
    [storageKey]
  );

  return [on, setOn, ready];
}
