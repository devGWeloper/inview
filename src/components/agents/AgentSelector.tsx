"use client";

import { useEffect, useRef, useState } from "react";
import { useAgentScope } from "./AgentScopeProvider";

export function AgentSelector() {
  const { agents, agentId, agent, setAgentId } = useAgentScope();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (agents.length < 2) return null;

  return (
    <div className="agent-switch" ref={boxRef}>
      <button
        type="button"
        className={"agent-switch-btn" + (open ? " open" : "")}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="에이전트 전환"
      >
        <span className="agent-switch-emoji" aria-hidden>{agent?.avatar ?? "🤖"}</span>
        <span className="agent-switch-name">{agent?.name ?? "에이전트"}</span>
        <span className="agent-switch-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <ul className="agent-switch-menu" role="listbox">
          {agents.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                role="option"
                aria-selected={a.id === agentId}
                className={"agent-switch-item" + (a.id === agentId ? " active" : "")}
                onClick={() => { setAgentId(a.id); setOpen(false); }}
              >
                <span className="agent-switch-emoji" aria-hidden>{a.avatar}</span>
                <span className="agent-switch-label">
                  <span className="agent-switch-name">{a.name}</span>
                  <span className="agent-switch-meta">
                    {a.isDefault ? "전체 화면" : "Tokens · Timeout"}
                    {a.dbConfigured ? "" : " · DB 미구성"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
