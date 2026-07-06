import { NextRequest, NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";

let oracledbCached: typeof import("oracledb") | null = null;
async function getOracle(): Promise<typeof import("oracledb") | null> {
  if (oracledbCached) return oracledbCached;
  try {
    const mod = await import("oracledb");
    oracledbCached = mod;
    return mod;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const ctx = reqContext(req);
  // FAC_ID 는 MCP send update 에서만 기록되므로 MCP DB 에서 조회
  const cfg = loadConfig().layers["MCP"];
  if (!cfg) {
    logger.info("GET /api/facs skipped: MCP not configured", ctx);
    return NextResponse.json({ values: [] });
  }
  const oracle = await getOracle();
  if (!oracle) {
    return NextResponse.json({ values: [] });
  }

  let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
  try {
    conn = await oracle.getConnection(cfg);
    const result = await conn.execute(
      `SELECT DISTINCT FAC_ID
         FROM BIZ_AIACTIONTXN_HIS
        WHERE FAC_ID IS NOT NULL
        ORDER BY FAC_ID`,
      {},
      { outFormat: oracle.OBJECT }
    );
    const rows = (result.rows ?? []) as Array<Record<string, unknown>>;
    const values = rows
      .map((r) => (r["FAC_ID"] ?? r["fac_id"]) as string | null)
      .filter((v): v is string => !!v && v.trim() !== "");
    logger.info("GET /api/facs ok", { ...ctx, count: values.length, ms: Date.now() - t0 });
    return NextResponse.json({ values });
  } catch (e) {
    logger.error("GET /api/facs failed", { ...ctx, err: String(e), ms: Date.now() - t0 });
    return NextResponse.json({ values: [], error: String(e) }, { status: 200 });
  } finally {
    if (conn) {
      try { await conn.close(); } catch { /* ignore */ }
    }
  }
}
