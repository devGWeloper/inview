// FTE 성과 지표 계산 (이억수 TL).
//
//   연간 FTE = Σ(액션별 성공 수 × 액션별 환산 분) ÷ 연간 분
//   월별 FTE = (해당 월 환산 분 합) ÷ 연간 분 × 12   (월 → 연 환산)
//   FTE 1 = 1년간 1인분(1 person-year).
//
//   '액션 성공' 은 db.ts monthlyActionSuccess() 가 월별·액션(ACTION_TYP)별로 집계한다.
//   계산식은 프로필에서 커스터마이즈: fteActionMinutes(ACTION_TYP→분, 예: NEST_Seasoning=5,
//   AutoQual_Abort=10), fteDefaultMinutes(목록에 없는 액션·ACTION_TYP 미상, 기본 5),
//   fteAnnualMinutes(기본 65,984) — 모두 /admin 에서 편집.
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

/**
 * 2026-01 ~ 현재 월까지 월별 FTE 와 누적 연간 FTE 를 계산한다.
 * 계산식 상수(액션별 분/기본 분/연간 분)는 profile 에서 읽는다.
 * DB(CUBE) 가 연결돼 있지 않으면 null (이 경우 카드는 '—' 표시).
 */
export async function computeFteStats(profile: AgentProfile, now: Date = new Date()): Promise<FteStats | null> {
  const from = FTE_START_ISO;
  const to = isoNoTz(now);

  const grouped = await monthlyActionSuccess(from, to);
  if (grouped === null) return null;

  const minuteByAction = new Map(profile.fteActionMinutes.map((a) => [a.action, a.minutes]));
  const minutesFor = (action: string | null): number =>
    (action === null ? undefined : minuteByAction.get(action)) ?? profile.fteDefaultMinutes;

  // 월별 성공 수 + 환산 분 합계 (액션별 분 가중)
  const byYm = new Map<string, { count: number; minutes: number }>();
  for (const g of grouped) {
    let m = byYm.get(g.ym);
    if (!m) {
      m = { count: 0, minutes: 0 };
      byYm.set(g.ym, m);
    }
    m.count += g.count;
    m.minutes += g.count * minutesFor(g.action);
  }

  const annual = profile.fteAnnualMinutes;
  const months: FteMonth[] = [];
  let totalCount = 0;
  let totalMinutes = 0;
  const cursor = new Date(2026, 0, 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  while (cursor.getTime() <= lastMonth.getTime()) {
    const key = ym(cursor);
    const m = byYm.get(key) ?? { count: 0, minutes: 0 };
    totalCount += m.count;
    totalMinutes += m.minutes;
    months.push({ ym: key, count: m.count, fte: (m.minutes / annual) * 12 });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return {
    annualFte: totalMinutes / annual,
    totalCount,
    from,
    to,
    months,
  };
}
