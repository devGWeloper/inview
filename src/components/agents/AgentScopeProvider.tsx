"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AgentInfo, AgentsResponse } from "@/lib/types";
import { apiJson, asArray } from "@/lib/apiClient";
import { useAuth } from "@/components/auth/AuthProvider";

// ─────────────────────────────────────────────────────────────────────────────
// 선택된 에이전트를 앱 전역에 공급한다.
//
// ⚠️ 에이전트별로 갈리는 화면은 Tokens / Timeout (TRX_TOKEN_DET) 과 Agent 프로필뿐이다.
//    나머지(Traces/Dashboard/Report/Improvement/event-fabs)는
//    BIZ_AIACTIONTXN_HIS 기반의 기본 에이전트 전용이므로, 그 경로로 이동하면
//    선택을 기본 에이전트로 되돌린다 — 숨긴 화면에 남의 에이전트 컨텍스트가
//    걸려 있는 상태를 만들지 않기 위함이다.
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "tracex.agent";

/**
 * 에이전트별로 갈리는 경로 접두사.
 * ⚠️ "/agent" 는 프로필 카드(에이전트마다 별도 파일)라 여기 들어간다 — "/agents" 같은
 *    다른 경로와 섞이지 않도록 판정은 정확 일치 또는 `prefix + "/"` 로만 한다(아래).
 */
const AGENT_SCOPED_PREFIXES = ["/tokens", "/timeouts", "/agent"];

export function isAgentScopedPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return AGENT_SCOPED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** 비기본 에이전트를 골랐을 때 보낼 기본 착지 경로 */
export const AGENT_HOME = "/tokens";

interface AgentScope {
  agents: AgentInfo[];
  agentId: string;
  agent: AgentInfo | null;
  defaultId: string;
  isDefault: boolean;
  /** /api/agents 로드가 끝났는가. 페이지는 이게 true 가 된 뒤 조회한다 */
  ready: boolean;
  /** 전역(모든 에이전트) 계정인가 — 셀렉터/탭 노출 판단에 쓴다. */
  isGlobal: boolean;
  /**
   * 계정 범위가 막다른 길일 때의 안내 문구 (정상이면 null).
   *   ① 미배정(잠금) — 아무 에이전트도 볼 수 없다
   *   ② 소속 에이전트가 config.yml 에 없다
   * 두 경우 모두 /api/agents 목록이 비고 조회는 403 만 돌아오므로,
   * 앱 셸(AppChrome)이 이 문구를 띄워 "왜 아무것도 안 보이는지" 를 밝힌다.
   */
  scopeWarning: string | null;
  setAgentId: (id: string) => void;
}

const Ctx = createContext<AgentScope>({
  agents: [],
  agentId: "",
  agent: null,
  defaultId: "",
  isDefault: true,
  isGlobal: false,
  ready: false,
  scopeWarning: null,
  setAgentId: () => {},
});

export function useAgentScope(): AgentScope {
  return useContext(Ctx);
}

export function AgentScopeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();

  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [defaultId, setDefaultId] = useState("");
  const [agentId, setAgentIdState] = useState("");
  const [ready, setReady] = useState(false);
  // 목록을 **실제로 받았는가**. 조회 실패(네트워크/401)와 "결속 에이전트가 없어 빈 목록"
  // 을 구분하는 용도 — 구분하지 않으면 로그아웃 상태에서도 결속 경고가 뜬다.
  const [listed, setListed] = useState(false);

  // 스냅백 effect 가 최신 값을 보되 agentId 변경으로는 재실행되지 않게 ref 로 읽는다.
  const agentIdRef = useRef("");
  const defaultIdRef = useRef("");
  agentIdRef.current = agentId;
  defaultIdRef.current = defaultId;

  useEffect(() => {
    let alive = true;
    apiJson<AgentsResponse>("/api/agents", { cache: "no-store" })
      .then((d) => {
        if (!alive) return;
        const list = asArray<AgentInfo>(d.agents);
        const def = d.defaultId || (list[0]?.id ?? "");
        setAgents(list);
        setDefaultId(def);
        setListed(true);

        // 저장된 선택이 지금 config 에 없으면 기본으로 리셋한다.
        let saved = "";
        try { saved = window.localStorage.getItem(STORAGE_KEY) ?? ""; } catch { /* 접근 불가면 기본값 */ }
        const valid = saved && list.some((a) => a.id === saved) ? saved : def;
        // 에이전트 화면이 아니면 기본으로 시작한다.
        setAgentIdState(isAgentScopedPath(window.location.pathname) ? valid : def);
      })
      .catch(() => { /* 목록을 못 읽으면 셀렉터 없이 기본 에이전트로 동작 */ })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  // 경로 이동 시에만 스냅백 판정한다.
  // ⚠️ deps 에 agentId 를 넣으면 셀렉터로 고른 직후(아직 /tokens 로 이동 전) 되돌려 버린다.
  useEffect(() => {
    if (!isAgentScopedPath(pathname) && defaultIdRef.current && agentIdRef.current !== defaultIdRef.current) {
      setAgentIdState(defaultIdRef.current);
    }
  }, [pathname]);

  const setAgentId = useCallback((id: string) => {
    setAgentIdState(id);
    try { window.localStorage.setItem(STORAGE_KEY, id); } catch { /* 저장 못 해도 이번 세션은 동작 */ }
    // 비기본 에이전트를 에이전트 화면 밖에서 고르면 Tokens 로 데려간다.
    if (id !== defaultIdRef.current && !isAgentScopedPath(window.location.pathname)) {
      router.push(AGENT_HOME);
    }
  }, [router]);

  const value = useMemo<AgentScope>(() => {
    const agent = agents.find((a) => a.id === agentId) ?? null;
    // 계정 결속(TRX_USER_MAS.AGENT_ID)이 config.yml 의 agents[] 중 어디에도 없는 경우.
    // 목록이 비어 셀렉터도 안 뜨고 조회는 403 만 돌아오는 막다른 길이라, 화면에 이유를 남긴다.
    const bound = user?.agentId ?? null;
    const isGlobal = user?.global === true;
    let scopeWarning: string | null = null;
    if (listed && user && !isGlobal) {
      if (!bound) {
        scopeWarning = "이 계정에는 아직 에이전트가 배정되지 않았습니다. 조회 화면이 비어 있습니다 — 운영자에게 배정을 요청하세요.";
      } else if (!agents.some((a) => a.id === bound)) {
        scopeWarning = `이 계정은 '${bound}' 에이전트에만 접근할 수 있는데, 서버 설정에 그 에이전트가 없습니다. Tokens · Timeout 조회가 되지 않습니다 — 관리자에게 문의하세요.`;
      }
    }
    return {
      agents,
      agentId,
      agent,
      defaultId,
      // ⚠️ id 비교가 아니라 **선택된 에이전트 자신의 isDefault 플래그**로 판정한다.
      //    id 비교(agentId === defaultId)는 결속 계정처럼 "목록이 그 에이전트 하나뿐이라
      //    defaultId 도 그 id 로 echo 되는" 상황에서 비기본 에이전트를 기본으로 오판한다
      //    (agents=[agent-b], defaultId="agent-b" → 비교식은 true, 실제론 false).
      //    agent 를 못 찾은 상태(로드 전/실패/저장된 id 가 아직 반영 전)는 안전한 기본값 true.
      isDefault: agent ? agent.isDefault : true,
      isGlobal,
      ready,
      scopeWarning,
      setAgentId,
    };
  }, [agents, agentId, defaultId, ready, listed, user, setAgentId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * 결속 에이전트가 설정에 없을 때의 안내 띠 (앱 셸의 상단바 바로 아래).
 * 평소에는 아무것도 렌더하지 않는다.
 */
export function AgentScopeWarning() {
  const { scopeWarning } = useAgentScope();
  if (!scopeWarning) return null;
  return (
    <div className="agent-scope-warn" role="alert">
      <span aria-hidden>⚠️</span>
      <span>{scopeWarning}</span>
    </div>
  );
}
