import { NextRequest, NextResponse } from "next/server";
import { defaultAgentId, publicAgents } from "@/lib/config";
import { AgentsResponse } from "@/lib/types";
import { getScope } from "@/lib/auth/current";
import { readProfile } from "@/lib/profile";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ctx = reqContext(req);
  const scope = await getScope();
  const all = publicAgents();
  const scoped = !scope ? [] : scope.global ? all : all.filter((a) => a.id === scope.agentId);

  const merged = scoped.map((a) => {
    const p = readProfile(a.id);
    return {
      ...a,
      name: p.name?.trim() || a.name,
      avatar: p.avatar?.trim() || a.avatar,
      tpmLimit: p.tpmLimit > 0 ? p.tpmLimit : a.tpmLimit,
      rpmLimit: p.rpmLimit > 0 ? p.rpmLimit : a.rpmLimit,
    };
  });

  const body: AgentsResponse = {
    agents: merged,
    defaultId: merged.some((a) => a.isDefault) ? defaultAgentId() : (merged[0]?.id ?? defaultAgentId()),
  };
  logger.info("GET /api/agents", {
    ...ctx, count: body.agents.length, global: scope?.global ?? null, agentId: scope?.agentId ?? null,
  });
  return NextResponse.json(body);
}
