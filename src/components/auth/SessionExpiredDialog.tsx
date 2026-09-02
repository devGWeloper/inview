"use client";

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
          로그인 후 7일이 지나 세션이 만료됐습니다. 다시 로그인하면 보던 화면으로 돌아옵니다.
        </p>
        <div className="auth-modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>닫기</button>
          <button type="button" className="btn primary" autoFocus onClick={goLogin}>다시 로그인</button>
        </div>
      </div>
    </div>
  );
}
