import { NextRequest, NextResponse } from "next/server";
import { readProfile, writeProfile } from "@/lib/profile";
import { computeFteStats } from "@/lib/fte";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";
// fs 접근이 필요하므로 Node 런타임 강제 (Edge 금지)
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ctx = reqContext(req);
  try {
    const profile = readProfile();
    const fteStats = await computeFteStats();
    return NextResponse.json({ profile, fteStats });
  } catch (e) {
    logger.error("GET /api/profile failed", { ...ctx, err: String(e) });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const ctx = reqContext(req);
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
