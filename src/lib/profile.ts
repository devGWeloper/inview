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
import { AgentProfile, DEFAULT_PROFILE, FteActionMinute, WorkTask } from "./types";
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
  };
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
