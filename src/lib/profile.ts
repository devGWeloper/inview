// 에이전트 프로필(이억수 TL)의 영속 저장 계층.
//
// 통계는 Oracle 에서 읽지만 프로필은 단순한 단일 레코드라 로컬 JSON 파일
// (data/agent-profile.json) 에 저장한다. 파일이 없거나 일부 필드만 있어도
// DEFAULT_PROFILE 로 채워 항상 완전한 객체를 돌려준다.
//
// ※ server-only. fs 를 쓰므로 클라이언트 컴포넌트에서 import 하지 말 것.
//   (타입과 DEFAULT_PROFILE 은 @/lib/types 에서 가져오면 클라이언트에서도 안전)

import fs from "fs";
import path from "path";
import { AgentProfile, DEFAULT_PROFILE, WorkTask } from "./types";
import { logger } from "./logger";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "agent-profile.json");

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

/** 부분 입력(raw)을 기본값과 병합해 완전한 AgentProfile 로 정규화한다. */
export function normalizeProfile(raw: unknown): AgentProfile {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (k: keyof AgentProfile, d: string) =>
    typeof r[k] === "string" ? (r[k] as string) : d;

  let fte: number | null = DEFAULT_PROFILE.fte;
  if (typeof r.fte === "number" && Number.isFinite(r.fte)) fte = r.fte;
  else if (r.fte === null) fte = null;
  else if (typeof r.fte === "string" && r.fte.trim() !== "") {
    const n = Number(r.fte);
    fte = Number.isFinite(n) ? n : null;
  }

  const skills = Array.isArray(r.skills)
    ? r.skills.filter((s): s is string => typeof s === "string" && s.trim() !== "")
    : DEFAULT_PROFILE.skills;

  return {
    name:         str("name", DEFAULT_PROFILE.name),
    nickname:     str("nickname", DEFAULT_PROFILE.nickname),
    rank:         str("rank", DEFAULT_PROFILE.rank),
    workingHours: str("workingHours", DEFAULT_PROFILE.workingHours),
    skills,
    fte,
    fteNote:      str("fteNote", DEFAULT_PROFILE.fteNote),
    tagline:      str("tagline", DEFAULT_PROFILE.tagline),
    avatar:       str("avatar", DEFAULT_PROFILE.avatar),
    avatarImage:  str("avatarImage", DEFAULT_PROFILE.avatarImage),
    roadmap:      str("roadmap", DEFAULT_PROFILE.roadmap),
    formalTasks:   sanitizeTasks(r.formalTasks)   ?? DEFAULT_PROFILE.formalTasks,
    informalTasks: sanitizeTasks(r.informalTasks) ?? DEFAULT_PROFILE.informalTasks,
  };
}

export function readProfile(): AgentProfile {
  try {
    if (!fs.existsSync(FILE)) return { ...DEFAULT_PROFILE };
    const raw = fs.readFileSync(FILE, "utf8");
    return normalizeProfile(JSON.parse(raw));
  } catch (e) {
    logger.error("profile read failed", { file: FILE, err: String(e) });
    return { ...DEFAULT_PROFILE };
  }
}

export function writeProfile(raw: unknown): AgentProfile {
  const normalized = normalizeProfile(raw);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(normalized, null, 2), "utf8");
  logger.info("profile saved", { file: FILE });
  return normalized;
}
