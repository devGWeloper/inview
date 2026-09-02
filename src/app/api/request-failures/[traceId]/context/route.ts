import { NextRequest, NextResponse } from "next/server";
import { fetchRequestFailureContext } from "@/lib/requestFailures";
import { RequestFailureContextResponse } from "@/lib/types";
import { logger, reqContext } from "@/lib/logger";
import { requireBiz } from "@/lib/auth/current";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { traceId: string } }) {
  const t0 = Date.now();
  const ctx = reqContext(req);
  const traceId = params.traceId;
  const sp = req.nextUrl.searchParams;

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
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("GET /api/request-failures/[traceId]/context failed", { ...ctx, traceId, err: msg, ms: Date.now() - t0 });
    return NextResponse.json({ error: `사용자 흐름 조회 실패: ${msg}` }, { status: 500 });
  }
}
