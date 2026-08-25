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

/**
 * 에이전트 1개의 서버측 정의. db 는 그 에이전트의 GAIA DB(= TRX_TOKEN_DET 위치).
 * ⚠️ 접속정보를 품으므로 클라이언트로 내보내지 말 것 — publicAgents() 를 쓴다.
 */
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

/** 접속정보 3필드가 모두 있어야 구성된 것으로 본다 (normalizeLayers 와 같은 규칙) */
function normalizeDb(v: RawLayer | undefined): LayerDbConfig | null {
  if (!v) return null;
  const { user, password, connectString } = v;
  if (!user || !password || !connectString) return null;
  return { user, password, connectString };
}

/** 한도(TPM/RPM): 0 = 미설정을 허용해야 하므로 음수/비숫자만 0 으로 떨군다 */
function normalizeLimit(v: unknown): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * agents 섹션 정규화.
 * ⚠️ 섹션이 아예 없거나 쓸 만한 항목이 하나도 없으면 기본 에이전트 1개를 합성한다 —
 *    사내에 이미 배포된 config.yml(agents 없음)을 고치지 않아도 지금과 똑같이 동작해야 한다.
 */
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
    // 하위호환: agents 섹션이 없는 기존 배포 → 앱 자체 DB(GAIA)를 쓰는 단일 에이전트
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

  // 기본 에이전트는 정확히 하나. default:true 가 없으면 첫 항목을 기본으로 승격한다.
  let defaultIdx = out.findIndex((a) => a.isDefault);
  if (defaultIdx < 0) defaultIdx = 0;
  out.forEach((a, i) => { a.isDefault = i === defaultIdx; });

  // 기본 에이전트가 db 를 생략하면 layers.GAIA(앱 자체 DB)를 쓴다 — 기존 설정 재사용.
  if (!out[defaultIdx].db) out[defaultIdx].db = layers[APP_DB_LAYER] ?? null;

  return out;
}

/**
 * 이 앱의 "자체 DB" 로 쓰는 레이어.
 * 전용 DB 자원을 할당받지 못해, GAIA 레이어의 DB 를 앱 자체 DB 로 겸용한다.
 * 트레이스 조회와 무관한 앱 전용 테이블(ex. TRX_ERRMSG_COD 에러코드 마스터)은
 * 이 커넥션에 생성/조회한다. GAIA 의 DB 위치가 바뀌면 이 매핑만 따라가면 된다.
 */
export const APP_DB_LAYER: LayerKey = "GAIA";

/** 앱 자체 DB(= APP_DB_LAYER) 의 커넥션 설정. 미구성 시 null. */
export function getAppDbConfig(): LayerDbConfig | null {
  return loadConfig().layers[APP_DB_LAYER] ?? null;
}

/**
 * 이벤트-FAB 매핑(TRX_EVENT_MAP)이 저장되는 레이어.
 * 앱 자체 DB(GAIA)가 아니라 MCP 다 — MCP 로직이 요청 FAB 허용 여부를 이 테이블로
 * 직접 판정하기 때문. 테이블 위치가 바뀌면 이 매핑만 따라가면 된다.
 */
export const EVENT_FAB_DB_LAYER: LayerKey = "MCP";

/** 이벤트-FAB 매핑 DB(= EVENT_FAB_DB_LAYER) 의 커넥션 설정. 미구성 시 null. */
export function getEventFabDbConfig(): LayerDbConfig | null {
  return loadConfig().layers[EVENT_FAB_DB_LAYER] ?? null;
}

// ── 멀티 에이전트 ────────────────────────────────────────────────────────
// Tokens / Timeout 화면만 에이전트별로 갈린다 (출처가 TRX_TOKEN_DET 하나).
// BIZ_AIACTIONTXN_HIS 기반 화면은 전부 기본 에이전트 전용이며 위 layers 를 쓴다.

/** config 에 정의된 에이전트 목록 (항상 1개 이상). */
export function listAgents(): AgentDef[] {
  return loadConfig().agents;
}

/** 기본 에이전트의 id. */
export function defaultAgentId(): string {
  return loadConfig().defaultAgentId;
}

/** id 로 에이전트를 찾는다. id 생략 = 기본 에이전트. 없는 id 면 null. */
export function getAgent(id?: string | null): AgentDef | null {
  const cfg = loadConfig();
  const key = id && id.trim() ? id.trim() : cfg.defaultAgentId;
  return cfg.agents.find((a) => a.id === key) ?? null;
}

/**
 * 그 에이전트의 TRX_TOKEN_DET 가 있는 DB. 없는 id/미구성이면 null →
 * 호출부(tokens/timeouts/tickStats)가 기존대로 빈 통계를 돌려준다.
 */
export function getAgentDbConfig(id?: string | null): LayerDbConfig | null {
  return getAgent(id)?.db ?? null;
}

/** 클라이언트로 내려도 안전한 형태 (접속정보 제거). */
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
