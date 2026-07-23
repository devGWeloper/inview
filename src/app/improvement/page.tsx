"use client";

import { useState } from "react";
import Link from "next/link";
import { RequestFailureTracker } from "@/components/improvement/RequestFailureTracker";

// TraceX > Improvement Center — AI 에이전트 개선 허브(확장 가능한 플랫폼).
// 개선 도구를 "모듈"로 담는 셸. 지금은 Request Failure Tracker 하나이며,
// 새 모듈은 아래 MODULES 배열에 { key, name, tagline, icon, Component } 한 줄을
// 추가하면 좌측 레일에 붙는다. (PLANNED 는 로드맵 표시용 — 아직 클릭 불가)

interface ImprovementModule {
  key: string;
  name: string;
  tagline: string;
  icon: string;
  Component: React.ComponentType;
}

const MODULES: ImprovementModule[] = [
  {
    key: "request-failure",
    name: "Request Failure Tracker",
    tagline: "처리 실패한 요청을 추적·정정",
    icon: "🛠️",
    Component: RequestFailureTracker,
  },
];

// 플랫폼 지향을 드러내는 로드맵(예정) 항목 — 실제 기능 아님, 확장 자리 표시.
const PLANNED: { name: string; tagline: string; icon: string }[] = [
  { name: "Prompt Insights", tagline: "실패 패턴에서 프롬프트 개선점 도출", icon: "✨" },
  { name: "Knowledge Gaps", tagline: "반복 실패 주제의 지식 보강", icon: "📚" },
];

// 접근 제어는 미들웨어(BR 이상)가 담당한다.
export default function ImprovementPage() {
  return <ImprovementCenter />;
}

function ImprovementCenter() {
  const [active, setActive] = useState<string>(MODULES[0].key);
  const current = MODULES.find((m) => m.key === active) ?? MODULES[0];
  const Current = current.Component;

  return (
    <div className="ic-page">
      <header className="ic-head">
        <div className="ic-head-main">
          <div className="ic-crumb">
            <span className="ic-crumb-app">TraceX</span>
            <span className="ic-crumb-sep">›</span>
            <span className="ic-crumb-cur">Improvement Center</span>
          </div>
          <h1 className="ic-title">
            <span className="ic-title-ico" aria-hidden>🚀</span>
            Improvement Center
          </h1>
          <p className="ic-tagline">
            에이전트가 놓친 것을 찾아 <b>개선으로 잇는</b> 허브. 지금은 처리 실패 요청을 추적·정정합니다.
          </p>
        </div>
        <Link href="/admin" className="btn ghost" prefetch={false}>← 관리자</Link>
      </header>

      <div className="ic-body">
        <aside className="ic-rail" aria-label="개선 모듈">
          <div className="ic-rail-label">모듈</div>
          {MODULES.map((m) => (
            <button
              key={m.key}
              type="button"
              className={"ic-mod" + (active === m.key ? " active" : "")}
              onClick={() => setActive(m.key)}
            >
              <span className="ic-mod-ico" aria-hidden>{m.icon}</span>
              <span className="ic-mod-text">
                <span className="ic-mod-name">{m.name}</span>
                <span className="ic-mod-tag">{m.tagline}</span>
              </span>
              <span className="ic-mod-live" aria-label="사용 가능">●</span>
            </button>
          ))}

          <div className="ic-rail-label soon">예정</div>
          {PLANNED.map((p) => (
            <div key={p.name} className="ic-mod planned" aria-disabled>
              <span className="ic-mod-ico" aria-hidden>{p.icon}</span>
              <span className="ic-mod-text">
                <span className="ic-mod-name">{p.name}</span>
                <span className="ic-mod-tag">{p.tagline}</span>
              </span>
              <span className="ic-mod-soon">준비중</span>
            </div>
          ))}
        </aside>

        <main className="ic-main">
          <div className="ic-main-head">
            <span className="ic-main-ico" aria-hidden>{current.icon}</span>
            <div>
              <div className="ic-main-name">{current.name}</div>
              <div className="ic-main-tag">{current.tagline}</div>
            </div>
          </div>
          <Current />
        </main>
      </div>
    </div>
  );
}
