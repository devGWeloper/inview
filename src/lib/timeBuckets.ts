// 시간 버킷 격자 — 추이 차트를 쓰는 집계들이 공유한다.
// 해상도(Resolution)는 기간과 독립된 축이다. docs/screens/tick.md

export type Granularity = "5m" | "15m" | "1h" | "1d";

// 차트 해상도. "1m" 만 집계가 아니라 틱 라우트(롤링 60초)로 간다 —
// 정각 분 버킷은 TPM/RPM 판정 기준이 못 되므로 Granularity 에 넣지 않는다.
export type Resolution = "1m" | Granularity;

export const RESOLUTIONS: readonly Resolution[] = ["1m", "5m", "15m", "1h", "1d"] as const;

const RES_MS: Record<Resolution, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "1d": 86_400_000,
};

// 한 차트에 그리는 점의 상한. 24시간을 1분으로 본 값이라 1분 해상도의 상한과 같다.
export const MAX_POINTS = 1440;
const MIN_POINTS = 3;
const TARGET_POINTS = 100;

export function resolutionLabel(r: Resolution): string {
  return r === "1m" ? "1분" : r === "5m" ? "5분" : r === "15m" ? "15분" : r === "1h" ? "1시간" : "1일";
}

export function isResolution(v: unknown): v is Resolution {
  return typeof v === "string" && (RESOLUTIONS as readonly string[]).includes(v);
}

// 그 기간에서 고를 수 있는 해상도들. 예산을 넘거나 칸이 몇 개 안 되는 해상도는
// 비활성이 아니라 **목록에 없다** — 없는 건 사유를 설명할 게 없다.
export function resolutionsFor(spanMs: number): Resolution[] {
  const out = RESOLUTIONS.filter((r) => {
    const n = spanMs / RES_MS[r];
    return n >= MIN_POINTS && n <= MAX_POINTS;
  });
  return out.length > 0 ? out : ["1m"];
}

// 선택이 그 기간에서 무효면 가장 가까운 유효 해상도로 조용히 내려앉는다.
export function clampResolution(r: Resolution, spanMs: number): Resolution {
  const ok = resolutionsFor(spanMs);
  if (ok.includes(r)) return r;
  let best = ok[0];
  let bestDiff = Infinity;
  for (const c of ok) {
    const d = Math.abs(Math.log(RES_MS[c] / RES_MS[r]));
    if (d < bestDiff) {
      bestDiff = d;
      best = c;
    }
  }
  return best;
}

// 기본 해상도 = 유효한 것 중 100칸 이상이면서 가장 성긴 것. 없으면 가장 잔 것.
// (7D 가 7칸으로 뭉뚝해지던 원인이 여기 있었다 — 이제 168칸이 기본이다.)
export function pickGranularity(fromMs: number, toMs: number): Granularity {
  const span = Math.max(0, toMs - fromMs);
  const cands = resolutionsFor(span).filter((r): r is Granularity => r !== "1m");
  if (cands.length === 0) return "5m";
  const enough = cands.filter((r) => span / RES_MS[r] >= TARGET_POINTS);
  return enough.length > 0 ? enough[enough.length - 1] : cands[0];
}

// 쿼리스트링의 g= 파싱. 모르는 값과 "1m" 은 undefined 로 떨궈 기본 해상도를 쓰게 한다
// (집계 라우트는 1분을 그리지 않는다 — 그건 틱 라우트다).
export function parseGranularityParam(v: string | null): Granularity | undefined {
  return isResolution(v) && v !== "1m" ? v : undefined;
}

// 요청된 해상도를 그 기간에 맞춰 검증한다. 라우트가 아니라 여기서 조인다 —
// 어떤 호출자도 예산을 우회할 수 없어야 한다.
export function resolveGranularity(
  want: Granularity | undefined,
  fromMs: number,
  toMs: number
): Granularity {
  if (!want) return pickGranularity(fromMs, toMs);
  const c = clampResolution(want, Math.max(0, toMs - fromMs));
  return c === "1m" ? pickGranularity(fromMs, toMs) : c;
}

// 아직 아무것도 고르지 않았을 때의 해상도. 서버의 pickGranularity 와 같은 규칙이라
// 클라이언트가 g= 를 안 보내도 서버가 고르는 값과 어긋나지 않는다.
export function defaultResolution(spanMs: number): Resolution {
  return pickGranularity(0, Math.max(0, spanMs));
}

export function bucketMs(g: Granularity): number {
  return RES_MS[g];
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
