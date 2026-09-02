"use client";
// 선택된 에이전트를 쥔다. BIZ 경로로 이동하면 기본 에이전트로 스냅백한다
// — 그 effect 의 deps 는 [pathname] 뿐이어야 한다(agentId 를 넣으면 고른 직후 되돌아간다).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AgentInfo, AgentsResponse } from "@/lib/types";
import { apiJson, asArray } from "@/lib/apiClient";
import { useAuth } from "@/components/auth/AuthProvider";

const STORAGE_KEY = "tracex.agent";

const AGENT_SCOPED_PREFIXES = ["/tokens", "/timeouts", "/agent"];

export function isAgentScopedPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return AGENT_SCOPED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export const AGENT_HOME = "/tokens";

interface AgentScope {
  agents: AgentInfo[];
  agentId: string;
  agent: AgentInfo | null;
  defaultId: string;
  isDefault: boolean;
  ready: boolean;
  isGlobal: boolean;
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
  const [listed, setListed] = useState(false);

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

        let saved = "";
        try { saved = window.localStorage.getItem(STORAGE_KEY) ?? ""; } catch { /* 접근 불가면 기본값 */ }
        const valid = saved && list.some((a) => a.id === saved) ? saved : def;
        setAgentIdState(isAgentScopedPath(window.location.pathname) ? valid : def);
      })
      .catch(() => { /* 목록을 못 읽으면 셀렉터 없이 기본 에이전트로 동작 */ })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!isAgentScopedPath(pathname) && defaultIdRef.current && agentIdRef.current !== defaultIdRef.current) {
      setAgentIdState(defaultIdRef.current);
    }
  }, [pathname]);

  const setAgentId = useCallback((id: string) => {
    setAgentIdState(id);
    try { window.localStorage.setItem(STORAGE_KEY, id); } catch { /* 저장 못 해도 이번 세션은 동작 */ }
    if (id !== defaultIdRef.current && !isAgentScopedPath(window.location.pathname)) {
      router.push(AGENT_HOME);
    }
  }, [router]);

  const value = useMemo<AgentScope>(() => {
    const agent = agents.find((a) => a.id === agentId) ?? null;
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
      isDefault: agent ? agent.isDefault : true,
      isGlobal,
      ready,
      scopeWarning,
      setAgentId,
    };
  }, [agents, agentId, defaultId, ready, listed, user, setAgentId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

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
