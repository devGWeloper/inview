import { NextRequest, NextResponse } from "next/server";
import { fetchTokenStats } from "@/lib/tokens";
import { TokenFilter } from "@/lib/types";
import { logger, reqContext } from "@/lib/logger";
import { defaultAgentId, getAgent } from "@/lib/config";
import { requireAgent } from "@/lib/auth/current";
import { parseGranularityParam } from "@/lib/timeBuckets";

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

  const now = Date.now();
  const dateFrom = sp.get("dateFrom") || undefined;
  const dateTo = sp.get("dateTo") || undefined;

  const rawAgent = sp.get("agent")?.trim() || undefined;
  if (rawAgent && !getAgent(rawAgent)) {
    logger.warn("GET /api/tokens unknown agent", { ...ctx, agent: rawAgent });
    return NextResponse.json({ error: `알 수 없는 에이전트: ${rawAgent}` }, { status: 400 });
  }
  const agentId = rawAgent ?? defaultAgentId();

  const guard = await requireAgent(agentId);
  if (!guard.ok) {
    logger.warn("GET /api/tokens agent scope denied", { ...ctx, want: agentId, status: guard.status });
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const filter: TokenFilter = {
    dateFrom: dateFrom ?? isoNoTz(now - 24 * 3_600_000),
    dateTo: dateTo ?? isoNoTz(now),
    userId: sp.get("userId") || undefined,
    nodeNm: sp.get("nodeNm") || undefined,
    modelNm: sp.get("modelNm") || undefined,
    traceId: sp.get("traceId") || undefined,
    agentId,
    gran: parseGranularityParam(sp.get("g")),
  };

  logger.info("GET /api/tokens", { ...ctx, filter });

  try {
    const stats = await fetchTokenStats(filter);
    logger.info("GET /api/tokens done", {
      ...ctx,
      calls: stats.totals.calls,
      ms: Date.now() - t0,
      status: 200,
    });
    return NextResponse.json({ ...stats, agentId });
  } catch (e) {
    logger.error("GET /api/tokens failed", { ...ctx, err: String(e), ms: Date.now() - t0 });
    throw e;
  }
}
