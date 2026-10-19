// 요청 흐름 정의. 판정 로직은 src/lib/flows.ts, 배경은 docs/architecture/data-flow.md 의 "흐름".
import { LAYER_COLOR, LayerKey } from "./layers";

export const FLOWS = [
  { key: "FIX",   label: "FIX",    layers: ["CUBE", "GAIA", "MCP", "ONEOIS"], a2a: false },
  { key: "JUDGE", label: "Judge",  layers: ["CUBE", "GAIA", "MCP"],           a2a: false },
  { key: "ERMAP", label: "ER MAP", layers: ["CUBE", "GAIA"],                  a2a: true  },
] as const satisfies readonly { key: string; label: string; layers: readonly LayerKey[]; a2a: boolean }[];

export type FlowKey = typeof FLOWS[number]["key"];

export const FLOW_KEYS: readonly FlowKey[] = FLOWS.map((f) => f.key);

export const FLOW_LABEL: Record<FlowKey, string> = Object.fromEntries(
  FLOWS.map((f) => [f.key, f.label])
) as Record<FlowKey, string>;

/** 진입 경로. 둘 다 I/F 만 하고 적재하지 않는다 — 적재는 그 아래 CUBE 레이어(CUBE BOT / AI GATEWAY)부터 */
export type EntryKey = "CUBE" | "DSP";

/** 흐름 위의 한 칸. A2A 는 DB 가 없어 GAIA 행의 send/resp 로 그린다 */
export type StageKey = LayerKey | "A2A";

export const A2A_COLOR = "#0891b2";

export function stageColor(key: StageKey): string {
  return key === "A2A" ? A2A_COLOR : LAYER_COLOR[key];
}

export interface TracePath {
  flow: FlowKey;
  entry: EntryKey;
  /** MCP 행이 전부 Market 경로(SYS_ID=MCP_MARKET)로 들어왔다 */
  mcpMarket: boolean;
}

export interface FlowStage {
  key: StageKey;
  label: string;
  color: string;
  /** 이 흐름이 거쳐야 하는 칸인가. false = 흐름 밖인데 행이 있는 레이어 */
  expected: boolean;
}
