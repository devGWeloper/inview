// 실적 화면 표기 — 일반 사용자가 보므로 내부 코드 대신 한글 라벨을 쓴다.

export function pct(n: number | null): string {
  return n === null ? "—" : `${(n * 100).toFixed(1)}%`;
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

export const ACTION_LABEL: Record<string, string> = {
  NEST_Seasoning: "시즈닝",
  AutoQual_JobCreate: "AutoQual 실행",
  AutoQual_Abort: "AutoQual 취소",
};
export function actionLabel(key: string): string {
  return ACTION_LABEL[key] ?? key;
}

export const FAC_NONE = "(none)";
export function facLabel(key: string): string {
  return key === FAC_NONE ? "미상" : key;
}
