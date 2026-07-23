import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 현재 로그인 사용자. 비로그인이면 { user: null } (200) — 클라이언트 셸이 조용히 처리.
 * mustChangePw 는 최신 DB 값을 반영하기 위해 계정을 되읽어 채운다(실패해도 무해).
 */
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null });

  let mustChangePw = false;
  try {
    const acc = await getUser(session.sub);
    mustChangePw = acc?.mustChangePw ?? false;
  } catch { /* ignore */ }

  return NextResponse.json({
    user: { userId: session.sub, name: session.name, role: session.role, mustChangePw },
  });
}
