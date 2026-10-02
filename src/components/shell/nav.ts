import { Role, canAccessPath, isBizPath, requiredRoleForPath } from "@/lib/roles";

export type NavIcon =
  | "traces" | "dashboard" | "tokens" | "timeout" | "insights"
  | "improvement" | "eventFabs" | "accounts" | "profileEdit"
  | "calendar";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
}

export interface NavGroup {
  key: "analysis" | "admin";
  label: string;
  items: NavItem[];
}

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
];

export const TOOLS_LABEL = "도구";

export const TOOL_ITEMS: NavItem[] = [
  { href: "/roadmap", label: "달력", icon: "calendar" },
];

const OFF_NAV: { href: string; group: string; label: string }[] = [
  { href: "/agent", group: "Agent", label: "프로필" },
];

export function isNavActive(href: string, path: string): boolean {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

// 표시 제어일 뿐 — 실제 차단은 미들웨어(canAccessPath)와 각 API 의 requireBiz()
export function visibleNav(role: Role, isDefault: boolean): NavGroup[] {
  return NAV_GROUPS
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => canAccessPath(role, it.href) && (isDefault || !isBizPath(it.href))),
    }))
    .filter((g) => g.items.length > 0);
}

export function visibleTools(role: Role): NavItem[] {
  return TOOL_ITEMS.filter((it) => canAccessPath(role, it.href));
}

export function adminOnly(href: string): boolean {
  return requiredRoleForPath(href) === "ADMIN";
}

export function locatePage(path: string): { group: string; label: string } | null {
  for (const g of NAV_GROUPS) {
    const it = g.items.find((i) => isNavActive(i.href, path));
    if (it) return { group: g.label, label: it.label };
  }
  const tool = TOOL_ITEMS.find((i) => isNavActive(i.href, path));
  if (tool) return { group: TOOLS_LABEL, label: tool.label };
  return OFF_NAV.find((o) => isNavActive(o.href, path)) ?? null;
}
