import { NextRequest, NextResponse } from "next/server";
import { logger, reqContext } from "@/lib/logger";
import { requireBiz } from "@/lib/auth/current";
import { computeStats } from "@/lib/stats";
import { readProfile } from "@/lib/profile";
import { computeFteStats } from "@/lib/fte";
import { fetchTokenStats } from "@/lib/tokens";
import { fetchTimeoutStats } from "@/lib/timeouts";
import { defaultAgentId } from "@/lib/config";
import { LOWEST_ROLE } from "@/lib/roles";
import {
  InsightsResponse,
  InsightsTimeouts,
  InsightsTokens,
  StatsResponse,
  TimeoutStatsResponse,
  TokenStatsResponse,
} from "@/lib/types";

export const dynamic = "force-dynamic";
// 프로필 파일(fs) 을 읽으므로 Node 런타임 강제
export const runtime = "nodejs";

/**
 * 현업(FIELD) 실적 API — /insights 화면의 유일한 데이터 소스.
 *
 * ⚠️ 이 라우트의 존재 이유는 **필드 화이트리스트**다. /api/stats 를 현업에게 열면
 *    topUsers(사번) · topErrors(내부 에러 코드) · layers(내부 구조) 가 그대로 나간다.
 *    집계는 computeStats() 로 공유하되, 응답은 아래 toInsights() 가 필요한 필드만 **새로 담아**
 *    만든다. StatsResponse 에 필드가 늘어도 여기로는 새지 않는다.
 *
 * 권한: 인증된 사용자 누구나(min = LOWEST_ROLE). 운영자/개발자도 같은 화면을 볼 수 있어야
 * "현업이 무엇을 보는지" 를 확인할 수 있다. 단 기본 에이전트 소속이어야 한다(requireBiz).
 */
export async function GET(req: NextRequest) {
  const guard = await requireBiz(LOWEST_ROLE);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const t0 = Date.now();
  const ctx = reqContext(req);
  const sp = req.nextUrl.searchParams;

  // ⚠️ 현업 화면에는 userId/actionTyp/excludeErrCds 필터를 열지 않는다 —
  //    "특정 사용자만 골라보기" 는 이 화면이 하지 않기로 한 일이다. 기간만 받는다.
  const query = {
    dateFrom: sp.get("dateFrom") || undefined,
    dateTo: sp.get("dateTo") || undefined,
  };

  logger.info("GET /api/insights", { ...ctx, ...query, by: guard.session.sub });

  try {
    const agentId = defaultAgentId();
    const profile = readProfile(agentId);
    // 토큰/타임아웃은 TRX_TOKEN_DET(기본 에이전트 DB) — BIZ 집계와는 다른 소스라 따로 읽는다.
    // 넷 다 서로를 기다릴 이유가 없고, 뒤 셋은 실패해도 그 섹션만 비운다(화면은 그대로 그려진다).
    const [{ stats }, fte, tok, tmo] = await Promise.all([
      computeStats(query),
      // FTE 는 실적의 헤드라인 지표다. CUBE 미연결이면 null → 화면이 '—' 로 그린다.
      computeFteStats(profile).catch(() => null),
      // ⚠️ skipQuestions — questions/topUsers 는 사번·질의 원문을 싣는다. 현업 화면은 안 쓴다.
      fetchTokenStats({ ...query, agentId, skipQuestions: true }).catch(() => null),
      fetchTimeoutStats({ ...query, agentId }).catch(() => null),
    ]);

    const body: InsightsResponse = toInsights(stats, profile, fte, tok, tmo);
    logger.info("GET /api/insights done", {
      ...ctx, traces: body.totals.total, ms: Date.now() - t0, status: 200,
    });
    return NextResponse.json(body);
  } catch (e) {
    logger.error("GET /api/insights failed", { ...ctx, status: 500, ms: Date.now() - t0, err: String(e) });
    return NextResponse.json({ error: "실적을 불러오지 못했습니다." }, { status: 500 });
  }
}

/**
 * StatsResponse → InsightsResponse 투영.
 * ⚠️ spread(`...stats`) 를 쓰지 말 것 — 필드를 **하나씩 옮겨 담는** 것이 이 함수의 목적이다.
 */
function toInsights(
  stats: StatsResponse,
  profile: ReturnType<typeof readProfile>,
  fte: Awaited<ReturnType<typeof computeFteStats>>,
  tok: TokenStatsResponse | null,
  tmo: TimeoutStatsResponse | null
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
 * TokenStatsResponse → InsightsTokens.
 * ⚠️ 빠지는 것: byNode(내부 노드명) · topUsers(사번) · questions/calls(질의 원문).
 *    모델명까지만 공개한다 — 현업은 "어느 모델이 느린가" 까지만 알면 된다.
 */
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
    // sub(노드 구성)는 옮기지 않는다 — 내부 구조다.
    byModel: t.byModel.map((m) => ({
      key: m.key,
      calls: m.calls,
      totalTokens: m.totalTokens,
      avgLatencyMs: m.avgLatencyMs,
    })),
  };
}

/**
 * TimeoutStatsResponse → InsightsTimeouts.
 * ⚠️ 빠지는 것: byNode · byUser(사번) · items(실패 호출 원문) · topReasons(스택 트레이스).
 */
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
