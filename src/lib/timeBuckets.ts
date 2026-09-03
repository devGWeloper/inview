// 시간 버킷 격자 — 추이 차트를 쓰는 집계들이 공유한다.
// 기간과 틱 단위는 서로 독립된 축이다. docs/screens/tick.md

export type Granularity = "1m" | "5m" | "10m" | "30m" | "1h" | "1d";

// 차트가 무엇을 그리는가. "agg" = 기간에 맞춰 서버가 자동으로 고르는 집계 격자(기본값).
// 나머지는 전부 그 격자로 집계한다. **1분도 예외가 아니다** — 대시보드에서 1분은
// 5·10·30분과 똑같이 정각 분 격자다.
// 예외는 Tokens·Timeout 두 화면뿐이다: 거긴 분당 한도(TPM/RPM) 판정이 목적이라
// 1분일 때만 롤링 60초 틱 라우트를 부른다(정각 분 격자로는 임의의 연속 60초를 못 잡는다).
export type TickUnit = "agg" | "1m" | "5m" | "10m" | "30m" | "1h";

export const TICK_UNITS: readonly TickUnit[] = ["agg", "1m", "5m", "10m", "30m", "1h"] as const;

const UNIT_MS: Record<Exclude<TickUnit, "agg">, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "10m": 600_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
};

const GRAN_MS: Record<Granularity, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "10m": 600_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "1d": 86_400_000,
};

// 한 차트에 그리는 점의 상한. 24시간을 1분으로 본 값이라 1분 틱의 상한과 같다.
export const MAX_POINTS = 1440;
const MIN_POINTS = 3;
const TARGET_POINTS = 100;

export function tickUnitLabel(u: TickUnit): string {
  return u === "agg" ? "집계" : granularityLabel(u);
}

export function granularityLabel(g: Granularity): string {
  if (g === "1h") return "1시간";
  if (g === "1d") return "1일";
  return g.replace("m", "분");
}

export function isTickUnit(v: unknown): v is TickUnit {
  return typeof v === "string" && (TICK_UNITS as readonly string[]).includes(v);
}

// 그 기간에서 고를 수 있는 틱 단위들. 예산을 넘거나 칸이 몇 개 안 되는 단위는
// 비활성이 아니라 **목록에 아예 없다** — 없는 건 사유를 설명할 게 없다.
// "집계" 는 서버가 알아서 고르므로 언제나 있다.
export function tickUnitsFor(spanMs: number): TickUnit[] {
  const units = (["1m", "5m", "10m", "30m", "1h"] as const).filter((u) => {
    const n = spanMs / UNIT_MS[u];
    return n >= MIN_POINTS && n <= MAX_POINTS;
  });
  return ["agg", ...units];
}

// 고른 단위가 그 기간에서 무효면 집계로 돌아간다.
export function clampTickUnit(u: TickUnit, spanMs: number): TickUnit {
  return tickUnitsFor(spanMs).includes(u) ? u : "agg";
}

// 틱 단위를 집계 라우트의 g= 로 옮긴다. `집계` 만 안 보낸다(서버가 고른다).
// 1분도 여기서는 그냥 정각 분 격자다 — 롤링 60초(TPM/RPM 판정)는 Tokens·Timeout 전용이고,
// 그 두 화면은 1분일 때 g 대신 틱 라우트를 부른다.
export function granOfTickUnit(u: TickUnit): Granularity | undefined {
  return u === "agg" ? undefined : u;
}

// 집계 격자. **이건 원래 규칙 그대로다 — 건드리지 말 것.**
// 차트를 잘게 보고 싶은 요구는 집계가 아니라 틱 단위가 받는다.
export function pickGranularity(fromMs: number, toMs: number): Granularity {
  const hours = (toMs - fromMs) / 3_600_000;
  if (hours <= 2) return "5m";
  if (hours <= 48) return "1h";
  return "1d";
}

// 쿼리스트링의 g= 파싱. 모르는 값은 undefined 로 떨궈 집계 격자를 쓰게 한다.
export function parseGranularityParam(v: string | null): Granularity | undefined {
  return v !== null && v in GRAN_MS ? (v as Granularity) : undefined;
}

// 요청된 격자를 그 기간에 맞춰 검증한다. 라우트가 아니라 여기서 조인다 —
// 어떤 호출자도 예산을 우회할 수 없어야 한다.
export function resolveGranularity(
  want: Granularity | undefined,
  fromMs: number,
  toMs: number
): Granularity {
  if (!want) return pickGranularity(fromMs, toMs);
  const span = Math.max(0, toMs - fromMs);
  const n = span / GRAN_MS[want];
  return n >= MIN_POINTS && n <= MAX_POINTS ? want : pickGranularity(fromMs, toMs);
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

  // **자정을 넘으면 key 에 날짜가 있어야 한다.** 시:분만 쓰면 정확히 24시간인 구간의
  // 양 끝(`09:11`)이 같은 값이 되어 눈금이 겹친다 — 1분 틱 조회가 딱 그렇다.
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
  return GRAN_MS[g];
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
