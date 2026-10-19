// 트레이스 행 → 흐름(FIX / Judge / ER MAP) · 진입(CUBE / DSP) 판정. 서버·클라이언트 공용(순수).
// 규칙: docs/architecture/data-flow.md 의 "흐름"
import {
  FLOWS, FlowKey, FlowStage, LAYER_ORDER, LayerKey, StageKey, TracePath, TraceRow, stageColor,
} from "./types";

export const DSP_RECV_SYS_ID = "DSP";
export const MCP_MARKET_SYS_ID = "MCP_MARKET";
export const JUDGE_ACTION_TYP = "JUDGE";
/** GAIA 가 A2A 로 외부 에이전트를 부르는 액션 */
export const A2A_ACTION_TYPS: readonly string[] = ["ERMAP"];

type PathRow = Pick<TraceRow, "layer" | "actionTyp" | "recvSysId" | "sysId">;
type StageRow = Pick<TraceRow, "layer" | "sendTm">;

const norm = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

export function classifyPath(rows: PathRow[]): TracePath {
  const entryLayer = LAYER_ORDER[0];
  const entry = rows.some((r) => r.layer === entryLayer && norm(r.recvSysId) === DSP_RECV_SYS_ID) ? "DSP" : "CUBE";

  const mcp = rows.filter((r) => r.layer === "MCP");
  const mcpMarket = mcp.length > 0 && mcp.every((r) => norm(r.sysId) === MCP_MARKET_SYS_ID);

  const actionTyp = norm(
    rows.find((r) => r.layer === "GAIA" && r.actionTyp)?.actionTyp ?? rows.find((r) => r.actionTyp)?.actionTyp
  );
  let flow: FlowKey = "FIX";
  if (A2A_ACTION_TYPS.includes(actionTyp)) flow = "ERMAP";
  else if (actionTyp === JUDGE_ACTION_TYP) flow = "JUDGE";
  else if (!actionTyp && mcpMarket && !rows.some((r) => r.layer === "ONEOIS")) flow = "JUDGE";

  return { flow, entry, mcpMarket };
}

export function flowLayers(flow: FlowKey): readonly LayerKey[] {
  return FLOWS.find((f) => f.key === flow)!.layers;
}

function stageLabel(key: StageKey, path: TracePath): string {
  if (key === "CUBE") return path.entry === "DSP" ? "AI GATEWAY" : "CUBE BOT";
  if (key === "MCP") return path.mcpMarket || path.flow === "JUDGE" ? "MCP Market" : "MCP";
  if (key === "A2A") return "A2A · ER MAP";
  if (key === "ONEOIS") return "OneOIS";
  return key;
}

/** 흐름의 칸 목록. 흐름 밖인데 행이 있는 레이어도 LAYER_ORDER 자리에 끼워 넣는다(expected=false) */
export function traceStages(path: TracePath, presentLayers: Iterable<LayerKey>): FlowStage[] {
  const def = FLOWS.find((f) => f.key === path.flow)!;
  const expected = new Set<LayerKey>(def.layers);
  const present = new Set(presentLayers);
  const keys: StageKey[] = LAYER_ORDER.filter((l) => expected.has(l) || present.has(l));
  if (def.a2a) keys.splice(keys.indexOf("GAIA") + 1, 0, "A2A");
  return keys.map((key) => ({
    key,
    label: stageLabel(key, path),
    color: stageColor(key),
    expected: key === "A2A" || expected.has(key as LayerKey),
  }));
}

export function stageHit(key: StageKey, rows: StageRow[]): boolean {
  if (key === "A2A") return rows.some((r) => r.layer === "GAIA" && !!r.sendTm);
  return rows.some((r) => r.layer === key);
}

/** 상위 I/F 시스템(적재 안 함) */
export function upstreamLabel(path: TracePath): string {
  return path.entry === "DSP" ? "DSP" : "CUBE";
}

/** 하위 시스템 표기. GAIA 는 A2A 호출도 SEND_SYS_ID='MCP' 로 기록하므로 ER MAP 흐름에서 바로잡아 보여준다 */
export function sendPeerLabel(row: Pick<TraceRow, "layer" | "sendSysId">, path: TracePath): string | null {
  if (path.flow === "ERMAP" && row.layer === "GAIA") return "A2A";
  return row.sendSysId;
}

/** 흐름이 거쳐야 할 레이어가 다 있고 모든 행이 응답까지 받았다. Traces · Dashboard 공용 */
export function isTraceComplete(rows: (PathRow & Pick<TraceRow, "sendCompltYn">)[]): boolean {
  const { flow } = classifyPath(rows);
  const present = new Set(rows.map((r) => r.layer));
  return flowLayers(flow).every((l) => present.has(l)) && rows.every((r) => r.sendCompltYn === "Y");
}
