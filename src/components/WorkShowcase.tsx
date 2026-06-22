import { AgentProfile, WorkTask } from "@/lib/types";

function TaskCard({ task }: { task: WorkTask }) {
  return (
    <li className="work-task">
      <span className="work-task-icon" aria-hidden>{task.icon}</span>
      <div className="work-task-body">
        <div className="work-task-title">{task.title}</div>
        <div className="work-task-desc">{task.desc}</div>
      </div>
      {task.metric && <span className="work-task-metric">{task.metric}</span>}
    </li>
  );
}

/**
 * 이억수 TL 이 하는 일 — 정형/비정형 구분 없이 하나로 통합해 보여주는 영역.
 * (데이터 모델은 formalTasks/informalTasks 로 나뉘어 있지만 표시할 때 합친다.)
 */
export function WorkShowcase({ profile }: { profile: AgentProfile }) {
  const tasks: WorkTask[] = [...profile.formalTasks, ...profile.informalTasks];

  return (
    <section className="work-showcase">
      <header className="work-showcase-head">
        <div className="work-showcase-titles">
          <span className="work-showcase-title">{profile.name}이 하는 일</span>
        </div>
        <div className="work-showcase-aux">
          <span className="work-showcase-count">{tasks.length}</span>
          <span className="work-showcase-count-label">개 업무</span>
        </div>
      </header>

      <p className="work-showcase-statement">
        <span className="line">
          엔지니어링 영역에서 필요로 하는 <strong>모든 업무</strong>를
        </span>
        <span className="line">
          <em>AI Agent 기반 E2E 레벨</em>로 통합하여 <strong className="accent">Full-Auto</strong> 실현
        </span>
      </p>

      <ul className="work-task-grid">
        {tasks.length === 0
          ? <li className="work-task-empty">등록된 업무가 없습니다. ADMIN에서 추가하세요.</li>
          : tasks.map((t, i) => <TaskCard key={i} task={t} />)}
      </ul>
    </section>
  );
}
