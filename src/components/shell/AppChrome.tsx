"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AgentNavChip } from "@/components/shell/AgentNavChip";
import { PageCrumb, Sidebar } from "@/components/shell/Sidebar";
import { UserMenu } from "@/components/auth/UserMenu";
import { AgentScopeProvider, AgentScopeWarning } from "@/components/agents/AgentScopeProvider";
import { TimeRangeProvider } from "@/components/ui/TimeRangeProvider";

// 기본은 접힘 — 펼쳤을 때만 기록한다 (기록 없음 = 접힘)
const EXPANDED_KEY = "tracex.navExpanded";

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

export function AppChrome({ version, children }: { version: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = pathname === "/login";
  const [folded, setFolded] = useState(true);

  useEffect(() => {
    try { setFolded(localStorage.getItem(EXPANDED_KEY) !== "1"); } catch {}
  }, []);

  const toggleFold = useCallback(() => {
    setFolded((v) => {
      try { localStorage.setItem(EXPANDED_KEY, v ? "1" : "0"); } catch {}
      return !v;
    });
  }, []);

  useEffect(() => {
    if (bare) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      toggleFold();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bare, toggleFold]);

  if (bare) return <>{children}</>;

  return (
    <AgentScopeProvider>
     <TimeRangeProvider>
      <div className={"app" + (folded ? " nav-folded" : "")}>
        <header className="topbar">
          <button
            type="button"
            className="topbar-fold"
            onClick={toggleFold}
            aria-label="메뉴 접기/펼치기"
            aria-expanded={!folded}
            title="메뉴 접기/펼치기 ( [ )"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                 strokeWidth="1.5" strokeLinecap="round" aria-hidden>
              <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
            </svg>
          </button>
          <div className="brand">
            <span className="logo" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" width="15" height="15">
                <path d="M4 17 L10 11 L14 14 L20 6" stroke="#fff" strokeWidth="2.2"
                      strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="4" cy="17" r="1.7" fill="#fff" />
                <circle cx="20" cy="6" r="1.7" fill="#fff" />
              </svg>
            </span>
            <span className="brand-word">Trace<span className="brand-x">X</span></span>
            <span className="sub">· AI Action Trace</span>
          </div>
          <PageCrumb />
          <div className="topbar-right">
            <AgentNavChip />
            <UserMenu />
          </div>
        </header>
        <div className="app-body">
          <Sidebar folded={folded} onToggleFold={toggleFold} version={version} />
          <main className="app-main">
            {/* 계정이 설정에 없는 에이전트에 묶여 있을 때만 뜬다 (빈 화면 + 403 의 이유를 밝힌다) */}
            <AgentScopeWarning />
            {children}
          </main>
        </div>
      </div>
     </TimeRangeProvider>
    </AgentScopeProvider>
  );
}
