// 일별 현황 행 — 화면 표(DailyTable)와 리포트 텍스트가 공유한다.
// 두 벌로 두면 한쪽만 고쳐져 표와 복사본이 어긋난다.

import { DailyActionStat, TokenBucket } from "@/lib/types";

export interface DailyRow {
  date: string; // "YYYY-MM-DD"
  total: number;
  ok: number;
  fail: number;
  pending: number;
  users: number;
  avgCubeLatencyMs: number | null;
  byAction: DailyActionStat[];
  tokens: number;
  llmCalls: number;
}

export type DailySource = Omit<DailyRow, "tokens" | "llmCalls">;

export function mergeDailyRows(
  stats: { daily?: DailySource[] | null } | null,
  tok: { buckets: TokenBucket[] } | null
): DailyRow[] {
  const daily = stats?.daily ?? [];
  if (daily.length === 0) return [];
  const tokByDate = new Map<string, { tokens: number; calls: number }>();
  for (const b of tok?.buckets ?? []) {
    const key = b.ts.slice(0, 10);
    const t = tokByDate.get(key) ?? { tokens: 0, calls: 0 };
    t.tokens += b.totalTokens;
    t.calls += b.calls;
    tokByDate.set(key, t);
  }
  return daily.map((d) => ({
    ...d,
    tokens: tokByDate.get(d.date)?.tokens ?? 0,
    llmCalls: tokByDate.get(d.date)?.calls ?? 0,
  }));
}
