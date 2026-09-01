"use client";

// 대시보드 계열 화면의 뷰 전환 — "집계" ↔ "틱".
//
// ⚠️ 워딩은 증권 차트 탭(`틱 · 1분 · 일 · 주 · 월`)에서 가져왔다. 처음엔 "실시간" 이었는데
//    물렀다 — 이 뷰는 직접 설정으로 과거 구간도 보고 자동 갱신도 기본이 꺼져 있어
//    최신성을 주장하는 말이 맞지 않았다. 실제로 갈리는 건 **집계 단위**다: 왼쪽은
//    5분/1시간/1일로 묶어 보고, 오른쪽은 분 격자로 순간을 본다.
//    (엄밀히는 체결 단위 '틱' 이 아니라 롤링 60초지만, 팀이 이미 1TICK 이라 부른다.)
//
// ⚠️ 자리는 **머리말 우상단**이다 (`.dash-head-row`). 예전에는 기간 프리셋 줄 안의
//    `1TICK` 버튼이었다가 → 줄 밖 첫 칸으로 옮겼는데, 조회 줄이 한 줄에 안 들어가는
//    화면에서는 이 토글만 위로 튀어 올라 줄이 깨져 보였다. 조회 조건과 아예 다른 줄에
//    두면 폭이 어떻든 자리가 흔들리지 않는다.
//
// ⚠️ 버튼 두 개가 아니라 **thumb 이 미끄러지는 스위치**로 그린다 — 두 칸이 같은 폭이라
//    글자 수(집계 2자 / 틱 1자)에 상관없이 thumb 이 정확히 절반을 덮는다. 칸 폭을
//    내용에 맡기면(inline-flex) 토글할 때마다 thumb 폭이 달라져 미끄러지지 않는다.
//
// 틱 쪽 점(dot)은 **자동 갱신이 도는 동안에만** 깜빡인다 — 지금 살아 있는 값인지
// 멈춘 값인지를 글자 없이 알리기 위한 것이다(문구로 설명하지 않는다).

export function ViewToggle({
  live, onChange, pulsing,
}: {
  /** 현재 틱 뷰인가 */
  live: boolean;
  onChange: (live: boolean) => void;
  /** 자동 갱신이 실제로 돌고 있는가 (점 깜빡임) */
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
