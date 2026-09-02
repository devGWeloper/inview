// 실적 화면의 기간 선택 — 최근 구간 / 주 단위 이동 / 직접 설정.
// 주간은 화살표 하나로만 조작한다(이번 주/지난주 버튼을 따로 두지 않는다).
// 지나간 주의 상한을 '지금' 으로 줄이지 말 것 — 매번 다른 구간이 되어 비교가 깨진다.

export type RecentKey = "today" | "7d" | "30d" | "month";

export type Sel =
  | { kind: "recent"; key: RecentKey }
  | { kind: "week"; offset: number }
  | { kind: "custom"; from: string; to: string };

export const RECENT_PRESETS: { key: RecentKey; label: string }[] = [
  { key: "today", label: "오늘" },
  { key: "7d", label: "최근 7일" },
  { key: "30d", label: "최근 30일" },
  { key: "month", label: "이번 달" },
];

export const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

export function weekBadge(offset: number): string {
  if (offset === 0) return "이번 주";
  if (offset === -1) return "지난주";
  return `${-offset}주 전`;
}

export function sameSel(a: Sel, b: Sel): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "recent" && b.kind === "recent") return a.key === b.key;
  if (a.kind === "week" && b.kind === "week") return a.offset === b.offset;
  return false;
}

export function isoNoTz(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function weekRange(offset: number): { from: Date; to: Date } {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7); // (getDay()+6)%7 = 월요일까지의 일수
  const from = new Date(d);
  const to = new Date(d);
  to.setDate(to.getDate() + 7);
  return { from, to };
}

export function rangeDates(sel: Sel): { from: Date; to: Date } {
  const now = new Date();
  if (sel.kind === "custom") {
    const a = new Date(sel.from);
    const b = new Date(sel.to);
    return a <= b ? { from: a, to: b } : { from: b, to: a };
  }
  if (sel.kind === "week") {
    const { from, to } = weekRange(sel.offset);
    return { from, to: to > now ? now : to };
  }
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (sel.key === "7d") start.setDate(start.getDate() - 6);
  else if (sel.key === "30d") start.setDate(start.getDate() - 29);
  else if (sel.key === "month") start.setDate(1);
  return { from: start, to: now };
}

export function rangeOf(sel: Sel): { from: string; to: string } {
  const { from, to } = rangeDates(sel);
  return { from: isoNoTz(from), to: isoNoTz(to) };
}

export function rangeLabel(sel: Sel): string {
  const { from, to } = rangeDates(sel);
  const d = (x: Date) => `${String(x.getMonth() + 1).padStart(2, "0")}/${String(x.getDate()).padStart(2, "0")} (${DAY_KO[x.getDay()]})`;
  if (sel.kind === "custom") {
    const hm = (x: Date) => `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`;
    return `${d(from)} ${hm(from)} ~ ${d(to)} ${hm(to)}`;
  }
  const last = new Date(to.getTime() - 1);
  return from.toDateString() === last.toDateString() ? d(from) : `${d(from)} ~ ${d(last)}`;
}
