"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading, setUser } = useAuth();
  // 오픈 리다이렉트 방지: 자체 경로("/xxx")만 허용, "//" 또는 외부 URL 은 홈으로.
  const rawNext = params.get("next") || "/";
  const nextPath = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 이미 로그인 상태면 목적지로 보낸다.
  useEffect(() => {
    if (!loading && user) router.replace(nextPath);
  }, [loading, user, nextPath, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!userId.trim() || !password) { setErr("사번과 비밀번호를 입력하세요."); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userId.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error ?? "로그인에 실패했습니다."); setSubmitting(false); return; }
      setUser(data.user);
      router.replace(nextPath);
    } catch {
      setErr("로그인 처리 중 오류가 발생했습니다.");
      setSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      {/* 좌: 브랜드 히어로 */}
      <aside className="login-hero" aria-hidden>
        <div className="login-hero-grid" />
        <div className="login-hero-glow" />
        <div className="login-hero-content">
          <div className="login-hero-brand">
            <span className="login-hero-logo">
              <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
                <path d="M4 17 L10 11 L14 14 L20 6" stroke="#fff" strokeWidth="2.4"
                      strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="4" cy="17" r="1.9" fill="#fff" />
                <circle cx="20" cy="6" r="1.9" fill="#fff" />
              </svg>
            </span>
            <span className="login-hero-word">Trace<span className="login-hero-x">X</span></span>
          </div>
          <h1 className="login-hero-title">eWorks Agent<br />Operations <span className="login-hero-accent">Platform</span></h1>
          <p className="login-hero-desc">
            실행을 추적하고, 토큰을 분석하고,<br />
            성과를 리포트하고, 다음을 개선합니다.<br />
            AI 에이전트 운영의 처음부터 끝까지, 한 콘솔에서.
          </p>
          <div className="login-hero-caps">
            {[
              { icon: "🔍", label: "Trace" },
              { icon: "📊", label: "Analyze" },
              { icon: "📈", label: "Report" },
              { icon: "🚀", label: "Improve" },
            ].map((c) => (
              <span key={c.label} className="login-hero-cap">
                <span className="login-hero-cap-ic" aria-hidden>{c.icon}</span>
                {c.label}
              </span>
            ))}
          </div>
        </div>
        <div className="login-hero-foot">© 2026 SK hynix · eWorks Agent</div>
      </aside>

      {/* 우: 로그인 폼 */}
      <main className="login-main">
        <div className="login-panel">
          <div className="login-badge" aria-hidden>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
              <path d="M12 3l7 3v5c0 4.2-2.9 7.6-7 8.7C7.9 18.6 5 15.2 5 11V6l7-3z"
                    stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M9.2 12.2l2 2 3.6-4" stroke="#fff" strokeWidth="1.9"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          <div className="login-card-head">
            <div className="login-card-title">환영합니다</div>
            <div className="login-card-sub">eWorks Agent 콘솔에 로그인하세요.</div>
          </div>

          <form className="login-card" onSubmit={submit}>
            <label className="login-field">
              <span>사번</span>
              <div className={"login-input" + (userId ? " filled" : "")}>
                <svg className="login-input-ic" viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
                  <rect x="3.5" y="5" width="17" height="14" rx="2.4" stroke="currentColor" strokeWidth="1.7" />
                  <circle cx="9" cy="11" r="2.2" stroke="currentColor" strokeWidth="1.7" />
                  <path d="M5.6 16.4c.7-1.6 2-2.4 3.4-2.4s2.7.8 3.4 2.4M14.5 9.5h3.5M14.5 12.5h3.5M14.5 15.5h2.2"
                        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
                <input
                  type="text"
                  value={userId}
                  onChange={(e) => { setUserId(e.target.value); setErr(null); }}
                  placeholder="사번을 입력하세요"
                  autoFocus
                  autoComplete="username"
                  inputMode="text"
                />
              </div>
            </label>

            <label className="login-field">
              <span>비밀번호</span>
              <div className={"login-input" + (password ? " filled" : "")}>
                <svg className="login-input-ic" viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
                  <rect x="4.5" y="10.5" width="15" height="9" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
                  <path d="M8 10.5V8a4 4 0 018 0v2.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  <circle cx="12" cy="15" r="1.3" fill="currentColor" />
                </svg>
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setErr(null); }}
                  placeholder="비밀번호를 입력하세요"
                  autoComplete="current-password"
                />
                <button type="button" className="login-eye" onClick={() => setShowPw((v) => !v)}
                        aria-label={showPw ? "비밀번호 숨기기" : "비밀번호 표시"} tabIndex={-1}>
                  {showPw ? (
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
                      <path d="M4 4l16 16M10 10a2.7 2.7 0 003.9 3.8M6.6 6.7C4.6 8 3.2 9.9 2.5 12c1.6 4 5.3 6.5 9.5 6.5 1.7 0 3.3-.4 4.7-1.1M9.9 5.7A10.6 10.6 0 0112 5.5c4.2 0 7.9 2.5 9.5 6.5-.5 1.3-1.3 2.5-2.3 3.5"
                            stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
                      <path d="M2.5 12C4.1 8 7.8 5.5 12 5.5S19.9 8 21.5 12c-1.6 4-5.3 6.5-9.5 6.5S4.1 16 2.5 12z"
                            stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                      <circle cx="12" cy="12" r="2.8" stroke="currentColor" strokeWidth="1.7" />
                    </svg>
                  )}
                </button>
              </div>
            </label>

            {err && <div className="login-error" role="alert">{err}</div>}

            <button type="submit" className="login-submit" disabled={submitting}>
              {submitting ? "로그인 중…" : (
                <>
                  로그인
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
                    <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2"
                          strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </>
              )}
            </button>
          </form>

          <div className="login-help">
            계정이 없거나 비밀번호를 잊으셨나요? <b>운영자에게 문의</b>하세요.
          </div>
        </div>
      </main>
    </div>
  );
}
