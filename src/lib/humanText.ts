// 레이어 간 메시지(CUBE SEND/RESP 등)는 보통 JSON envelope 이다.
// 사람이 읽는 문장만 뽑고, 못 찾으면 원문을 그대로 돌려준다.
// (Improvement Center 의 대화 로그와 Timeout 대시보드가 공유한다.)

const TEXT_KEYS = [
  "query", "question", "message", "msg", "text", "content",
  "answer", "reply", "response", "result", "output",
];

export function humanText(raw: string | null): string {
  if (!raw) return "";
  const t = raw.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return t;
  try {
    const seen = new Set<unknown>();
    const walk = (v: unknown, depth: number): string => {
      if (typeof v === "string") return v.trim();
      if (!v || typeof v !== "object" || depth > 3 || seen.has(v)) return "";
      seen.add(v);
      const o = v as Record<string, unknown>;
      for (const k of TEXT_KEYS) {
        const hit = o[k];
        if (typeof hit === "string" && hit.trim()) return hit.trim();
      }
      for (const nested of Object.values(o)) {
        const found = walk(nested, depth + 1);
        if (found) return found;
      }
      return "";
    };
    return walk(JSON.parse(t), 0) || t;
  } catch {
    return t; // JSON 이 아니면 원문
  }
}
