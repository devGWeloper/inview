import { NextRequest, NextResponse } from "next/server";
import { fetchRequestFailureContext } from "@/lib/requestFailures";
import { RequestFailureContextResponse } from "@/lib/types";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * 특정 실패 요청 주변의 "사용자 요청 흐름" — 같은 USER_ID 가 앞뒤로 낸 요청들.
 * 관리자가 "무엇을 시도하다 어디서 튕겼나" 흐름을 읽게 한다.
 */
export async function GET(req: NextRequest, { params }: { params: { traceId: string } }) {
  const t0 = Date.now();
  const ctx = reqContext(req);
  const traceId = decodeURIComponent(params.traceId);
  const sp = req.nextUrl.searchParams;

  const result = await fetchRequestFailureContext(traceId, {
    windowHours: sp.get("windowHours") ? Number(sp.get("windowHours")) : undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
  });

  const body: RequestFailureContextResponse = {
    traceId,
    userId: result.userId,
    items: result.items,
    available: result.available,
  };

  logger.info("GET /api/request-failures/[traceId]/context", {
    ...ctx,
    traceId,
    userId: result.userId,
    items: result.items.length,
    ms: Date.now() - t0,
  });
  return NextResponse.json(body);
}
