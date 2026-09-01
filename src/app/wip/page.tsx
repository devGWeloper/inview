import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/current";

/**
 * 공사장 — 아직 운영에 안 내보낸 화면을 모아 두는 곳 (운영자 전용).
 *
 * 만들다 만 화면이 상단 탭이나 유저 메뉴에 하나씩 붙으면 정식 화면과 섞여
 * "이건 써도 되는 건가" 를 매번 되묻게 된다. 여기 한 자리에 모아 두고,
 * 정식으로 열 때 그 항목만 밖으로 뺀다.
 *
 * **항목 추가는 아래 SITES 배열 한 줄.** 정식 오픈 = 여기서 지우고 TabNav(또는 UserMenu)에 옮긴다.
 * ⚠️ 이 목록은 표시일 뿐 접근 제어가 아니다 — 각 항목의 실제 차단은 자기 경로의
 *    ROUTE_RULES / API 가드가 한다. 여기서 지운다고 그 화면이 잠기지 않는다.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Site {
  href: string;
  name: string;
  /** 무엇을 하는 화면인가 (한 줄) */
  what: string;
  /** 지금 어디까지 됐나 */
  state: string;
  /** 새 탭으로 열 것인가 (앱 밖 정적 파일) */
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
  // 서버에서 한 번 더 확인한다 — 미들웨어(ROUTE_RULES)와 같은 판정이지만 직접 접근도 막는다.
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
