"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAgentScope } from "@/components/agents/AgentScopeProvider";
import { AgentSelector } from "@/components/agents/AgentSelector";
import { NavIcon, NavItem, TOOLS_LABEL, adminOnly, isNavActive, locatePage, visibleNav, visibleTools } from "@/components/shell/nav";
import { LinkBoardNav } from "@/components/shell/link-board/LinkBoardNav";
import { roleAtLeast } from "@/lib/roles";

export function Sidebar({ folded, onToggleFold, version }: { folded: boolean; onToggleFold: () => void; version: string }) {
  const path = usePathname() ?? "/";
  const { user } = useAuth();
  const { isDefault } = useAgentScope();
  const groups = user ? visibleNav(user.role, isDefault) : [];
  const tools = user ? visibleTools(user.role) : [];
  const showLinkBoard = !!user && roleAtLeast(user.role, "DEV");

  return (
    <aside className="sidenav" aria-label="주 메뉴">
      <AgentSelector />
      <nav className="sidenav-scroll">
        {groups.map((g) => (
          <div key={g.key} className={"sidenav-group " + g.key}>
            <div className="sidenav-label">{g.label}</div>
            <div className="sidenav-items">
              {g.items.map((it) => <NavLink key={it.href} it={it} path={path} folded={folded} />)}
            </div>
          </div>
        ))}
        {(tools.length > 0 || showLinkBoard) && (
          <div className="sidenav-group tools">
            <div className="sidenav-label">{TOOLS_LABEL}</div>
            <div className="sidenav-items">
              {tools.map((it) => <NavLink key={it.href} it={it} path={path} folded={folded} />)}
              {showLinkBoard && <LinkBoardNav folded={folded} />}
            </div>
          </div>
        )}
      </nav>
      <div className="sidenav-foot">
        <button
          type="button"
          className="sidenav-item sidenav-fold"
          onClick={onToggleFold}
          aria-expanded={!folded}
          title="메뉴 접기/펼치기 ( [ )"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
               strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9.5 4.5 6 8l3.5 3.5M13 4.5 9.5 8 13 11.5" />
          </svg>
          <span className="sidenav-text">{folded ? "메뉴 펼치기" : "메뉴 접기"}</span>
        </button>
        <div className="sidenav-meta" title={`© 2026 SK hynix · eWorks Agent · TraceX v${version}`}>
          <span className="sidenav-meta-full">© 2026 SK hynix · eWorks Agent</span>
          <span>
            <span className="sidenav-meta-name">TraceX </span>
            <span className="ver">v{version}</span>
          </span>
        </div>
      </div>
    </aside>
  );
}

function NavLink({ it, path, folded }: { it: NavItem; path: string; folded: boolean }) {
  const active = isNavActive(it.href, path);
  return (
    <Link
      href={it.href}
      prefetch={false}
      className={"sidenav-item" + (active ? " active" : "")}
      aria-current={active ? "page" : undefined}
      title={folded ? it.label : undefined}
    >
      <NavIconSvg name={it.icon} />
      <span className="sidenav-text">{it.label}</span>
      {adminOnly(it.href) && <span className="sidenav-tag">ADMIN</span>}
    </Link>
  );
}

export function PageCrumb() {
  const hit = locatePage(usePathname() ?? "/");
  if (!hit) return null;
  return (
    <div className="crumb" aria-label="현재 위치">
      <span className="crumb-group">{hit.group}</span>
      <span className="crumb-sep" aria-hidden>/</span>
      <span className="crumb-page">{hit.label}</span>
    </div>
  );
}

const ICON: Record<NavIcon, JSX.Element> = {
  traces: (
    <>
      <path d="M2 4h12M2 8h12M2 12h7" />
      <circle cx="13" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  dashboard: (
    <>
      <rect x="2" y="2" width="5" height="6.5" rx="1.2" />
      <rect x="2" y="10.5" width="5" height="3.5" rx="1.2" />
      <rect x="9" y="2" width="5" height="3.5" rx="1.2" />
      <rect x="9" y="7.5" width="5" height="6.5" rx="1.2" />
    </>
  ),
  tokens: (
    <>
      <ellipse cx="8" cy="4" rx="5.2" ry="2.2" />
      <path d="M2.8 4v4c0 1.2 2.33 2.2 5.2 2.2s5.2-1 5.2-2.2V4" />
      <path d="M2.8 8v4c0 1.2 2.33 2.2 5.2 2.2s5.2-1 5.2-2.2V8" />
    </>
  ),
  timeout: (
    <>
      <circle cx="8" cy="9" r="5.4" />
      <path d="M8 6.2V9l2 1.4M6 2h4" />
    </>
  ),
  insights: (
    <>
      <path d="M2 13.2h12" />
      <g fill="currentColor" stroke="none">
        <rect x="3" y="7" width="2.6" height="4.2" rx="0.8" />
        <rect x="6.7" y="4.4" width="2.6" height="6.8" rx="0.8" />
        <rect x="10.4" y="2" width="2.6" height="9.2" rx="0.8" />
      </g>
    </>
  ),
  improvement: (
    <>
      <path d="M2.5 11.5 6 8l2.5 2.5L13.5 5.5" />
      <path d="M10 5.5h3.5V9" />
    </>
  ),
  eventFabs: (
    <>
      <rect x="2" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="9.5" y="9" width="4.5" height="4.5" rx="1" />
      <path d="M6.5 4.75h3a2 2 0 0 1 2 2V9" />
    </>
  ),
  accounts: (
    <>
      <circle cx="8" cy="5.5" r="2.6" />
      <path d="M3 13.5c.6-2.4 2.6-3.8 5-3.8s4.4 1.4 5 3.8" />
    </>
  ),
  profileEdit: (
    <>
      <path d="M10.5 2.8l2.7 2.7-7.4 7.4H3.1v-2.7z" />
      <path d="M9 4.3l2.7 2.7" />
    </>
  ),
  calendar: (
    <>
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5.5 1.8v2.4M10.5 1.8v2.4" />
    </>
  ),
};

function NavIconSvg({ name }: { name: NavIcon }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
         strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICON[name]}
    </svg>
  );
}
