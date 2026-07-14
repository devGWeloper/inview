"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ADMIN_PASSWORD } from "@/lib/adminAuth";

// /admin 과 /report 가 공유하는 관리자 비밀번호 게이트.
// 세션 동안 잠금 해제 상태를 sessionStorage 로 유지하며, 키를 공유하므로
// 한 화면에서 해제하면 다른 화면도 함께 열린다.
// ⚠️ adminAuth.ts 와 동일한 단순 게이트 — 실제 보안 아님.
const UNLOCK_KEY = "admin-unlocked";

export function AdminGate({
  title,
  sub,
  icon = "🔒",
  backHref = "/agent",
  children,
}: {
  title: string;
  sub: string;
  /** 잠금 화면 아이콘 (이모지) */
  icon?: string;
  /** 취소 버튼 이동 경로 */
  backHref?: string;
  children: React.ReactNode;
}) {
  const [unlocked, setUnlocked] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem(UNLOCK_KEY) === "1") {
      setUnlocked(true);
    }
  }, []);

  function onUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (pwInput === ADMIN_PASSWORD) {
      setUnlocked(true);
      setPwError(false);
      sessionStorage.setItem(UNLOCK_KEY, "1");
    } else {
      setPwError(true);
    }
  }

  // 게이트 통과 후에만 children 을 마운트한다 (데이터 fetch 도 그때 시작).
  if (unlocked) return <>{children}</>;

  return (
    <div className="admin-page">
      <form className="admin-lock" onSubmit={onUnlock}>
        <div className="admin-lock-icon" aria-hidden>{icon}</div>
        <div className="admin-lock-title">{title}</div>
        <div className="admin-lock-sub">{sub}</div>
        <input
          type="password"
          className={"admin-lock-input" + (pwError ? " error" : "")}
          value={pwInput}
          onChange={(e) => { setPwInput(e.target.value); setPwError(false); }}
          placeholder="비밀번호"
          autoFocus
          aria-label="관리자 비밀번호"
        />
        {pwError && <div className="admin-lock-error">비밀번호가 올바르지 않습니다.</div>}
        <div className="admin-lock-actions">
          <Link href={backHref} className="btn ghost" prefetch={false}>취소</Link>
          <button type="submit" className="btn primary">잠금 해제</button>
        </div>
      </form>
    </div>
  );
}
