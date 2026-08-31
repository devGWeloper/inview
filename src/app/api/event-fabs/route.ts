import { NextRequest, NextResponse } from "next/server";
import { fetchEventFabMappings, saveEventFabMappings } from "@/lib/eventFabs";
import { requireBiz } from "@/lib/auth/current";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** 이벤트-FAB 매핑 전체 조회. DB 미가용 시에도 200 + available=false 로 화면이 안내한다. */
export async function GET(req: NextRequest) {
  // ⚠️ BIZ_AIACTIONTXN_HIS 는 기본 에이전트 전용이다. 다른 팀 에이전트 소속 계정은
  //    URL 을 직접 쳐도 여기서 끊는다 (미들웨어 리다이렉트는 UX, 권위는 이 판정).
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

/**
 * 매핑 전체 저장 (전량 교체). **ADMIN 전용**.
 * ⚠️ 조회(GET)는 BR 이고 저장만 ADMIN 이다 — BR 은 전 화면 열람이되 데이터는 수정하지 못한다.
 *    화면의 저장 버튼 비활성(event-fabs/page.tsx 의 canEdit)은 UX 일 뿐, 권위는 이 판정이다.
 */
export async function PUT(req: NextRequest) {
  const ctx = reqContext(req);
  // ADMIN + 기본 에이전트 범위 (BIZ 기반 화면이라 다른 팀 에이전트는 애초에 대상이 아니다).
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
