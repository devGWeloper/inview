"use client";

// 대시보드 계열 화면의 뷰 전환 — "기간 분석" ↔ "실시간".
//
// ⚠️ 예전에는 실시간 진입이 기간 프리셋 줄 **안의** `1TICK` 버튼이었다. 그 줄의 다른
//    버튼은 전부 "조회 기간" 인데 이것만 화면을 통째로 바꿔서, 기간을 고른 줄 알고
//    누른 뒤 화면이 달라지는 일이 생겼다. 성격이 다른 조작이므로 줄 밖으로 뺀다.
//
// 실시간 쪽 점(dot)은 **자동 갱신이 도는 동안에만** 깜빡인다 — 지금 살아 있는 값인지
// 멈춘 값인지를 글자 없이 알리기 위한 것이다(문구로 설명하지 않는다).

export function ViewToggle({
  live, onChange, pulsing,
}: {
  /** 현재 실시간 뷰인가 */
  live: boolean;
  onChange: (live: boolean) => void;
  /** 자동 갱신이 실제로 돌고 있는가 (점 깜빡임) */
  pulsing?: boolean;
}) {
  return (
    <div className="view-toggle" role="tablist" aria-label="보기 전환">
      <button
        type="button"
        role="tab"
        aria-selected={!live}
        className={"view-toggle-btn" + (live ? "" : " active")}
        onClick={() => onChange(false)}
      >
        기간 분석
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={live}
        className={"view-toggle-btn live" + (live ? " active" : "")}
        onClick={() => onChange(true)}
      >
        <span className={"live-dot" + (live && pulsing ? " pulse" : "")} aria-hidden="true" />
        실시간
      </button>
    </div>
  );
}
