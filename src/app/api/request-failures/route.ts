import { NextRequest, NextResponse } from "next/server";
import { fetchRequestFailures, saveRequestFailureHandling } from "@/lib/requestFailures";
import { getAppEnv } from "@/lib/db";
import { FailureStatus, RequestFailureListResponse } from "@/lib/types";
import { ADMIN_PASSWORD, ADMIN_PASSWORD_HEADER } from "@/lib/adminAuth";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Improvement Center > Request Failure Tracker 목록.
 * 실패 요청(ACTION_TYP IS NULL AND RECV_MSG_CTN IS NOT NULL) + 조치 정보 병합.
 * DB 미가용 시에도 200 + available=false 로 화면이 안내한다.
 */
export async function GET(req: NextRequest) {
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

/** 조치 정보 저장 (upsert). /admin 과 동일한 관리자 비밀번호 헤더 게이트. */
export async function PUT(req: NextRequest) {
  const ctx = reqContext(req);
  if (req.headers.get(ADMIN_PASSWORD_HEADER) !== ADMIN_PASSWORD) {
    logger.warn("PUT /api/request-failures unauthorized", ctx);
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    const traceId = typeof body?.traceId === "string" ? body.traceId : "";
    const status = body?.status as FailureStatus;
    if (!traceId) {
      return NextResponse.json({ error: "traceId 가 필요합니다." }, { status: 400 });
    }
    const saved = await saveRequestFailureHandling({
      traceId,
      status,
      note: body?.note ?? null,
      handler: body?.handler ?? null,
    });
    logger.info("PUT /api/request-failures ok", { ...ctx, traceId, status });
    return NextResponse.json({ traceId, ...saved });
  } catch (e) {
    logger.error("PUT /api/request-failures failed", { ...ctx, err: String(e) });
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
