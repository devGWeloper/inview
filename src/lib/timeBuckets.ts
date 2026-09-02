
// 시간 버킷 격자 — 추이 차트를 쓰는 집계들이 공유한다.

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
