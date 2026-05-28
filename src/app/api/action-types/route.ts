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
  const cfg = loadConfig().layers["GAIA"];
  if (!cfg) {
    logger.info("GET /api/action-types skipped: GAIA not configured", ctx);
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
      `SELECT DISTINCT ACTION_TYP
         FROM BIZ_AIACTIONTXN_HIS
        WHERE ACTION_TYP IS NOT NULL
        ORDER BY ACTION_TYP`,
      {},
      { outFormat: oracle.OBJECT }
    );
    const rows = (result.rows ?? []) as Array<Record<string, unknown>>;
    const values = rows
      .map((r) => (r["ACTION_TYP"] ?? r["action_typ"]) as string | null)
      .filter((v): v is string => !!v && v.trim() !== "");
    logger.info("GET /api/action-types ok", { ...ctx, count: values.length, ms: Date.now() - t0 });
    return NextResponse.json({ values });
  } catch (e) {
    logger.error("GET /api/action-types failed", { ...ctx, err: String(e), ms: Date.now() - t0 });
    return NextResponse.json({ values: [], error: String(e) }, { status: 200 });
  } finally {
    if (conn) {
      try { await conn.close(); } catch { /* ignore */ }
    }
  }
}
