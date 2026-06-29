"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Traces" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/tokens", label: "Tokens" },
  { href: "/agent", label: "Agent" },
] as const;

export function TabNav() {
  const path = usePathname();
  return (
    <nav className="tabnav" aria-label="primary">
      {TABS.map((t) => {
        const active = t.href === "/" ? path === "/" : path?.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={"tab" + (active ? " active" : "")}
            prefetch={false}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
