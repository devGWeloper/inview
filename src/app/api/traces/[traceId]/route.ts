import { NextRequest, NextResponse } from "next/server";
import { fetchByTraceId } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { traceId: string } }
) {
  const traceId = decodeURIComponent(params.traceId);
  const rows = await fetchByTraceId(traceId);
  return NextResponse.json({ traceId, rows });
}
