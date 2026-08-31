"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Tokens / Timeout 탭이 공유하는 조회 기간.
//
// 두 화면은 성격이 같고(둘 다 TRX_TOKEN_DET 기준 LLM 호출 조회) 오가며 같이 보는데,
// 예전엔 각자 로컬 state 라 ① 프리셋 구성·라벨이 갈렸고 ② 탭을 옮기면 선택이 사라져
// 직접 설정한 시각을 매번 다시 입력해야 했다. 상태를 여기 한 곳으로 모아 해소한다.
//
// ⚠️ 두 페이지는 이 컨텍스트만 읽고 쓴다 — 페이지에 프리셋 배열이나 기간 state 를
//    따로 두면 지금 고친 불일치가 그대로 되살아난다.
// ⚠️ 노드/모델/USER 필터는 공유하지 않는다 — 에이전트 전환 시 비워야 하고(남의 노드명이
//    걸려 "사용량 0" 으로 오독된다) 두 화면의 차원 목록도 다르다.
// ─────────────────────────────────────────────────────────────────────────────

export type RangePreset = "1h" | "6h" | "24h" | "7d" | "30d";

/** 프리셋 라벨/길이의 단일 소스 — 두 페이지가 이 배열을 그대로 렌더한다. */
export const RANGE_PRESETS: { key: RangePreset; label: string; hours: number }[] = [
  { key: "1h", label: "1H", hours: 1 },
  { key: "6h", label: "6H", hours: 6 },
  { key: "24h", label: "24H", hours: 24 },
  { key: "7d", label: "7D", hours: 168 },
  { key: "30d", label: "30D", hours: 720 },
];

/** '직접 설정' 버튼 문구 — 앱의 다른 기간 UI(/insights 등)와 같은 표기. */
export const CUSTOM_LABEL = "직접 설정";

/** 공유 기본값. 두 탭이 한 상태를 쓰므로 기본도 하나여야 한다. */
export const DEFAULT_PRESET: RangePreset = "7d";

const STORAGE_KEY = "tracex.timeRange";

/** 적용된 선택 (입력 중인 초안이 아니다 — 초안은 각 페이지 로컬) */
export interface TimeRangeSel {
  preset: RangePreset | "custom";
  /** 'YYYY-MM-DDTHH:MM' (datetime-local 값) */
  customFrom: string;
  customTo: string;
}

/** 조회에 넘길 실제 구간 — 'YYYY-MM-DDTHH:MM:SS' 로컬 문자열 */
export interface ResolvedRange {
  from: string;
  to: string;
}

const DEFAULT_SEL: TimeRangeSel = { preset: DEFAULT_PRESET, customFrom: "", customTo: "" };

/** ms → 'YYYY-MM-DDTHH:MM:SS' (로컬) */
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
 * ⚠️ 프리셋은 항상 '지금' 기준이라 **호출 시점에** 계산해야 한다 — 결과를 상태에 저장해 두면
 *    어제 열어 둔 탭의 7D 가 어제 기준으로 굳는다.
 */
export function resolveRange(sel: TimeRangeSel): ResolvedRange {
  if (sel.preset === "custom" && sel.customFrom && sel.customTo) {
    return { from: withSec(sel.customFrom, "00"), to: withSec(sel.customTo, "59") };
  }
  const hours = (RANGE_PRESETS.find((p) => p.key === sel.preset) ?? RANGE_PRESETS.find((p) => p.key === DEFAULT_PRESET)!).hours;
  const now = Date.now();
  return { from: toLocalSec(now - hours * 3_600_000), to: toLocalSec(now) };
}

/** 저장값 복원 — 형식이 다르거나 모르는 프리셋이면 기본값으로 되돌린다. */
function readStored(): TimeRangeSel {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SEL;
    const v = JSON.parse(raw) as Partial<TimeRangeSel>;
    const known = v.preset === "custom" || RANGE_PRESETS.some((p) => p.key === v.preset);
    const preset = known ? (v.preset as TimeRangeSel["preset"]) : DEFAULT_PRESET;
    const customFrom = typeof v.customFrom === "string" ? v.customFrom : "";
    const customTo = typeof v.customTo === "string" ? v.customTo : "";
    // custom 인데 구간이 비어 있으면 조회가 불가능하다 — 기본 프리셋으로 되돌린다.
    if (preset === "custom" && !(customFrom && customTo)) return DEFAULT_SEL;
    return { preset, customFrom, customTo };
  } catch {
    return DEFAULT_SEL;
  }
}

interface TimeRangeCtx {
  sel: TimeRangeSel;
  /** localStorage 복원이 끝났는가 — 페이지는 이게 true 가 된 뒤 조회한다 */
  ready: boolean;
  /** 프리셋 선택 (직접 설정 입력값은 그대로 보존해 되돌아올 때 다시 쓴다) */
  setPreset: (p: RangePreset) => void;
  /** 직접 설정 적용 — 초안을 커밋한다 */
  setCustom: (from: string, to: string) => void;
  /** 현재 선택을 실제 조회 구간으로 (호출 시점 기준) */
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
  // 콜백이 최신 선택을 보되 매 렌더마다 새 함수가 되지 않도록 하는 ref
  const selRef = useRef(sel);
  selRef.current = sel;
  // SSR 에서는 localStorage 를 읽을 수 없다. 첫 렌더는 기본값으로 하고 마운트 후 복원하며,
  // 페이지는 ready 를 기다렸다 조회해 "기본값으로 한 번 + 복원값으로 한 번" 이중 조회를 피한다.
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
      /* 저장 실패(프라이빗 모드 등)는 무해 — 이번 세션에서만 유지된다 */
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
