import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { LayerKey } from "./types";
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

interface RawConfig {
  layers?: Partial<Record<LayerKey, RawLayer>>;
}

interface AppConfig {
  appEnv: AppEnv;
  layers: Partial<Record<LayerKey, LayerDbConfig>>;
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
 * 앱 자체 DB(= GAIA)에 둔다 — TRX_TOKEN_DET 등과 같은 곳.
 * 테이블 위치가 바뀌면 이 매핑만 따라가면 된다.
 */
export const EVENT_FAB_DB_LAYER: LayerKey = APP_DB_LAYER;

/** 이벤트-FAB 매핑 DB(= EVENT_FAB_DB_LAYER) 의 커넥션 설정. 미구성 시 null. */
export function getEventFabDbConfig(): LayerDbConfig | null {
  return loadConfig().layers[EVENT_FAB_DB_LAYER] ?? null;
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

  cached = {
    appEnv,
    layers: normalizeLayers(raw),
    sourceFile,
  };
  logger.info("config loaded", {
    appEnv: cached.appEnv,
    sourceFile: cached.sourceFile,
    layers: Object.keys(cached.layers),
  });
  return cached;
}
