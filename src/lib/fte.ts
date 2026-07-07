// FTE 성과 지표 계산 (이억수 TL).
//
//   연간 FTE = (2026-01-01 ~ 현재 액션 성공 수) × 건당 분 ÷ 연간 분
//   월별 FTE = (해당 월 액션 성공 수) × 건당 분 ÷ 연간 분 × 12   (월 → 연 환산)
//   FTE 1 = 1년간 1인분(1 person-year).
//
//   '액션 성공' = 시즈닝·AutoQual 취소 성공 트레이스 (db.ts monthlyActionSuccess).
//   건당 분·연간 분 상수는 프로필(fteMinutesPerCase/fteAnnualMinutes)에서 가져오며
//   ADMIN 에서 편집할 수 있다 (기본 5 / 65,984 — DEFAULT_PROFILE).
//
// ※ server-only (db.ts 를 통해 Oracle 조회). 클라이언트에서 import 금지.

import { monthlyActionSuccess } from "./db";
import { AgentProfile, FteMonth, FteStats } from "./types";

/** 산정 시작 시점 (2026-01-01) */
export const FTE_START_ISO = "2026-01-01T00:00:00";

function isoNoTz(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function ym(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 액션 성공 수 → 연환산 FTE (월별 집계에 사용) */
export function annualizedMonthlyFte(count: number, minutesPerCase: number, annualMinutes: number): number {
  return (count * minutesPerCase / annualMinutes) * 12;
}

/** 누적 액션 성공 수 → 연간 FTE (헤드라인) */
export function cumulativeFte(totalCount: number, minutesPerCase: number, annualMinutes: number): number {
  return (totalCount * minutesPerCase) / annualMinutes;
}

/**
 * 2026-01 ~ 현재 월까지 월별 FTE 와 누적 연간 FTE 를 계산한다.
 * 계산식 상수(건당 분/연간 분)는 profile 에서 읽는다.
 * DB(CUBE) 가 연결돼 있지 않으면 null (이 경우 호출부는 수동 입력 fte 로 폴백).
 */
export async function computeFteStats(profile: AgentProfile, now: Date = new Date()): Promise<FteStats | null> {
  const from = FTE_START_ISO;
  const to = isoNoTz(now);
  const { fteMinutesPerCase: perCase, fteAnnualMinutes: annual } = profile;

  const monthly = await monthlyActionSuccess(from, to);
  if (monthly === null) return null;

  const countByYm = new Map(monthly.map((m) => [m.ym, m.count]));

  const months: FteMonth[] = [];
  let totalCount = 0;
  const cursor = new Date(2026, 0, 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  while (cursor.getTime() <= lastMonth.getTime()) {
    const key = ym(cursor);
    const count = countByYm.get(key) ?? 0;
    totalCount += count;
    months.push({ ym: key, count, fte: annualizedMonthlyFte(count, perCase, annual) });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return {
    annualFte: cumulativeFte(totalCount, perCase, annual),
    totalCount,
    minutesPerCase: perCase,
    from,
    to,
    months,
  };
}
