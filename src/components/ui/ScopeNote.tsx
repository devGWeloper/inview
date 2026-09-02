import Link from "next/link";
import { ReactNode } from "react";

/** 집계 범위 밖이라 이 화면 숫자에 안 잡히는 것을 한 줄로 알린다. */
export function ScopeNote({ children }: { children: ReactNode }) {
  return (
    <p className="scope-note">
      <span className="scope-note-mark">!</span>
      <span className="scope-note-text">{children}</span>
      <Link className="scope-note-link" href="/timeouts">
        타임아웃 화면 →
      </Link>
    </p>
  );
}
