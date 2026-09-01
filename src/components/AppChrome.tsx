"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TabNav, AgentNavChip } from "@/components/TabNav";
import { useAuth } from "@/components/auth/AuthProvider";
import { UserMenu } from "@/components/auth/UserMenu";
import { AgentScopeProvider, AgentScopeWarning } from "@/components/agents/AgentScopeProvider";
import { AgentSelector } from "@/components/agents/AgentSelector";
import { TimeRangeProvider } from "@/components/TimeRangeProvider";
import { TickProvider } from "@/components/tick/TickProvider";

/**
 * 앱 셸 (상단바 + 푸터). /login 은 셸 없이 전체화면으로 렌더한다.
 * 인증 상태는 AuthProvider 컨텍스트로 UserMenu 등이 참조.
 */
export function AppChrome({ version, children }: { version: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const bare = pathname === "/login";

  if (bare) return <>{children}</>;

  return (
    <AgentScopeProvider>
     <TimeRangeProvider>
     <TickProvider>
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
            {/* 공사장(/wip) — 아직 안 연 화면(로드맵 · 디자인 시안 …)의 유일한 진입점.
                만들다 만 화면을 상단바에 하나씩 붙이면 정식 화면과 섞이므로 한 자리에 모은다.
                ADMIN 전용: 여기서 감추는 건 표시 제어일 뿐이고, 실제 차단은
                ROUTE_RULES 의 /wip 규칙(ADMIN)을 미들웨어가 강제한다. */}
            {user?.role === "ADMIN" && (
              <Link
                className="wip-entry"
                href="/wip"
                prefetch={false}
                title="아직 열지 않은 화면 모음 (운영자 전용)"
              >
                <span aria-hidden>🚧</span>
                <span>공사장</span>
              </Link>
            )}
            <AgentSelector />
            <AgentNavChip />
            <UserMenu />
          </div>
        </header>
        {/* 계정이 설정에 없는 에이전트에 묶여 있을 때만 뜬다 (빈 화면 + 403 의 이유를 밝힌다) */}
        <AgentScopeWarning />
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
     </TickProvider>
     </TimeRangeProvider>
    </AgentScopeProvider>
  );
}
