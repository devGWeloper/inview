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
  useMock?: boolean;
  layers?: Partial<Record<LayerKey, RawLayer>>;
}

interface AppConfig {
  appEnv: AppEnv;
  useMock: boolean;
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
    logger.warn("no config file found; falling back to mock", {
      tried: [devPath, prdPath],
    });
  }

  cached = {
    appEnv,
    useMock: raw?.useMock === true,
    layers: normalizeLayers(raw),
    sourceFile,
  };
  logger.info("config loaded", {
    appEnv: cached.appEnv,
    sourceFile: cached.sourceFile,
    useMock: cached.useMock,
    layers: Object.keys(cached.layers),
  });
  return cached;
}
