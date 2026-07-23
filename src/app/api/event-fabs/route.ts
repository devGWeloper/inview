import { NextRequest, NextResponse } from "next/server";
import { fetchEventFabMappings, saveEventFabMappings } from "@/lib/eventFabs";
import { requireRole } from "@/lib/auth/current";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** 이벤트-FAB 매핑 전체 조회. DB 미가용 시에도 200 + available=false 로 화면이 안내한다. */
export async function GET(req: NextRequest) {
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

/** 매핑 전체 저장 (전량 교체). BR 이상 권한 필요. */
export async function PUT(req: NextRequest) {
  const ctx = reqContext(req);
  const guard = await requireRole("BR");
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
