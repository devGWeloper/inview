"use client";

export function ViewToggle({
  live, onChange, pulsing,
}: {
  live: boolean;
  onChange: (live: boolean) => void;
  pulsing?: boolean;
}) {
  return (
    <div
      className={"view-toggle" + (live ? " is-live" : "")}
      role="tablist"
      aria-label="보기 전환"
    >
      {/* 미끄러지는 배경. 버튼 뒤에 깔리므로 클릭을 가로채지 않는다. */}
      <span className="view-toggle-thumb" aria-hidden="true" />
      <button
        type="button"
        role="tab"
        aria-selected={!live}
        className={"view-toggle-btn" + (live ? "" : " active")}
        onClick={() => onChange(false)}
      >
        집계
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={live}
        className={"view-toggle-btn live" + (live ? " active" : "")}
        onClick={() => onChange(true)}
      >
        <span className={"live-dot" + (live && pulsing ? " pulse" : "")} aria-hidden="true" />
        틱
      </button>
    </div>
  );
}
