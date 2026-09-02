import { NextRequest, NextResponse } from "next/server";
import { fetchBizTickStats } from "@/lib/bizTickStats";
import { BizTickFilter } from "@/lib/types";
import { logger, reqContext } from "@/lib/logger";
import { requireBiz } from "@/lib/auth/current";

export const dynamic = "force-dynamic";


function isoNoTz(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const ctx = reqContext(req);

  const guard = await requireBiz();
  if (!guard.ok) {
    logger.warn("GET /api/stats/tick denied", { ...ctx, status: guard.status });
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const sp = req.nextUrl.searchParams;
  const now = Date.now();
  const filter: BizTickFilter = {
    dateFrom: sp.get("dateFrom") || isoNoTz(now - 60 * 60_000),
    dateTo: sp.get("dateTo") || isoNoTz(now),
    userId: sp.get("userId") || undefined,
  };

  logger.info("GET /api/stats/tick", { ...ctx, filter });

  try {
    const stats = await fetchBizTickStats(filter);
    logger.info("GET /api/stats/tick done", {
      ...ctx,
      minutes: stats.minutes.length,
      peakA: stats.peakA.value,
      peakB: stats.peakB.value,
      ms: Date.now() - t0,
      status: 200,
    });
    return NextResponse.json(stats);
  } catch (e) {
    logger.error("GET /api/stats/tick failed", { ...ctx, err: String(e), ms: Date.now() - t0 });
    throw e;
  }
}
