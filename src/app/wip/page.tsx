import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/current";
import { WIP_SITES } from "@/components/shell/nav";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
        {WIP_SITES.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="wip-card"
              prefetch={false}
              target={s.external ? "_blank" : undefined}
              rel={s.external ? "noreferrer" : undefined}
            >
              <span className="wip-card-top">
                <span className="wip-card-name">{s.label}</span>
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
