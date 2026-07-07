import { NextRequest, NextResponse } from "next/server";
import { readProfile, writeProfile } from "@/lib/profile";
import { computeFteStats } from "@/lib/fte";
import { ADMIN_PASSWORD, ADMIN_PASSWORD_HEADER } from "@/lib/adminAuth";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";
// fs 접근이 필요하므로 Node 런타임 강제 (Edge 금지)
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ctx = reqContext(req);
  try {
    const profile = readProfile();
    const fteStats = await computeFteStats(profile);
    return NextResponse.json({ profile, fteStats });
  } catch (e) {
    logger.error("GET /api/profile failed", { ...ctx, err: String(e) });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const ctx = reqContext(req);
  // 하드코딩 비밀번호 게이트 (단순 보호용 — adminAuth.ts 참고)
  if (req.headers.get(ADMIN_PASSWORD_HEADER) !== ADMIN_PASSWORD) {
    logger.warn("PUT /api/profile unauthorized", ctx);
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    const profile = writeProfile(body);
    logger.info("PUT /api/profile ok", ctx);
    return NextResponse.json({ profile });
  } catch (e) {
    logger.error("PUT /api/profile failed", { ...ctx, err: String(e) });
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
