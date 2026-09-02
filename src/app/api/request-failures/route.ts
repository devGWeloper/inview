import { NextRequest, NextResponse } from "next/server";
import { fetchRequestFailures, saveRequestFailureHandling } from "@/lib/requestFailures";
import { getAppEnv } from "@/lib/db";
import { FailureStatus, RequestFailureListResponse } from "@/lib/types";
import { requireBiz } from "@/lib/auth/current";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
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

export async function PUT(req: NextRequest) {
  const ctx = reqContext(req);
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
