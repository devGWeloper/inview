// FTE 성과 지표 계산 (이억수 TL).
//
//   연간 FTE = (2026-01-01 ~ 현재 SEA 성공 수) × 5 ÷ 65,984
//   월별 FTE = (해당 월 SEA 성공 수) × 5 ÷ 65,984 × 12   (월 → 연 환산)
//   FTE 1 = 1년간 1인분(1 person-year).
//
// ※ server-only (db.ts 를 통해 Oracle 조회). 클라이언트에서 import 금지.

import { monthlySeaSuccess } from "./db";
import { FteMonth, FteStats } from "./types";

/** 산정 시작 시점 (2026-01-01) */
export const FTE_START_ISO = "2026-01-01T00:00:00";
/** SEA 1건당 환산 분(分) */
export const FTE_MINUTES_PER_SEA = 5;
/** 1 FTE(1인 1년) 에 해당하는 연간 분(分) */
export const FTE_ANNUAL_MINUTES = 65984;

function isoNoTz(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function ym(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** SEA 성공 수 → 연환산 FTE (월별 집계에 사용) */
export function annualizedMonthlyFte(count: number): number {
  return (count * FTE_MINUTES_PER_SEA / FTE_ANNUAL_MINUTES) * 12;
}

/** 누적 SEA 성공 수 → 연간 FTE (헤드라인) */
export function cumulativeFte(totalCount: number): number {
  return (totalCount * FTE_MINUTES_PER_SEA) / FTE_ANNUAL_MINUTES;
}

/**
 * 2026-01 ~ 현재 월까지 월별 FTE 와 누적 연간 FTE 를 계산한다.
 * DB(CUBE) 가 연결돼 있지 않으면 null (이 경우 호출부는 수동 입력 fte 로 폴백).
 */
export async function computeFteStats(now: Date = new Date()): Promise<FteStats | null> {
  const from = FTE_START_ISO;
  const to = isoNoTz(now);

  const monthly = await monthlySeaSuccess(from, to);
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
    months.push({ ym: key, count, fte: annualizedMonthlyFte(count) });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return {
    annualFte: cumulativeFte(totalCount),
    totalCount,
    from,
    to,
    months,
  };
}
