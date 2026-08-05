"use client";

import { usePathname } from "next/navigation";
import { TabNav, AgentNavChip } from "@/components/TabNav";
import { useAuth } from "@/components/auth/AuthProvider";
import { UserMenu } from "@/components/auth/UserMenu";

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
          {/* 레이아웃 개편 시안 뷰어 (public/design-preview.html) — 검토용 임시 진입점.
              ADMIN 전용: 여기서 감추는 건 표시 제어일 뿐이고, 실제 접근 차단은
              ROUTE_RULES 의 /design-preview.html 규칙(ADMIN)을 미들웨어가 강제한다. */}
          {user?.role === "ADMIN" && (
            <a
              className="design-peek"
              href="/design-preview.html"
              target="_blank"
              rel="noreferrer"
              title="레이아웃 개편 시안 4종 보기 (운영자 전용)"
            >
              <span aria-hidden>🎨</span>
              <span>디자인 시안</span>
            </a>
          )}
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
