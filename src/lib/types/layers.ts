// 레이어 정의의 단일 소스. 추가/삭제/순서변경은 이 배열만 고치면 된다.

// 도메인 타입 모음. LAYERS 가 레이어 정의의 단일 소스 — 여기만 고치면 나머지가 따라온다.

export const LAYERS = [
  { key: "CUBE",   label: "Cube / Cube Bot", color: "#4b6bfb" },
  { key: "GAIA",   label: "Gaia Agent",      color: "#a21caf" },
  { key: "MCP",    label: "MCP Server",      color: "#059669" },
  { key: "ONEOIS", label: "OneOIS",          color: "#d97706" },
] as const;

export type LayerKey = typeof LAYERS[number]["key"];

export const LAYER_ORDER: readonly LayerKey[] = LAYERS.map((l) => l.key);

export const LAYER_LABEL: Record<LayerKey, string> = Object.fromEntries(
  LAYERS.map((l) => [l.key, l.label])
) as Record<LayerKey, string>;

export const LAYER_COLOR: Record<LayerKey, string> = Object.fromEntries(
  LAYERS.map((l) => [l.key, l.color])
) as Record<LayerKey, string>;
