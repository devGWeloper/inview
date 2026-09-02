import { NextRequest, NextResponse } from "next/server";
import { readRoadmap, writeRoadmap } from "@/lib/roadmap";
import { requireGlobalAdmin, requireRole } from "@/lib/auth/current";
import { LOWEST_ROLE } from "@/lib/roles";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ctx = reqContext(req);
  const guard = await requireRole(LOWEST_ROLE);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    return NextResponse.json({ roadmap: readRoadmap() });
  } catch (e) {
    logger.error("GET /api/roadmap failed", { ...ctx, err: String(e) });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const ctx = reqContext(req);
  const guard = await requireGlobalAdmin();
  if (!guard.ok) {
    logger.warn("PUT /api/roadmap unauthorized", { ...ctx, status: guard.status });
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  try {
    const body = await req.json();
    const roadmap = writeRoadmap(body);
    logger.info("PUT /api/roadmap ok", { ...ctx, by: guard.session.sub, count: roadmap.milestones.length });
    return NextResponse.json({ roadmap });
  } catch (e) {
    logger.error("PUT /api/roadmap failed", { ...ctx, err: String(e) });
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
