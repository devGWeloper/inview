import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { resolveScope } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null });

  const scope = resolveScope(session);
  return NextResponse.json({
    user: {
      userId: session.sub,
      name: session.name,
      role: session.role,
      agentId: scope.agentId,
      global: scope.global,
    },
  });
}
