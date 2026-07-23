"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { ROLE_LABEL } from "@/lib/roles";

export default function ForbiddenPage() {
  const { user } = useAuth();
  return (
    <div className="forbidden-page">
      <div className="forbidden-card">
        <div className="forbidden-icon" aria-hidden>🔒</div>
        <div className="forbidden-title">접근 권한이 없습니다</div>
        <div className="forbidden-sub">
          이 화면은 더 높은 권한이 필요합니다.
          {user && <> 현재 권한: <b>{ROLE_LABEL[user.role]}</b></>}
          <br />필요 시 운영자에게 권한 상향을 요청하세요.
        </div>
        <Link href="/" className="btn primary" prefetch={false}>대시보드로 돌아가기</Link>
      </div>
    </div>
  );
}
