import { NextRequest, NextResponse } from "next/server";
import { logger, reqContext } from "@/lib/logger";
import { requireBiz } from "@/lib/auth/current";
import { computeStats } from "@/lib/stats";
import { readProfile } from "@/lib/profile";
import { computeFteStats } from "@/lib/fte";
import { fetchTokenStats } from "@/lib/tokens";
import { fetchTimeoutStats } from "@/lib/timeouts";
import { defaultAgentId } from "@/lib/config";
import { LOWEST_ROLE, canViewInsights } from "@/lib/roles";
import { loadErrorCodeMap } from "@/lib/errorCodes";
// TEMP(ONEOIS 미연결): 가상 실패 코드의 사람이 읽는 라벨 — tempStatus.ts 를 지울 때 함께 정리.
import { ACTION_FAIL_LABELS } from "@/lib/tempStatus";
import {
  InsightsError,
  InsightsResponse,
  InsightsTimeouts,
  InsightsTokens,
  StatsResponse,
  TimeoutStatsResponse,
  TokenStatsResponse,
  TopItem,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const guard = await requireBiz(LOWEST_ROLE);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  if (!canViewInsights(guard.session.role)) {
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  }

  const t0 = Date.now();
  const ctx = reqContext(req);
  const sp = req.nextUrl.searchParams;

  const query = {
    dateFrom: sp.get("dateFrom") || undefined,
    dateTo: sp.get("dateTo") || undefined,
  };

  logger.info("GET /api/insights", { ...ctx, ...query, by: guard.session.sub });

  try {
    const agentId = defaultAgentId();
    const profile = readProfile(agentId);
    const [{ stats }, fte, tok, tmo, errMap] = await Promise.all([
      computeStats(query),
      computeFteStats(profile).catch(() => null),
      fetchTokenStats({ ...query, agentId, skipQuestions: true }).catch(() => null),
      fetchTimeoutStats({ ...query, agentId }).catch(() => null),
      loadErrorCodeMap().catch(() => ({})),
    ]);

    const body: InsightsResponse = toInsights(stats, profile, fte, tok, tmo, errMap);
    logger.info("GET /api/insights done", {
      ...ctx, traces: body.totals.total, ms: Date.now() - t0, status: 200,
    });
    return NextResponse.json(body);
  } catch (e) {
    logger.error("GET /api/insights failed", { ...ctx, status: 500, ms: Date.now() - t0, err: String(e) });
    return NextResponse.json({ error: "실적을 불러오지 못했습니다." }, { status: 500 });
  }
}

function toInsights(
  stats: StatsResponse,
  profile: ReturnType<typeof readProfile>,
  fte: Awaited<ReturnType<typeof computeFteStats>>,
  tok: TokenStatsResponse | null,
  tmo: TimeoutStatsResponse | null,
  errMap: Record<string, string>
): InsightsResponse {
  const { total, ok, fail, pending } = stats.totals;
  return {
    range: stats.range,
    totals: { total, ok, fail, pending },
    successRate: total > 0 ? ok / total : null,
    avgResponseMs: stats.cubeAvgLatencyMs ?? null,
    uniqueUsers: stats.uniqueUsers ?? 0,
    granularity: stats.granularity,
    buckets: stats.buckets.map((b) => ({
      ts: b.ts,
      ok: b.ok,
      fail: b.fail,
      pending: b.pending,
      avgCubeLatencyMs: b.avgCubeLatencyMs ?? null,
    })),
    daily: (stats.daily ?? []).map((d) => ({
      date: d.date,
      total: d.total,
      ok: d.ok,
      fail: d.fail,
      pending: d.pending,
      users: d.users, // 수만 (신원 아님)
      avgCubeLatencyMs: d.avgCubeLatencyMs,
      byAction: d.byAction,
    })),
    byAction: stats.byAction.map((a) => ({ key: a.key, total: a.total, ok: a.ok, fail: a.fail, pending: a.pending })),
    byFac: stats.byFac.map((a) => ({ key: a.key, total: a.total, ok: a.ok, fail: a.fail, pending: a.pending })),
    topErrors: toInsightsErrors(stats.topErrors, errMap),
    agent: {
      name: profile.name,
      nickname: profile.nickname,
      tagline: profile.tagline,
      avatar: profile.avatar,
      avatarImage: profile.avatarImage,
    },
    fte,
    tokens: tok ? toInsightsTokens(tok) : null,
    timeouts: tmo ? toInsightsTimeouts(tmo) : null,
  };
}

/**
 * 에러 코드에 사람이 읽는 사유를 붙인다 (TRX_ERRMSG_COD + TEMP 가상 코드 라벨).
 * 설명이 없으면 label = code, described=false — 화면이 코드를 두 번 그리지 않게.
 */
function toInsightsErrors(items: TopItem[], errMap: Record<string, string>): InsightsError[] {
  return items.map((it) => {
    const desc = (errMap[it.key] ?? ACTION_FAIL_LABELS[it.key] ?? "").trim();
    return {
      code: it.key,
      label: desc || it.key,
      count: it.count,
      described: !!desc,
    };
  });
}

function toInsightsTokens(t: TokenStatsResponse): InsightsTokens {
  return {
    granularity: t.granularity,
    buckets: t.buckets.map((b) => ({
      ts: b.ts,
      inputTokens: b.inputTokens,
      outputTokens: b.outputTokens,
      totalTokens: b.totalTokens,
      calls: b.calls,
      avgLatencyMs: b.avgLatencyMs,
    })),
    totals: {
      calls: t.totals.calls,
      inputTokens: t.totals.inputTokens,
      outputTokens: t.totals.outputTokens,
      totalTokens: t.totals.totalTokens,
    },
    avgTotalPerCall: t.avgTotalPerCall,
    avgLatencyMs: t.avgLatencyMs,
    byModel: t.byModel.map((m) => ({
      key: m.key,
      calls: m.calls,
      totalTokens: m.totalTokens,
      avgLatencyMs: m.avgLatencyMs,
    })),
  };
}

function toInsightsTimeouts(t: TimeoutStatsResponse): InsightsTimeouts {
  return {
    available: t.available,
    granularity: t.granularity,
    buckets: t.buckets.map((b) => ({ ts: b.ts, failed: b.failed, timeout: b.timeout })),
    totalCalls: t.totalCalls,
    failedCalls: t.failedCalls,
    timeoutCalls: t.timeoutCalls,
    affectedTraces: t.affectedTraces,
    byModel: t.byModel.map((m) => ({
      key: m.key,
      failed: m.failed,
      timeout: m.timeout,
      calls: m.calls,
    })),
  };
}
