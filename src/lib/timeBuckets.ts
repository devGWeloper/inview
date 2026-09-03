// 시간 버킷 격자 — 추이 차트를 쓰는 집계들이 공유한다.
// 기간과 보기(집계/틱)는 서로 독립된 축이다. docs/screens/tick.md

export type Granularity = "5m" | "1h" | "1d";

// 틱(롤링 60초)은 초 단위 SQL 집계라 한 번에 24시간까지만 본다.
// 기간이 이보다 길면 틱을 켤 수 없다 — 토글의 틱 쪽이 잠긴다.
export const TICK_MAX_MS = 24 * 3_600_000;

export function canTick(spanMs: number): boolean {
  return spanMs > 0 && spanMs <= TICK_MAX_MS;
}

export function granularityLabel(g: Granularity): string {
  return g === "5m" ? "5분" : g === "1h" ? "1시간" : "1일";
}

// 집계 격자. **원래 규칙 그대로다 — 건드리지 말 것.**
// 차트를 잘게 보고 싶은 요구는 집계가 아니라 틱이 받는다.
export function pickGranularity(fromMs: number, toMs: number): Granularity {
  const hours = (toMs - fromMs) / 3_600_000;
  if (hours <= 2) return "5m";
  if (hours <= 48) return "1h";
  return "1d";
}

// 추이 차트 X축.
//
// ① **눈금 key 는 유일해야 한다** (recharts 의 category dataKey). 겹치면 30일치가
//    `06:00 13:00 20:00 03:00 …` 처럼 날마다 되돌아오고 peak 선·툴팁이 첫 번째 것에 붙는다.
// ② **찍을 눈금을 여기서 직접 고른다.** recharts 에 맡기면 버킷 인덱스로 균등하게 잘라
//    30일 차트에 시각이 나오거나 `08-04 08-04 08-05` 처럼 같은 날짜가 이어진다.
// ③ 보이는 글자는 구간이 정한다 — 하루가 넘으면 **날짜**, 그 안이면 **시각**.
export interface TickAxis {
  key: (ts: string) => string;
  short: (key: string) => string;
  ticks: string[];
}

const MAX_TICKS = 12;

// n 개 이하로 균등하게 솎는다. 첫 칸은 반드시 남긴다.
function thin<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const step = Math.ceil(items.length / n);
  return items.filter((_, i) => i % step === 0);
}

export function tickAxis(allTs: string[], g?: Granularity): TickAxis {
  const first = allTs[0] ?? "";
  const last = allTs[allTs.length - 1] ?? "";

  if (g === "1d") {
    const key = (ts: string) => ts.slice(5, 10);
    return { key, short: (k) => k, ticks: thin(allTs.map(key), MAX_TICKS) };
  }

  // **자정을 넘으면 key 에 날짜가 있어야 한다.** 시:분만 쓰면 24시간 구간의 양 끝이
  // 같은 값이 되어 눈금이 겹친다(정확히 하루인 틱 조회가 그렇다).
  const crossesDay = first.slice(0, 10) !== last.slice(0, 10);
  const key = crossesDay
    ? (ts: string) => `${ts.slice(5, 10)} ${ts.slice(11, 16)}`
    : (ts: string) => ts.slice(11, 16);

  // 자정 버킷이 둘 이상이면 날짜 축이다 — 눈금은 자정에만 찍고 글자는 `08-04`.
  const midnights = allTs.filter((ts) => ts.slice(11, 16) === "00:00");
  if (crossesDay && midnights.length >= 2) {
    return { key, short: (k) => k.slice(0, 5), ticks: thin(midnights.map(key), MAX_TICKS) };
  }

  // 아니면 시각 축. 정시 버킷이 충분하면 거기에만 찍고, 자정 하나만 날짜로 보여
  // 24시간을 넘겨 도는 구간에서도 어느 날인지 읽히게 한다.
  const hours = allTs.filter((ts) => ts.slice(14, 16) === "00");
  const picked = hours.length >= 4 ? hours : allTs;
  return {
    key,
    short: (k) => (crossesDay ? (k.endsWith(" 00:00") ? k.slice(0, 5) : k.slice(6)) : k),
    ticks: thin(picked.map(key), MAX_TICKS),
  };
}

export function bucketMs(g: Granularity): number {
  return g === "5m" ? 300_000 : g === "1h" ? 3_600_000 : 86_400_000;
}

export function floorToBucket(ms: number, g: Granularity): number {
  const step = bucketMs(g);
  if (g === "1d") {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  return Math.floor(ms / step) * step;
}

export function isoNoTz(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function parseTs(ts: string | null): number | null {
  if (!ts) return null;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : null;
}

export function enumerateBucketStarts(fromMs: number, toMs: number, g: Granularity): number[] {
  const out: number[] = [];
  const startBucket = floorToBucket(fromMs, g);
  const endBucket = floorToBucket(toMs, g);
  if (g === "1d") {
    const d = new Date(startBucket);
    const endD = new Date(endBucket);
    while (d.getTime() <= endD.getTime()) {
      out.push(d.getTime());
      d.setDate(d.getDate() + 1);
    }
  } else {
    const step = bucketMs(g);
    for (let k = startBucket; k <= endBucket; k += step) out.push(k);
  }
  return out;
}
