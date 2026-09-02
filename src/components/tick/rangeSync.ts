// 집계 ↔ 틱 토글 시 조회 구간을 서로 물려주는 순수 함수. 두 뷰의 후보가 겹치지 않아
// 정확히 같을 수는 없다 — 딱 안 맞는 게 의도다.

import { TICK_WINDOWS, TickSel, TickWindowMin } from "@/components/tick/TickProvider";

const TICK_MAX_MIN = 24 * 60;

export function spanMinutes(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return (b - a) / 60_000;
}

export function tickWinForMinutes(minutes: number): TickWindowMin {
  let best: TickWindowMin = TICK_WINDOWS[0];
  for (const w of TICK_WINDOWS) {
    if (w <= minutes) best = w;
  }
  return best;
}

export function analysisMinutesForTickWin(win: TickWindowMin): number {
  return win;
}

export function tickSelFor(
  minutes: number,
  custom: { from: string; to: string } | null
): Pick<TickSel, "win" | "mode" | "from" | "to"> | Pick<TickSel, "win" | "mode"> {
  if (custom) {
    const span = spanMinutes(custom.from, custom.to);
    if (span !== null && span <= TICK_MAX_MIN) {
      return { mode: "custom", from: custom.from, to: custom.to, win: tickWinForMinutes(span) };
    }
  }
  return { mode: "live", win: tickWinForMinutes(minutes) };
}
