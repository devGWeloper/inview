import { NextRequest, NextResponse } from "next/server";
import { fetchEventFabMappings, saveEventFabMappings } from "@/lib/eventFabs";
import { ADMIN_PASSWORD, ADMIN_PASSWORD_HEADER } from "@/lib/adminAuth";
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

/** 매핑 전체 저장 (전량 교체). /admin 과 동일한 관리자 비밀번호 헤더 게이트. */
export async function PUT(req: NextRequest) {
  const ctx = reqContext(req);
  // 하드코딩 비밀번호 게이트 (단순 보호용 — adminAuth.ts 참고)
  if (req.headers.get(ADMIN_PASSWORD_HEADER) !== ADMIN_PASSWORD) {
    logger.warn("PUT /api/event-fabs unauthorized", ctx);
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
