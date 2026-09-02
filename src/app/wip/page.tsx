import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/current";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Site {
  href: string;
  name: string;
  what: string;
  state: string;
  external?: boolean;
}

const SITES: Site[] = [
  {
    href: "/roadmap",
    name: "Action 오픈 로드맵",
    what: "Action 이 언제 열렸고 앞으로 무엇을 열지 적어 두는 일정표",
    state: "화면 완성 · 일정 미입력",
  },
  {
    href: "/design-preview.html",
    name: "레이아웃 개편 시안",
    what: "상단바·본문 배치를 바꾼 시안 4종",
    state: "검토 대기",
    external: true,
  },
];

export default async function WipPage() {
  const guard = await requireRole("ADMIN");
  if (!guard.ok) redirect("/403");

  return (
    <div className="wip-page">
      <header className="wip-head">
        <h1 className="wip-title">공사장</h1>
        <p className="wip-sub">아직 열지 않은 화면입니다. 운영자만 보입니다.</p>
      </header>

      <ul className="wip-list">
        {SITES.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="wip-card"
              prefetch={false}
              target={s.external ? "_blank" : undefined}
              rel={s.external ? "noreferrer" : undefined}
            >
              <span className="wip-card-top">
                <span className="wip-card-name">{s.name}</span>
                <span className="wip-card-state">{s.state}</span>
              </span>
              <span className="wip-card-what">{s.what}</span>
              <span className="wip-card-href">{s.href}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
