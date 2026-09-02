// YAML 설정 로더 (시작 시 1회, 캐시). GAIA 의 DB 가 앱 자체 DB 를 겸하며 그 매핑은
// APP_DB_LAYER 한 곳이다. AgentDef 는 접속정보를 품으므로 서버 전용 —
// 클라이언트로는 publicAgents() 의 AgentInfo 만 내린다. docs/architecture/agents.md

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { AgentInfo, DEFAULT_PROFILE, LayerKey } from "./types";
import { logger } from "./logger";

export type AppEnv = "dev" | "prd";

export interface LayerDbConfig {
  user: string;
  password: string;
  connectString: string;
}

interface RawLayer {
  user?: string;
  password?: string;
  connectString?: string;
}

export interface AgentDef {
  id: string;
  name: string;
  avatar: string;
  isDefault: boolean;
  db: LayerDbConfig | null;
  tpmLimit: number;
  rpmLimit: number;
}

interface RawAgent {
  id?: string;
  name?: string;
  avatar?: string;
  default?: boolean;
  db?: RawLayer;
  tpmLimit?: number | string;
  rpmLimit?: number | string;
}

interface RawConfig {
  layers?: Partial<Record<LayerKey, RawLayer>>;
  agents?: RawAgent[];
}

interface AppConfig {
  appEnv: AppEnv;
  layers: Partial<Record<LayerKey, LayerDbConfig>>;
  agents: AgentDef[];
  defaultAgentId: string;
  sourceFile: string | null;
}

const DEV_FILE = "config.dev.yml";
const PRD_FILE = "config.yml";

let cached: AppConfig | null = null;

function readYaml(file: string): RawConfig | null {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = yaml.load(raw);
    return (parsed && typeof parsed === "object" ? parsed : {}) as RawConfig;
  } catch (e) {
    logger.error("config read failed", { file, err: String(e) });
    return null;
  }
}

function normalizeLayers(raw: RawConfig | null): Partial<Record<LayerKey, LayerDbConfig>> {
  const out: Partial<Record<LayerKey, LayerDbConfig>> = {};
  const src = raw?.layers ?? {};
  for (const [k, v] of Object.entries(src)) {
    if (!v) continue;
    const { user, password, connectString } = v;
    if (!user || !password || !connectString) continue;
    out[k as LayerKey] = { user, password, connectString };
  }
  return out;
}

function normalizeDb(v: RawLayer | undefined): LayerDbConfig | null {
  if (!v) return null;
  const { user, password, connectString } = v;
  if (!user || !password || !connectString) return null;
  return { user, password, connectString };
}

function normalizeLimit(v: unknown): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0;
}

function normalizeAgents(
  raw: RawConfig | null,
  layers: Partial<Record<LayerKey, LayerDbConfig>>
): AgentDef[] {
  const src = Array.isArray(raw?.agents) ? raw!.agents! : [];
  const out: AgentDef[] = [];
  const seen = new Set<string>();

  for (const a of src) {
    if (!a || typeof a !== "object") continue;
    const id = typeof a.id === "string" ? a.id.trim() : "";
    if (!id) {
      logger.warn("agent entry skipped: id 누락", { name: a?.name ?? null });
      continue;
    }
    if (seen.has(id)) {
      logger.warn("agent entry skipped: id 중복", { id });
      continue;
    }
    seen.add(id);
    out.push({
      id,
      name: typeof a.name === "string" && a.name.trim() ? a.name.trim() : id,
      avatar: typeof a.avatar === "string" && a.avatar.trim() ? a.avatar.trim() : "🤖",
      isDefault: a.default === true,
      db: normalizeDb(a.db),
      tpmLimit: normalizeLimit(a.tpmLimit),
      rpmLimit: normalizeLimit(a.rpmLimit),
    });
  }

  if (out.length === 0) {
    out.push({
      id: "default",
      name: DEFAULT_PROFILE.name,
      avatar: DEFAULT_PROFILE.avatar,
      isDefault: true,
      db: layers[APP_DB_LAYER] ?? null,
      tpmLimit: 0,
      rpmLimit: 0,
    });
    return out;
  }

  let defaultIdx = out.findIndex((a) => a.isDefault);
  if (defaultIdx < 0) defaultIdx = 0;
  out.forEach((a, i) => { a.isDefault = i === defaultIdx; });

  if (!out[defaultIdx].db) out[defaultIdx].db = layers[APP_DB_LAYER] ?? null;

  return out;
}

export const APP_DB_LAYER: LayerKey = "GAIA";

export function getAppDbConfig(): LayerDbConfig | null {
  return loadConfig().layers[APP_DB_LAYER] ?? null;
}

export const EVENT_FAB_DB_LAYER: LayerKey = "MCP";

export function getEventFabDbConfig(): LayerDbConfig | null {
  return loadConfig().layers[EVENT_FAB_DB_LAYER] ?? null;
}

export function listAgents(): AgentDef[] {
  return loadConfig().agents;
}

export function defaultAgentId(): string {
  return loadConfig().defaultAgentId;
}

export function getAgent(id?: string | null): AgentDef | null {
  const cfg = loadConfig();
  const key = id && id.trim() ? id.trim() : cfg.defaultAgentId;
  return cfg.agents.find((a) => a.id === key) ?? null;
}

export function getAgentDbConfig(id?: string | null): LayerDbConfig | null {
  return getAgent(id)?.db ?? null;
}

export function publicAgents(): AgentInfo[] {
  return listAgents().map((a) => ({
    id: a.id,
    name: a.name,
    avatar: a.avatar,
    isDefault: a.isDefault,
    tpmLimit: a.tpmLimit,
    rpmLimit: a.rpmLimit,
    dbConfigured: a.db != null,
  }));
}

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const root = process.cwd();
  const devPath = path.join(root, DEV_FILE);
  const prdPath = path.join(root, PRD_FILE);

  let appEnv: AppEnv;
  let sourceFile: string | null;
  let raw: RawConfig | null;

  if (fs.existsSync(devPath)) {
    appEnv = "dev";
    sourceFile = devPath;
    raw = readYaml(devPath);
  } else if (fs.existsSync(prdPath)) {
    appEnv = "prd";
    sourceFile = prdPath;
    raw = readYaml(prdPath);
  } else {
    appEnv = "dev";
    sourceFile = null;
    raw = null;
    logger.warn("no config file found", { tried: [devPath, prdPath] });
  }

  const layers = normalizeLayers(raw);
  const agents = normalizeAgents(raw, layers);

  cached = {
    appEnv,
    layers,
    agents,
    defaultAgentId: (agents.find((a) => a.isDefault) ?? agents[0]).id,
    sourceFile,
  };
  logger.info("config loaded", {
    appEnv: cached.appEnv,
    sourceFile: cached.sourceFile,
    layers: Object.keys(cached.layers),
    agents: cached.agents.map((a) => `${a.id}${a.db ? "" : "(db미구성)"}`),
    defaultAgentId: cached.defaultAgentId,
  });
  return cached;
}
