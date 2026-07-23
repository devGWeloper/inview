"use client";

import { usePathname } from "next/navigation";
import { TabNav, AgentNavChip } from "@/components/TabNav";
import { UserMenu } from "@/components/auth/UserMenu";

/**
 * 앱 셸 (상단바 + 푸터). /login 은 셸 없이 전체화면으로 렌더한다.
 * 인증 상태는 AuthProvider 컨텍스트로 UserMenu 등이 참조.
 */
export function AppChrome({ version, children }: { version: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = pathname === "/login";

  if (bare) return <>{children}</>;

  return (
    <div className="app">
      <header className="topbar">
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
        <TabNav />
        <div className="topbar-right">
          <AgentNavChip />
          <UserMenu />
        </div>
      </header>
      {children}
      <footer className="statusbar">
        <div className="left">
          <span>© 2026 SK hynix</span>
          <span className="sep" aria-hidden />
          <span>eWorks Agent</span>
        </div>
        <div className="right">
          <span>TraceX</span>
          <span className="ver">v{version}</span>
        </div>
      </footer>
    </div>
  );
}
