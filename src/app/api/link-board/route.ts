import { NextRequest, NextResponse } from "next/server";
import { readLinkBoard, writeLinkBoard } from "@/lib/linkBoard";
import { requireGlobalAdmin, requireRole } from "@/lib/auth/current";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ctx = reqContext(req);
  const guard = await requireRole("DEV");
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    return NextResponse.json({ board: readLinkBoard() });
  } catch (e) {
    logger.error("GET /api/link-board failed", { ...ctx, err: String(e) });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const ctx = reqContext(req);
  const guard = await requireGlobalAdmin();
  if (!guard.ok) {
    logger.warn("PUT /api/link-board unauthorized", { ...ctx, status: guard.status });
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  try {
    const body = await req.json();
    if (!Array.isArray(body?.links)) {
      return NextResponse.json({ error: "links 배열이 필요합니다." }, { status: 400 });
    }
    const board = writeLinkBoard(body);
    logger.info("PUT /api/link-board ok", { ...ctx, by: guard.session.sub, count: board.links.length });
    return NextResponse.json({ board });
  } catch (e) {
    logger.error("PUT /api/link-board failed", { ...ctx, err: String(e) });
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
