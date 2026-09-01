"use client";

// 대시보드 계열 화면의 뷰 전환 — "집계" ↔ "틱".
//
// ⚠️ 워딩은 증권 차트 탭(`틱 · 1분 · 일 · 주 · 월`)에서 가져왔다. 처음엔 "실시간" 이었는데
//    물렀다 — 이 뷰는 직접 설정으로 과거 구간도 보고 자동 갱신도 기본이 꺼져 있어
//    최신성을 주장하는 말이 맞지 않았다. 실제로 갈리는 건 **집계 단위**다: 왼쪽은
//    5분/1시간/1일로 묶어 보고, 오른쪽은 분 격자로 순간을 본다.
//    (엄밀히는 체결 단위 '틱' 이 아니라 롤링 60초지만, 팀이 이미 1TICK 이라 부른다.)
//
// ⚠️ 예전에는 틱 진입이 기간 프리셋 줄 **안의** `1TICK` 버튼이었다. 그 줄의 다른
//    버튼은 전부 "조회 기간" 인데 이것만 화면을 통째로 바꿔서, 기간을 고른 줄 알고
//    누른 뒤 화면이 달라지는 일이 생겼다. 성격이 다른 조작이므로 줄 밖으로 뺀다.
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
    <div className="view-toggle" role="tablist" aria-label="보기 전환">
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
