// 시간 버킷 격자 — 추이 차트를 쓰는 집계들이 공유한다.
// 기간과 틱 단위는 서로 독립된 축이다. docs/screens/tick.md

export type Granularity = "5m" | "10m" | "30m" | "1h" | "1d";

// 차트가 무엇을 그리는가. "agg" = 기간에 맞춰 서버가 자동으로 고르는 집계 격자(기본값).
// 나머지는 틱 단위이고, "1m" 만 집계가 아니라 틱 라우트(롤링 60초)로 간다 —
// 정각 분 버킷은 TPM/RPM 판정 기준이 못 되므로 Granularity 에 넣지 않는다.
export type TickUnit = "agg" | "1m" | "5m" | "10m" | "30m";

export const TICK_UNITS: readonly TickUnit[] = ["agg", "1m", "5m", "10m", "30m"] as const;

const UNIT_MS: Record<Exclude<TickUnit, "agg">, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "10m": 600_000,
  "30m": 1_800_000,
};

const GRAN_MS: Record<Granularity, number> = {
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
  return u === "agg" ? "집계" : u === "1m" ? "1분" : u === "5m" ? "5분" : u === "10m" ? "10분" : "30분";
}

export function granularityLabel(g: Granularity): string {
  return g === "5m" ? "5분" : g === "10m" ? "10분" : g === "30m" ? "30분" : g === "1h" ? "1시간" : "1일";
}

export function isTickUnit(v: unknown): v is TickUnit {
  return typeof v === "string" && (TICK_UNITS as readonly string[]).includes(v);
}

// 그 기간에서 고를 수 있는 틱 단위들. 예산을 넘거나 칸이 몇 개 안 되는 단위는
// 비활성이 아니라 **목록에 아예 없다** — 없는 건 사유를 설명할 게 없다.
// "집계" 는 서버가 알아서 고르므로 언제나 있다.
export function tickUnitsFor(spanMs: number): TickUnit[] {
  const units = (["1m", "5m", "10m", "30m"] as const).filter((u) => {
    const n = spanMs / UNIT_MS[u];
    return n >= MIN_POINTS && n <= MAX_POINTS;
  });
  return ["agg", ...units];
}

// 고른 단위가 그 기간에서 무효면 집계로 돌아간다.
export function clampTickUnit(u: TickUnit, spanMs: number): TickUnit {
  return tickUnitsFor(spanMs).includes(u) ? u : "agg";
}

// 틱 단위를 집계 라우트의 g= 로 옮긴다. 집계와 1분은 g 를 안 보낸다
// (집계는 서버가 고르고, 1분은 틱 라우트가 그린다).
export function granOfTickUnit(u: TickUnit): Granularity | undefined {
  return u === "5m" || u === "10m" || u === "30m" ? u : undefined;
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

// 추이 차트 X축. **눈금 key 는 유일해야 하고(recharts 의 category dataKey),
// 화면에 보이는 글자는 짧아야 한다** — 이 둘을 같은 문자열로 쓰면 하나를 잃는다.
//
// key 가 겹치면(30일치를 시:분만으로 찍는 경우) `06:00 13:00 20:00 03:00 …` 처럼 라벨이
// 날마다 되돌아와 차트가 되풀이되는 것처럼 보이고, peak 선·툴팁이 첫 번째 것에 붙는다.
// 반대로 전부 `08-03 06:00` 으로 찍으면 글자가 짜잘해진다.
// 그래서 key 는 날짜까지 갖되, 보이는 건 **자정에만 날짜, 나머지는 시:분**이다(증권 차트 방식).
export interface TickAxis {
  key: (ts: string) => string;
  short: (key: string) => string;
}

const asIs = (v: string) => v;

export function tickAxis(
  firstTs: string | undefined,
  lastTs: string | undefined,
  g: Granularity
): TickAxis {
  if (g === "1d") return { key: (ts) => ts.slice(5, 10), short: asIs };

  const a = firstTs ? Date.parse(firstTs) : NaN;
  const b = lastTs ? Date.parse(lastTs) : NaN;
  const multiDay = Number.isFinite(a) && Number.isFinite(b) && b - a > 86_400_000;
  if (!multiDay) return { key: (ts) => ts.slice(11, 16), short: asIs };

  return {
    key: (ts) => `${ts.slice(5, 10)} ${ts.slice(11, 16)}`,
    short: (k) => (k.endsWith(" 00:00") ? k.slice(0, 5) : k.slice(6)),
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
