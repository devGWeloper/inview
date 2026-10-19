import { NextRequest, NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { logger, reqContext } from "@/lib/logger";
import { requireBiz } from "@/lib/auth/current";
import { LayerKey } from "@/lib/types";

export const dynamic = "force-dynamic";

// Market 흐름은 GAIA 를 안 거쳐 ACTION_TYP 이 MCP 에만 있다
const SOURCE_LAYERS: LayerKey[] = ["GAIA", "MCP"];

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

async function distinctActionTypes(
  oracle: typeof import("oracledb"),
  layer: LayerKey,
  ctx: Record<string, unknown>
): Promise<string[]> {
  const cfg = loadConfig().layers[layer];
  if (!cfg) return [];
  let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
  try {
    conn = await oracle.getConnection(cfg);
    const result = await conn.execute(
      `SELECT DISTINCT ACTION_TYP
         FROM BIZ_AIACTIONTXN_HIS
        WHERE ACTION_TYP IS NOT NULL`,
      {},
      { outFormat: oracle.OBJECT }
    );
    const rows = (result.rows ?? []) as Array<Record<string, unknown>>;
    return rows
      .map((r) => (r["ACTION_TYP"] ?? r["action_typ"]) as string | null)
      .filter((v): v is string => !!v && v.trim() !== "");
  } catch (e) {
    logger.error("GET /api/action-types failed", { ...ctx, layer, err: String(e) });
    return [];
  } finally {
    if (conn) {
      try { await conn.close(); } catch { /* ignore */ }
    }
  }
}

export async function GET(req: NextRequest) {
  const bizGuard = await requireBiz();
  if (!bizGuard.ok) return NextResponse.json({ error: bizGuard.error }, { status: bizGuard.status });

  const t0 = Date.now();
  const ctx = reqContext(req);
  const oracle = await getOracle();
  if (!oracle) {
    return NextResponse.json({ values: [] });
  }

  const lists = await Promise.all(SOURCE_LAYERS.map((l) => distinctActionTypes(oracle, l, ctx)));
  const values = Array.from(new Set(lists.flat())).sort();
  logger.info("GET /api/action-types ok", { ...ctx, count: values.length, ms: Date.now() - t0 });
  return NextResponse.json({ values });
}
