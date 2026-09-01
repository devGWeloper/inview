import { TICK_WINDOWS, TickSel, TickWindowMin } from "@/components/tick/TickProvider";

// ─────────────────────────────────────────────────────────────────────────────
// 집계 ↔ 틱 전환 시 조회 구간을 물려주는 규칙.
//
// ⚠️ 두 뷰의 구간 후보가 애초에 겹치지 않는다 — 집계는 1H/6H/24H/7D/30D, 틱은 1~180분이다.
//    그래도 토글할 때마다 무관한 구간으로 튀면 사용자가 매번 기간을 다시 고르게 된다.
//    "정확히 같은 구간" 은 불가능하니 **가장 가까운 쪽**으로 옮긴다.
//
// ⚠️ 정확히 안 맞는 건 의도된 것이다. 억지로 맞추려고 집계에 '5분' 을 넣거나 틱에 '7일' 을
//    넣으면 각 뷰가 의미 없는 구간(칸 1개짜리 추이 / 24시간 상한에 잘리는 창)을 갖게 된다.
//
// 순수 함수만 둔다 — 페이지마다 프리셋 배열이 달라(대시보드는 자기 것을 쓴다) 분(minute)을
// 공통 화폐로 주고받고, 실제 프리셋 키 선택은 각 페이지가 자기 목록에서 한다.
// ─────────────────────────────────────────────────────────────────────────────

/** 틱이 한 번에 볼 수 있는 최대 구간(분). 서버 TICK_MAX_MINUTES 와 같다. */
const TICK_MAX_MIN = 24 * 60;

/** 'YYYY-MM-DDTHH:MM' 두 개의 간격(분). 파싱 실패면 null */
export function spanMinutes(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return (b - a) / 60_000;
}

/**
 * 집계 구간(분) → 그 이하로 가장 큰 틱 창.
 * 6시간 이상은 전부 최대 창(180분)이 된다 — 틱의 상한이 그렇다.
 */
export function tickWinForMinutes(minutes: number): TickWindowMin {
  let best: TickWindowMin = TICK_WINDOWS[0];
  for (const w of TICK_WINDOWS) {
    if (w <= minutes) best = w;
  }
  return best;
}

/** 틱 창(분) → 집계 쪽에서 최소한 그만큼은 덮어야 하는 길이(분) */
export function analysisMinutesForTickWin(win: TickWindowMin): number {
  return win;
}

/**
 * 집계 → 틱 으로 넘어갈 때 적용할 틱 선택.
 * @param minutes 집계 쪽이 보고 있던 길이(분)
 * @param custom  집계가 직접 설정이었다면 그 구간('YYYY-MM-DDTHH:MM')
 *
 * 직접 설정은 **24시간 이하일 때만** 그대로 물려준다. 그보다 길면 서버가 뒤쪽 24시간만
 * 남기고 잘라 경고 배너가 뜨는데, 토글 한 번에 경고부터 보게 만들 이유가 없다.
 */
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
