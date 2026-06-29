// ─────────────────────────────────────────────────────────────────────────────
// 시간 버킷 헬퍼 — 시계열 집계(대시보드 stats / 토큰 tokens)가 공유한다.
//   granularity 규칙: 구간 ≤2h → 5분, ≤48h → 1시간, 그 이상 → 1일.
//   시각 문자열은 'YYYY-MM-DDTHH:MM:SS'(TZ 없음, 로컬 기준)로 다룬다.
// ─────────────────────────────────────────────────────────────────────────────

export type Granularity = "5m" | "1h" | "1d";

export function pickGranularity(fromMs: number, toMs: number): Granularity {
  const hours = (toMs - fromMs) / 3_600_000;
  if (hours <= 2) return "5m";
  if (hours <= 48) return "1h";
  return "1d";
}

export function bucketMs(g: Granularity): number {
  return g === "5m" ? 5 * 60_000 : g === "1h" ? 3_600_000 : 86_400_000;
}

export function floorToBucket(ms: number, g: Granularity): number {
  const step = bucketMs(g);
  if (g === "1d") {
    // 로컬 자정 기준 floor
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
  // 'YYYY-MM-DDTHH:MM:SS.fff' → 로컬 파싱 (TZ 제거된 형태이므로 그대로 Date 생성)
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : null;
}

/**
 * from~to 구간을 덮는 버킷 시작 시각(ms) 목록을 오름차순으로 반환.
 * 시계열 차트가 빈 구간도 균일하게 보이도록 "빈 버킷 채우기"에 사용한다.
 */
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
