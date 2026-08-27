// 에이전트 프로필의 영속 저장 계층 (에이전트마다 1개).
//
// 통계는 Oracle 에서 읽지만 프로필은 단순한 단일 레코드라 로컬 JSON 파일에 저장한다.
// 파일이 없거나 일부 필드만 있어도 DEFAULT_PROFILE 로 채워 항상 완전한 객체를 돌려준다.
//
//   기본 에이전트  → data/agent-profile.json      (기존 파일 그대로 — 이관 불필요)
//   그 외 에이전트 → data/agent-profile.<id>.json
//
// ⚠️ 기본 에이전트만 예외적으로 파일명이 다르다. 다중 에이전트 이전에 쓰던 파일이라
//    이름을 바꾸면 운영 중인 프로필이 통째로 초기화된다.
//
// ※ server-only. fs 를 쓰므로 클라이언트 컴포넌트에서 import 하지 말 것.
//   (타입과 DEFAULT_PROFILE 은 @/lib/types 에서 가져오면 클라이언트에서도 안전)

import fs from "fs";
import path from "path";
import { AgentProfile, DEFAULT_PROFILE, FteActionMinute, WorkTask } from "./types";
import { defaultAgentId, getAgent } from "./config";
import { logger } from "./logger";

const DATA_DIR = path.join(process.cwd(), "data");

/**
 * 에이전트별 프로필 파일 경로.
 *
 * ⚠️ id 는 파일명이 되므로 경로 문자를 반드시 막는다 — `?agent=../../x` 같은 값이
 *    그대로 들어오면 data/ 밖의 파일을 읽거나 덮어쓸 수 있다. 라우트가 config 에 있는
 *    id 만 넘기도록 검증하지만, 저장 계층에서도 한 번 더 막는다(방어 2중).
 */
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

/** 부분 입력(raw)을 기본값과 병합해 완전한 AgentProfile 로 정규화한다. */
export function normalizeProfile(raw: unknown): AgentProfile {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (k: keyof AgentProfile, d: string) =>
    typeof r[k] === "string" ? (r[k] as string) : d;

  const skills = Array.isArray(r.skills)
    ? r.skills.filter((s): s is string => typeof s === "string" && s.trim() !== "")
    : DEFAULT_PROFILE.skills;

  // FTE 계산식 상수: 0 이하/비숫자는 기본값으로 보정 (연간 분이 0 이면 나눗셈이 깨진다)
  const posNum = (v: unknown, d: number): number => {
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : d;
  };

  // 액션(ACTION_TYP)별 환산 분: 액션명이 비었거나 분이 0 이하/비숫자인 행은 버린다.
  // 필드 자체가 없으면(구버전 저장분) 기본 매핑으로 채운다.
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
    // 구버전의 단일 건당 분(fteMinutesPerCase)은 기본 분으로 마이그레이션
    fteDefaultMinutes: posNum(r.fteDefaultMinutes ?? r.fteMinutesPerCase, DEFAULT_PROFILE.fteDefaultMinutes),
    fteAnnualMinutes:  posNum(r.fteAnnualMinutes, DEFAULT_PROFILE.fteAnnualMinutes),
    tagline:      str("tagline", DEFAULT_PROFILE.tagline),
    avatar:       str("avatar", DEFAULT_PROFILE.avatar),
    avatarImage:  str("avatarImage", DEFAULT_PROFILE.avatarImage),
    roadmap:      str("roadmap", DEFAULT_PROFILE.roadmap),
    tasks:        normalizeTasks(r),
    // 한도는 0 = 미설정이 정상값이라 posNum(>0 강제)을 쓰지 않는다. 음수/비숫자만 0 으로 떨군다.
    tpmLimit:     limitNum(r.tpmLimit),
    rpmLimit:     limitNum(r.rpmLimit),
  };
}

/** 한도 값 정규화 — 0 = 미설정. 음수/비숫자/소수는 0 또는 정수로 떨군다. */
function limitNum(v: unknown): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

// tasks 정규화. 구버전 저장 파일은 formalTasks/informalTasks 로 나뉘어 있으므로
// tasks 가 없으면 둘을 합쳐 마이그레이션한다.
function normalizeTasks(r: Record<string, unknown>): WorkTask[] {
  const unified = sanitizeTasks(r.tasks);
  if (unified) return unified;
  const formal = sanitizeTasks(r.formalTasks) ?? [];
  const informal = sanitizeTasks(r.informalTasks) ?? [];
  const merged = [...formal, ...informal];
  return merged.length > 0 ? merged : DEFAULT_PROFILE.tasks;
}

/**
 * 프로필 읽기. 파일이 없으면 기본값.
 *
 * ⚠️ 비기본 에이전트의 첫 조회는 파일이 없어 DEFAULT_PROFILE(= 이억수 기본값)이 나온다.
 *    그대로 두면 다른 팀 화면에 "이억수 TL" 이 뜨므로, config 의 이름/아바타로 덮어쓴다.
 */
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

/** 파일이 아직 없는 에이전트의 시작값 — config.yml 의 표시정보를 얹은 기본 프로필. */
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
