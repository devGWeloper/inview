import { NextRequest, NextResponse } from "next/server";
import { fetchRequestFailures, saveRequestFailureHandling } from "@/lib/requestFailures";
import { getAppEnv } from "@/lib/db";
import { FailureStatus, RequestFailureListResponse } from "@/lib/types";
import { requireBiz } from "@/lib/auth/current";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Improvement Center > Request Failure Tracker 목록.
 * 실패 요청(ACTION_TYP IS NULL AND RECV_MSG_CTN IS NOT NULL) + 조치 정보 병합.
 * DB 미가용 시에도 200 + available=false 로 화면이 안내한다.
 */
export async function GET(req: NextRequest) {
  // ⚠️ BIZ_AIACTIONTXN_HIS 는 기본 에이전트 전용이다. 다른 팀 에이전트 소속 계정은
  //    URL 을 직접 쳐도 여기서 끊는다 (미들웨어 리다이렉트는 UX, 권위는 이 판정).
  // 목록 조회는 DEV(개발자) 부터 — 라우팅 실패는 개발자가 파는 대상이다.
  // (저장 PUT 은 아래에서 ADMIN 을 따로 요구한다)
  const bizGuard = await requireBiz();
  if (!bizGuard.ok) return NextResponse.json({ error: bizGuard.error }, { status: bizGuard.status });

  const t0 = Date.now();
  const ctx = reqContext(req);
  const sp = req.nextUrl.searchParams;

  const result = await fetchRequestFailures({
    dateFrom: sp.get("dateFrom") || undefined,
    dateTo: sp.get("dateTo") || undefined,
    userId: sp.get("userId") || undefined,
    errCd: sp.get("errCd") || undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
  });

  const body: RequestFailureListResponse = {
    items: result.items,
    total: result.items.length,
    counts: result.counts,
    affectedUsers: result.affectedUsers,
    available: result.available,
    reason: result.reason,
    triageAvailable: result.triageAvailable,
    appEnv: getAppEnv(),
  };

  logger.info("GET /api/request-failures", {
    ...ctx,
    available: result.available,
    items: result.items.length,
    triageAvailable: result.triageAvailable,
    ms: Date.now() - t0,
  });
  return NextResponse.json(body);
}

/**
 * 조치 정보 저장 (upsert). **ADMIN 전용**.
 * ⚠️ 목록(GET)·대화 흐름(context)은 BR 이고 저장만 ADMIN 이다 — BR 은 전 화면 열람이되
 *    데이터는 수정하지 못한다. 화면의 저장 버튼 비활성은 UX 일 뿐, 권위는 이 판정이다.
 */
export async function PUT(req: NextRequest) {
  const ctx = reqContext(req);
  // ADMIN + 기본 에이전트 범위 (BIZ 기반 화면이라 다른 팀 에이전트는 애초에 대상이 아니다).
  const guard = await requireBiz("ADMIN");
  if (!guard.ok) {
    logger.warn("PUT /api/request-failures unauthorized", { ...ctx, status: guard.status });
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  try {
    const body = await req.json();
    const traceId = typeof body?.traceId === "string" ? body.traceId : "";
    const status = body?.status as FailureStatus;
    if (!traceId) {
      return NextResponse.json({ error: "traceId 가 필요합니다." }, { status: 400 });
    }
    // 담당자(handler)를 명시하지 않으면 현재 로그인 사용자로 자동 기록.
    const handler = (typeof body?.handler === "string" && body.handler.trim())
      ? body.handler
      : guard.session.sub;
    const saved = await saveRequestFailureHandling({
      traceId,
      status,
      note: body?.note ?? null,
      handler,
    });
    logger.info("PUT /api/request-failures ok", { ...ctx, traceId, status });
    return NextResponse.json({ traceId, ...saved });
  } catch (e) {
    logger.error("PUT /api/request-failures failed", { ...ctx, err: String(e) });
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
