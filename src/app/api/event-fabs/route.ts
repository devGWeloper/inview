import { NextRequest, NextResponse } from "next/server";
import { fetchEventFabMappings, saveEventFabMappings } from "@/lib/eventFabs";
import { requireBiz } from "@/lib/auth/current";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const bizGuard = await requireBiz("BR");
  if (!bizGuard.ok) return NextResponse.json({ error: bizGuard.error }, { status: bizGuard.status });

  const t0 = Date.now();
  const ctx = reqContext(req);
  const result = await fetchEventFabMappings();
  logger.info("GET /api/event-fabs", {
    ...ctx,
    available: result.available,
    events: result.mappings.length,
    ms: Date.now() - t0,
  });
  return NextResponse.json(result);
}

export async function PUT(req: NextRequest) {
  const ctx = reqContext(req);
  const guard = await requireBiz("ADMIN");
  if (!guard.ok) {
    logger.warn("PUT /api/event-fabs unauthorized", { ...ctx, status: guard.status });
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  try {
    const body = await req.json();
    if (!Array.isArray(body?.mappings)) {
      return NextResponse.json({ error: "mappings 배열이 필요합니다." }, { status: 400 });
    }
    const mappings = await saveEventFabMappings(body.mappings);
    logger.info("PUT /api/event-fabs ok", { ...ctx, events: mappings.length });
    return NextResponse.json({ mappings });
  } catch (e) {
    logger.error("PUT /api/event-fabs failed", { ...ctx, err: String(e) });
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
