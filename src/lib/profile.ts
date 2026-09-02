
// 에이전트 프로필 저장. normalizeProfile() 이 부분/구버전 데이터를 항상 완전한 객체로 보정한다.

import fs from "fs";
import path from "path";
import { AgentProfile, DEFAULT_PROFILE, FteActionMinute, WorkTask } from "./types";
import { defaultAgentId, getAgent } from "./config";
import { logger } from "./logger";

const DATA_DIR = path.join(process.cwd(), "data");

function profileFile(agentId?: string | null): string {
  const id = (agentId ?? "").trim();
  if (!id || id === defaultAgentId()) return path.join(DATA_DIR, "agent-profile.json");
  const safe = id.replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(DATA_DIR, `agent-profile.${safe}.json`);
}

function sanitizeTasks(v: unknown): WorkTask[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: WorkTask[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const t = item as Record<string, unknown>;
    out.push({
      icon: typeof t.icon === "string" ? t.icon : "•",
      title: typeof t.title === "string" ? t.title : "",
      desc: typeof t.desc === "string" ? t.desc : "",
      metric: typeof t.metric === "string" && t.metric.trim() ? t.metric : undefined,
    });
  }
  return out;
}

export function normalizeProfile(raw: unknown): AgentProfile {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (k: keyof AgentProfile, d: string) =>
    typeof r[k] === "string" ? (r[k] as string) : d;

  const skills = Array.isArray(r.skills)
    ? r.skills.filter((s): s is string => typeof s === "string" && s.trim() !== "")
    : DEFAULT_PROFILE.skills;

  const posNum = (v: unknown, d: number): number => {
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : d;
  };

  let fteActionMinutes: FteActionMinute[];
  if (Array.isArray(r.fteActionMinutes)) {
    fteActionMinutes = [];
    for (const item of r.fteActionMinutes) {
      if (!item || typeof item !== "object") continue;
      const a = item as Record<string, unknown>;
      const action = typeof a.action === "string" ? a.action.trim() : "";
      const minutes = posNum(a.minutes, 0);
      if (action !== "" && minutes > 0) fteActionMinutes.push({ action, minutes });
    }
  } else {
    fteActionMinutes = DEFAULT_PROFILE.fteActionMinutes.map((a) => ({ ...a }));
  }

  return {
    name:         str("name", DEFAULT_PROFILE.name),
    nickname:     str("nickname", DEFAULT_PROFILE.nickname),
    rank:         str("rank", DEFAULT_PROFILE.rank),
    workingHours: str("workingHours", DEFAULT_PROFILE.workingHours),
    skills,
    fteActionMinutes,
    fteDefaultMinutes: posNum(r.fteDefaultMinutes ?? r.fteMinutesPerCase, DEFAULT_PROFILE.fteDefaultMinutes),
    fteAnnualMinutes:  posNum(r.fteAnnualMinutes, DEFAULT_PROFILE.fteAnnualMinutes),
    tagline:      str("tagline", DEFAULT_PROFILE.tagline),
    avatar:       str("avatar", DEFAULT_PROFILE.avatar),
    avatarImage:  str("avatarImage", DEFAULT_PROFILE.avatarImage),
    roadmap:      str("roadmap", DEFAULT_PROFILE.roadmap),
    tasks:        normalizeTasks(r),
    tpmLimit:     limitNum(r.tpmLimit),
    rpmLimit:     limitNum(r.rpmLimit),
  };
}

function limitNum(v: unknown): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function normalizeTasks(r: Record<string, unknown>): WorkTask[] {
  const unified = sanitizeTasks(r.tasks);
  if (unified) return unified;
  const formal = sanitizeTasks(r.formalTasks) ?? [];
  const informal = sanitizeTasks(r.informalTasks) ?? [];
  const merged = [...formal, ...informal];
  return merged.length > 0 ? merged : DEFAULT_PROFILE.tasks;
}

export function readProfile(agentId?: string | null): AgentProfile {
  const file = profileFile(agentId);
  let base: AgentProfile;
  try {
    base = fs.existsSync(file) ? normalizeProfile(JSON.parse(fs.readFileSync(file, "utf8"))) : seedFor(agentId);
  } catch (e) {
    logger.error("profile read failed", { file, err: String(e) });
    base = seedFor(agentId);
  }
  return base;
}

function seedFor(agentId?: string | null): AgentProfile {
  const p = { ...DEFAULT_PROFILE };
  const id = (agentId ?? "").trim();
  if (!id || id === defaultAgentId()) return p;
  const a = getAgent(id);
  if (a) {
    p.name = a.name;
    p.avatar = a.avatar;
    p.tagline = "";
    p.nickname = "";
    p.skills = [];
    p.tasks = [];
    p.tpmLimit = a.tpmLimit;
    p.rpmLimit = a.rpmLimit;
  }
  return p;
}

export function writeProfile(raw: unknown, agentId?: string | null): AgentProfile {
  const file = profileFile(agentId);
  const normalized = normalizeProfile(raw);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(normalized, null, 2), "utf8");
  logger.info("profile saved", { file, agentId: agentId ?? null });
  return normalized;
}
