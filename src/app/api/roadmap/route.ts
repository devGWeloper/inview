import { NextRequest, NextResponse } from "next/server";
import { readRoadmap, writeRoadmap } from "@/lib/roadmap";
import { requireGlobalAdmin, requireRole } from "@/lib/auth/current";
import { LOWEST_ROLE } from "@/lib/roles";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";
// fs 접근이 필요하므로 Node 런타임 강제 (Edge 금지)
export const runtime = "nodejs";

/**
 * 로드맵 조회 — **로그인만 되면 누구나**(일반 사용자 포함).
 *
 * ⚠️ requireBiz/requireAgent 를 쓰지 않는다. 이 데이터는 BIZ_AIACTIONTXN_HIS 도
 *    TRX_TOKEN_DET 도 아닌 파일이라 에이전트 범위와 무관하다 — 범위 가드를 붙이면
 *    다른 팀 에이전트 소속 계정이 공용 계획표를 못 보게 되는데, 막을 이유가 없다.
 */
export async function GET(req: NextRequest) {
  const ctx = reqContext(req);
  const guard = await requireRole(LOWEST_ROLE);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    return NextResponse.json({ roadmap: readRoadmap() });
  } catch (e) {
    logger.error("GET /api/roadmap failed", { ...ctx, err: String(e) });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * 로드맵 저장 — **전역 ADMIN 전용**. 전량 교체(앱이 이 파일의 마스터).
 *
 * ⚠️ requireAgentAdmin 이 아니라 requireGlobalAdmin 이다 — 로드맵은 앱 전체에 1벌이라
 *    에이전트 하나에 매인 운영자가 고칠 대상이 아니다.
 */
export async function PUT(req: NextRequest) {
  const ctx = reqContext(req);
  const guard = await requireGlobalAdmin();
  if (!guard.ok) {
    logger.warn("PUT /api/roadmap unauthorized", { ...ctx, status: guard.status });
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  try {
    const body = await req.json();
    const roadmap = writeRoadmap(body);
    logger.info("PUT /api/roadmap ok", { ...ctx, by: guard.session.sub, count: roadmap.milestones.length });
    return NextResponse.json({ roadmap });
  } catch (e) {
    logger.error("PUT /api/roadmap failed", { ...ctx, err: String(e) });
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
