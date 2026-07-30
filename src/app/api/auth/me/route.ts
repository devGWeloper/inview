import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 현재 로그인 사용자. 비로그인이면 { user: null } (200) — 클라이언트 셸이 조용히 처리. */
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null });

  return NextResponse.json({
    user: { userId: session.sub, name: session.name, role: session.role },
  });
}
