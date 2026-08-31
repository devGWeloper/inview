import { NextRequest, NextResponse } from "next/server";
import { fetchRequestFailureContext } from "@/lib/requestFailures";
import { RequestFailureContextResponse } from "@/lib/types";
import { logger, reqContext } from "@/lib/logger";
import { requireBiz } from "@/lib/auth/current";

export const dynamic = "force-dynamic";

/**
 * 특정 실패 요청 주변의 "사용자 요청 흐름" — 같은 USER_ID 가 앞뒤로 낸 요청들.
 * 관리자가 "무엇을 시도하다 어디서 튕겼나" 흐름을 읽게 한다.
 */
export async function GET(req: NextRequest, { params }: { params: { traceId: string } }) {
  const t0 = Date.now();
  const ctx = reqContext(req);
  // params 는 Next 가 이미 URL 디코딩해 준다 — 여기서 또 decodeURIComponent 하면
  // '%' 가 든 TRACE_ID 에서 URIError 로 500 이 난다.
  const traceId = params.traceId;
  const sp = req.nextUrl.searchParams;

  // ⚠️ BIZ_AIACTIONTXN_HIS 는 기본 에이전트 전용 — 다른 팀 에이전트 소속 계정은 여기서 끊는다.
  const bizGuard = await requireBiz(); // 조회는 DEV 부터 (목록과 동일)
  if (!bizGuard.ok) return NextResponse.json({ error: bizGuard.error }, { status: bizGuard.status });


  try {
    const result = await fetchRequestFailureContext(traceId, {
      windowHours: sp.get("windowHours") ? Number(sp.get("windowHours")) : undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
    });

    const body: RequestFailureContextResponse = {
      traceId,
      userId: result.userId,
      items: result.items,
      available: result.available,
      reason: result.reason ?? null,
    };

    logger.info("GET /api/request-failures/[traceId]/context", {
      ...ctx,
      traceId,
      userId: result.userId,
      items: result.items.length,
      available: result.available,
      reason: result.reason ?? null,
      ms: Date.now() - t0,
    });
    return NextResponse.json(body);
  } catch (e) {
    // 조회 계층이 예외를 삼키므로 여기까지 오는 건 예상 밖 오류 — 사유를 담아 내린다.
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("GET /api/request-failures/[traceId]/context failed", { ...ctx, traceId, err: msg, ms: Date.now() - t0 });
    return NextResponse.json({ error: `사용자 흐름 조회 실패: ${msg}` }, { status: 500 });
  }
}
