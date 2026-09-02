import { NextRequest, NextResponse } from "next/server";
import { readProfile, writeProfile } from "@/lib/profile";
import { computeFteStats } from "@/lib/fte";
import { requireAgent, requireAgentAdmin } from "@/lib/auth/current";
import { defaultAgentId, getAgent } from "@/lib/config";
import { LOWEST_ROLE } from "@/lib/roles";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  const guard = await requireAgent(picked.id, LOWEST_ROLE);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const profile = readProfile(picked.id);
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
