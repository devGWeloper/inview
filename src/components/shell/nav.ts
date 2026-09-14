import { Role, canAccessPath, isBizPath, requiredRoleForPath } from "@/lib/roles";

export type NavIcon =
  | "traces" | "dashboard" | "tokens" | "timeout" | "insights"
  | "improvement" | "eventFabs" | "accounts" | "profileEdit"
  | "roadmap" | "layout";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  external?: boolean;
}

export interface NavGroup {
  key: "analysis" | "admin" | "wip";
  label: string;
  items: NavItem[];
}

export interface WipSite extends NavItem {
  what: string;
  state: string;
}

export const WIP_SITES: WipSite[] = [
  {
    href: "/roadmap",
    label: "Action 오픈 로드맵",
    icon: "roadmap",
    what: "Action 이 언제 열렸고 앞으로 무엇을 열지 적어 두는 일정표",
    state: "화면 완성 · 일정 미입력",
  },
  {
    href: "/design-preview.html",
    label: "레이아웃 개편 시안",
    icon: "layout",
    what: "상단바·본문 배치를 바꾼 시안 7종",
    state: "G 안 적용 완료",
    external: true,
  },
];

export const NAV_GROUPS: NavGroup[] = [
  {
    key: "analysis",
    label: "분석",
    items: [
      { href: "/", label: "Traces", icon: "traces" },
      { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
      { href: "/tokens", label: "Tokens", icon: "tokens" },
      { href: "/timeouts", label: "Timeout", icon: "timeout" },
      { href: "/insights", label: "실적", icon: "insights" },
    ],
  },
  {
    key: "admin",
    label: "관리",
    items: [
      { href: "/improvement", label: "Improvement Center", icon: "improvement" },
      { href: "/event-fabs", label: "이벤트-FAB 매핑", icon: "eventFabs" },
      { href: "/accounts", label: "계정 관리", icon: "accounts" },
      { href: "/admin", label: "프로필 편집", icon: "profileEdit" },
    ],
  },
  { key: "wip", label: "공사장", items: WIP_SITES },
];

const OFF_NAV: { href: string; group: string; label: string }[] = [
  { href: "/agent", group: "Agent", label: "프로필" },
  { href: "/wip", group: "공사장", label: "전체 목록" },
];

export function isNavActive(href: string, path: string): boolean {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

// 표시 제어일 뿐 — 실제 차단은 미들웨어(canAccessPath)와 각 API 의 requireBiz()
export function visibleNav(role: Role, isDefault: boolean): NavGroup[] {
  return NAV_GROUPS
    .filter((g) => g.key !== "wip" || role === "ADMIN")
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => canAccessPath(role, it.href) && (isDefault || !isBizPath(it.href))),
    }))
    .filter((g) => g.items.length > 0);
}

export function adminOnly(href: string): boolean {
  return requiredRoleForPath(href) === "ADMIN";
}

export function locatePage(path: string): { group: string; label: string } | null {
  for (const g of NAV_GROUPS) {
    const it = g.items.find((i) => isNavActive(i.href, path));
    if (it) return { group: g.label, label: it.label };
  }
  return OFF_NAV.find((o) => isNavActive(o.href, path)) ?? null;
}
