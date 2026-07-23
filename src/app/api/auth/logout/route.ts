import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, sessionCookieOptions } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  // 쿠키 만료 (maxAge 0)
  res.cookies.set(AUTH_COOKIE, "", sessionCookieOptions(0));
  return res;
}
