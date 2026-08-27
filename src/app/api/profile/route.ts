import { NextRequest, NextResponse } from "next/server";
import { readProfile, writeProfile } from "@/lib/profile";
import { computeFteStats } from "@/lib/fte";
import { requireAgent, requireAgentAdmin } from "@/lib/auth/current";
import { defaultAgentId, getAgent } from "@/lib/config";
import { LOWEST_ROLE } from "@/lib/roles";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";
// fs 접근이 필요하므로 Node 런타임 강제 (Edge 금지)
export const runtime = "nodejs";

/**
 * 대상 에이전트를 정한다. `?agent=` 없으면 기본 에이전트.
 * ⚠️ 알 수 없는 id 는 400 — 조용히 기본으로 폴백하면 남의 프로필을 자기 것으로 편집하게 된다.
 *    (조회 3라우트와 같은 규칙)
 */
function pickAgent(req: NextRequest): { ok: true; id: string } | { ok: false; error: string } {
  const raw = req.nextUrl.searchParams.get("agent")?.trim();
  if (!raw) return { ok: true, id: defaultAgentId() };
  if (!getAgent(raw)) return { ok: false, error: `알 수 없는 에이전트: ${raw}` };
  return { ok: true, id: raw };
}

export async function GET(req: NextRequest) {
  const ctx = reqContext(req);
  const picked = pickAgent(req);
  if (!picked.ok) return NextResponse.json({ error: picked.error }, { status: 400 });

  // 조회는 현업(FIELD)까지 연다 — /agent 소개 카드의 데이터다. 편집(PUT)은 아래 ADMIN 그대로.
  const guard = await requireAgent(picked.id, LOWEST_ROLE);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const profile = readProfile(picked.id);
    // ⚠️ FTE 는 BIZ_AIACTIONTXN_HIS 집계라 **기본 에이전트만** 의미가 있다.
    //    다른 에이전트에 대고 계산하면 남의 실적을 자기 것으로 보여주게 된다.
    const isDefault = picked.id === defaultAgentId();
    const fteStats = isDefault ? await computeFteStats(profile) : null;
    return NextResponse.json({ profile, fteStats, agentId: picked.id, isDefault });
  } catch (e) {
    logger.error("GET /api/profile failed", { ...ctx, err: String(e) });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const ctx = reqContext(req);
  const picked = pickAgent(req);
  if (!picked.ok) return NextResponse.json({ error: picked.error }, { status: 400 });

  // 편집은 그 에이전트의 ADMIN 이어야 한다 (전역 ADMIN 또는 해당 에이전트 ADMIN).
  const guard = await requireAgentAdmin(picked.id);
  if (!guard.ok) {
    logger.warn("PUT /api/profile unauthorized", { ...ctx, agentId: picked.id, status: guard.status });
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  try {
    const body = await req.json();
    const profile = writeProfile(body, picked.id);
    logger.info("PUT /api/profile ok", { ...ctx, agentId: picked.id, by: guard.session.sub });
    return NextResponse.json({ profile, agentId: picked.id });
  } catch (e) {
    logger.error("PUT /api/profile failed", { ...ctx, err: String(e) });
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
