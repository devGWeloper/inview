
// FTE(절감 인력) 계산. 환산 분은 프로필에서 편집한다. docs/architecture/metrics.md

import { monthlyActionSuccess } from "./db";
import { AgentProfile, FteMonth, FteStats } from "./types";

export const FTE_START_ISO = "2026-01-01T00:00:00";

function isoNoTz(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function ym(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function computeFteStats(profile: AgentProfile, now: Date = new Date()): Promise<FteStats | null> {
  const from = FTE_START_ISO;
  const to = isoNoTz(now);

  const grouped = await monthlyActionSuccess(from, to);
  if (grouped === null) return null;

  const minuteByAction = new Map(profile.fteActionMinutes.map((a) => [a.action, a.minutes]));
  const minutesFor = (action: string | null): number =>
    (action === null ? undefined : minuteByAction.get(action)) ?? profile.fteDefaultMinutes;

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
