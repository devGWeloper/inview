import { NextRequest, NextResponse } from "next/server";
import { fetchTickStats } from "@/lib/tickStats";
import { TickFilter, TickView } from "@/lib/types";
import { logger, reqContext } from "@/lib/logger";
import { defaultAgentId, getAgent } from "@/lib/config";
import { requireAgent } from "@/lib/auth/current";

export const dynamic = "force-dynamic";


function isoNoTz(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const ctx = reqContext(req);
  const sp = req.nextUrl.searchParams;

  const rawAgent = sp.get("agent")?.trim() || undefined;
  if (rawAgent && !getAgent(rawAgent)) {
    logger.warn("GET /api/tokens/tick unknown agent", { ...ctx, agent: rawAgent });
    return NextResponse.json({ error: `알 수 없는 에이전트: ${rawAgent}` }, { status: 400 });
  }
  const agentId = rawAgent ?? defaultAgentId();

  const guard = await requireAgent(agentId);
  if (!guard.ok) {
    logger.warn("GET /api/tokens/tick agent scope denied", { ...ctx, want: agentId, status: guard.status });
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const rawView = sp.get("view")?.trim();
  if (rawView && rawView !== "usage" && rawView !== "failure") {
    logger.warn("GET /api/tokens/tick unknown view", { ...ctx, view: rawView });
    return NextResponse.json({ error: `알 수 없는 view: ${rawView}` }, { status: 400 });
  }
  const view: TickView = rawView === "failure" ? "failure" : "usage";

  const now = Date.now();
  const filter: TickFilter = {
    view,
    dateFrom: sp.get("dateFrom") || isoNoTz(now - 60 * 60_000),
    dateTo: sp.get("dateTo") || isoNoTz(now),
    userId: sp.get("userId") || undefined,
    nodeNm: sp.get("nodeNm") || undefined,
    modelNm: sp.get("modelNm") || undefined,
    agentId,
  };

  logger.info("GET /api/tokens/tick", { ...ctx, filter });

  try {
    const stats = await fetchTickStats(filter);
    logger.info("GET /api/tokens/tick done", {
      ...ctx,
      minutes: stats.minutes.length,
      peakA: stats.peakA.value,
      peakB: stats.peakB.value,
      ms: Date.now() - t0,
      status: 200,
    });
    return NextResponse.json({ ...stats, agentId });
  } catch (e) {
    logger.error("GET /api/tokens/tick failed", { ...ctx, err: String(e), ms: Date.now() - t0 });
    throw e;
  }
}
