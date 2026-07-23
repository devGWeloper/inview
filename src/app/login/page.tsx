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
        <form className="login-card" onSubmit={submit}>
          <div className="login-card-head">
            <div className="login-card-title">로그인</div>
            <div className="login-card-sub">사번과 비밀번호를 입력하세요.</div>
          </div>

          <label className="login-field">
            <span>사번</span>
            <input
              type="text"
              value={userId}
              onChange={(e) => { setUserId(e.target.value); setErr(null); }}
              placeholder="예: 12345678"
              autoFocus
              autoComplete="username"
              inputMode="text"
            />
          </label>

          <label className="login-field">
            <span>비밀번호</span>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setErr(null); }}
              placeholder="비밀번호"
              autoComplete="current-password"
            />
          </label>

          {err && <div className="login-error" role="alert">{err}</div>}

          <button type="submit" className="login-submit" disabled={submitting}>
            {submitting ? "로그인 중…" : "로그인"}
          </button>

          <div className="login-help">
            계정이 없거나 비밀번호를 잊으셨나요? <b>운영자에게 문의</b>하세요.
          </div>
        </form>
      </main>
    </div>
  );
}
