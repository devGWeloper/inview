
// JSON envelope 에서 사람이 읽는 문장만 뽑는 best-effort 추출.

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
