import { NextRequest, NextResponse } from "next/server";
import { readHolidays, writeHolidays } from "@/lib/holidayStore";
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
    return NextResponse.json({ holidays: readHolidays() });
  } catch (e) {
    logger.error("GET /api/holidays failed", { ...ctx, err: String(e) });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const ctx = reqContext(req);
  const guard = await requireGlobalAdmin();
  if (!guard.ok) {
    logger.warn("PUT /api/holidays unauthorized", { ...ctx, status: guard.status });
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  try {
    const holidays = writeHolidays(await req.json());
    logger.info("PUT /api/holidays ok", { ...ctx, by: guard.session.sub, count: holidays.days.length });
    return NextResponse.json({ holidays });
  } catch (e) {
    logger.error("PUT /api/holidays failed", { ...ctx, err: String(e) });
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
