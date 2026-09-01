"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// 틱 뷰가 공유하는 조회 창 — Dashboard / Tokens / Timeout 공통.
//
// 세 화면이 같은 형식(롤링 60초)을 쓰므로 창 길이·직접 설정 구간·자동 갱신 여부까지
// 매번 다시 고르게 하면 화면을 옮길 때마다 같은 입력을 반복하게 된다.
// TimeRangeProvider(기간 분석 뷰) 와 같은 패턴이고, 저장 키만 다르다.
//
// ⚠️ **뷰 on/off 는 공유하지 않는다.** 대시보드를 틱으로 띄워 두고 Tokens 는 기간
//    분석으로 보는 조합이 정상이라, 화면마다 따로 기억한다(useTickView).
// ⚠️ 실제 {from,to} 시각은 저장하지 않는다 — live 창은 항상 '지금' 기준이라 호출 시점에
//    계산해야 한다. 저장해 두면 어제 열어 둔 탭이 어제 기준으로 굳는다.
// ─────────────────────────────────────────────────────────────────────────────

/** 라이브 창 길이(분). 1분은 게이지(현재 값) 위주로 보는 용도다 — 차트는 1~2칸이 된다. */
export const TICK_WINDOWS = [1, 5, 10, 15, 30, 60, 180] as const;
export type TickWindowMin = typeof TICK_WINDOWS[number];

/**
 * 조회 방식.
 *   live   — "지금까지 N분" (창이 계속 앞으로 밀린다. 자동 갱신은 이때만 의미가 있다)
 *   custom — 사용자가 찍은 고정 구간. 과거 이력을 보는 유일한 경로다.
 */
export type TickMode = "live" | "custom";

export const DEFAULT_TICK_WINDOW: TickWindowMin = 15;

const STORAGE_KEY = "tracex.tick";

/**
 * 자동 갱신 주기(ms). 창 길이에 맞춘다 — 1분 창을 30초마다 갱신하면 화면이 반쯤
 * 죽은 것처럼 보이고, 3시간 창을 10초마다 다시 부르면 그냥 낭비다.
 */
export function tickRefreshMs(win: TickWindowMin): number {
  return win <= 10 ? 10_000 : 30_000;
}

/** 창 길이 → 버튼/문구 표기 ("10분", "3시간") */
export function tickWindowLabel(win: number): string {
  return win < 60 ? `${win}분` : `${win / 60}시간`;
}

export interface TickSel {
  win: TickWindowMin;
  mode: TickMode;
  /** 'YYYY-MM-DDTHH:MM' (datetime-local 값) — mode="custom" 에서만 쓰인다 */
  from: string;
  to: string;
  /** live 모드에서 주기적으로 다시 부를지 */
  auto: boolean;
}

/** 조회에 넘길 실제 구간 — 'YYYY-MM-DDTHH:MM:SS' 로컬 문자열 */
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

/**
 * ms → 'YYYY-MM-DDTHH:MM:SS' (로컬).
 * ⚠️ 초 정밀이다 — 분 정밀 + ":00" 을 쓰면 현재 분이 통째로 잘려 방금 난 버스트가 안 잡힌다.
 */
export function toLocalSec(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** ms → 'YYYY-MM-DDTHH:MM' (datetime-local 입력값) */
export function toLocalMin(ms: number): string {
  return toLocalSec(ms).slice(0, 16);
}

/** datetime-local 값('YYYY-MM-DDTHH:MM')에 초를 채운다. */
function withSec(v: string, sec: string): string {
  return v.length === 16 ? `${v}:${sec}` : v;
}

/**
 * 선택을 실제 조회 구간으로 푼다.
 * ⚠️ live 는 호출 시점 기준으로 계산한다 (결과를 상태에 넣어 두면 창이 굳는다).
 * ⚠️ custom 의 끝 시각은 초를 59 로 채워 **그 분을 통째로** 포함시킨다.
 */
export function resolveTickRange(sel: TickSel): TickRange {
  if (sel.mode === "custom" && sel.from && sel.to) {
    return { from: withSec(sel.from, "00"), to: withSec(sel.to, "59") };
  }
  const now = Date.now();
  return { from: toLocalSec(now - sel.win * 60_000), to: toLocalSec(now) };
}

/** 저장값 복원 — 형식이 다르거나 모르는 값이면 기본값으로 되돌린다. */
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
    // custom 인데 구간이 비어 있으면 조회가 불가능하다 — live 로 되돌린다.
    const mode: TickMode = v.mode === "custom" && from && to ? "custom" : "live";
    return { win, mode, from, to, auto: v.auto === true };
  } catch {
    return DEFAULT_SEL;
  }
}

interface TickCtx {
  sel: TickSel;
  /** localStorage 복원이 끝났는가 — 화면은 이게 true 가 된 뒤 조회한다 */
  ready: boolean;
  setWin: (w: TickWindowMin) => void;
  /** 직접 설정 적용 — 초안을 커밋한다 */
  setCustom: (from: string, to: string) => void;
  /**
   * 여러 필드를 한 번에 적용 (집계↔틱 전환 시 구간 물려주기 — rangeSync.ts).
   * setWin + setCustom 을 잇달아 부르면 저장·렌더가 두 번 일어나고 중간 상태로 한 번
   * 조회될 수 있어, 전환처럼 여러 필드가 같이 바뀌는 경우는 이걸 쓴다.
   */
  apply: (patch: Partial<TickSel>) => void;
  setAuto: (v: boolean) => void;
  /** 현재 선택을 실제 조회 구간으로 (호출 시점 기준) */
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
  // 콜백이 최신 선택을 보되 매 렌더마다 새 함수가 되지 않도록 하는 ref
  const selRef = useRef(sel);
  selRef.current = sel;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSel(readStored());
    setReady(true);
  }, []);

  const persist = useCallback((next: TickSel) => {
    // ⚠️ ref 를 **동기적으로** 먼저 갱신한다 — 화면은 창을 고른 직후 곧바로 resolve() 로
    //    조회하는데, setSel 은 비동기라 다음 렌더 전까지 selRef 가 옛 값이면 방금 고른
    //    창이 아니라 이전 창으로 조회하게 된다.
    selRef.current = next;
    setSel(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* 저장 실패(프라이빗 모드 등)는 무해 — 이번 세션에서만 유지된다 */
    }
  }, []);

  // 창 길이를 고르는 것은 곧 "라이브로 본다" 는 뜻이다 — custom 이었다면 같이 풀린다.
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

// ─────────────────────────────────────────────────────────────────────────────
// 화면별 뷰 on/off — 공유하지 않는 유일한 조각이라 훅으로 따로 둔다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "이 화면이 틱 뷰인가" 를 화면별로 기억한다.
 * @param key 화면 식별자 ("tokens" | "timeouts" | "dashboard")
 * @returns [on, setOn, ready] — ready 이전에는 조회하지 않는다(이중 조회 방지)
 */
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
        // 이전 버전은 Tokens 의 1TICK 여부를 tracex.tick 안의 view 필드에 넣었다.
        // 한 번만 옮겨 와, 업데이트 직후 켜 두었던 화면이 꺼진 채로 열리지 않게 한다.
        const legacy = window.localStorage.getItem(STORAGE_KEY);
        if (legacy && (JSON.parse(legacy) as { view?: boolean }).view === true) setOnState(true);
      }
    } catch {
      /* 복원 실패는 무해 — 기본(기간 분석)으로 시작한다 */
    }
    setReady(true);
  }, [storageKey, key]);

  const setOn = useCallback(
    (v: boolean) => {
      setOnState(v);
      try {
        window.localStorage.setItem(storageKey, v ? "1" : "0");
      } catch {
        /* 저장 실패는 무해 */
      }
    },
    [storageKey]
  );

  return [on, setOn, ready];
}
