"use client";

/**
 * 세션 만료 안내 모달.
 *
 * 화면을 열어둔 채 세션(12h)이 만료되면 API 가 401 을 준다. 예전엔 그 401 응답이
 * 그대로 데이터로 취급돼 화면이 JS 오류로 죽었다 — 지금은 apiClient 가 401 을
 * 잡아 이 안내를 띄우고, 원래 보던 경로(next)로 돌아오는 로그인 링크를 준다.
 */
export function SessionExpiredDialog({ onClose }: { onClose: () => void }) {
  const goLogin = () => {
    const next = window.location.pathname + window.location.search;
    window.location.href = `/login?next=${encodeURIComponent(next)}`;
  };

  return (
    <div className="auth-modal-backdrop">
      <div className="auth-modal" role="alertdialog" aria-modal="true" aria-labelledby="sess-exp-title">
        <div className="auth-modal-head">
          <div className="auth-modal-title" id="sess-exp-title">세션이 만료되었습니다</div>
        </div>
        <p className="auth-modal-note">
          로그인 후 12시간이 지나 세션이 만료됐습니다. 다시 로그인하면 보던 화면으로 돌아옵니다.
        </p>
        <div className="auth-modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>닫기</button>
          <button type="button" className="btn primary" autoFocus onClick={goLogin}>다시 로그인</button>
        </div>
      </div>
    </div>
  );
}
