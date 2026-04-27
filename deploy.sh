#!/bin/bash
# ============================================================
#  deploy.sh — INVIEW 자동 배포 스크립트
#  사용법: ./deploy.sh
# ============================================================

set -e

# ────────────────────────────────────────────────────────────
#  [설정] 아래 값을 환경에 맞게 수정하세요
# ────────────────────────────────────────────────────────────
GIT_REPO_URL="ssh://git@<사내bitbucket주소>/<프로젝트>/inview.git"  # ← git 주소 입력
GIT_BRANCH="main"                                                     # ← 배포할 브랜치
DEPLOY_DIR="/home/idms/inview"                                        # ← 서버 배포 경로
PORT=5174
# ────────────────────────────────────────────────────────────

LOG_FILE="$DEPLOY_DIR/app.log"
PID_FILE="$DEPLOY_DIR/app.pid"
DEPLOY_LOG="$DEPLOY_DIR/deploy.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$DEPLOY_LOG"
}

# ── 1. 서버 중지 ──────────────────────────────────────────
log "▶ 서버 중지 중..."
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  kill "$(cat "$PID_FILE")"
  rm -f "$PID_FILE"
  log "  서버 종료 완료"
else
  log "  실행 중인 서버 없음 (건너뜀)"
fi

# ── 2. 소스코드 갱신 ──────────────────────────────────────
log "▶ 소스코드 갱신 중..."
if [ -d "$DEPLOY_DIR/.git" ]; then
  cd "$DEPLOY_DIR"
  git fetch origin
  git reset --hard "origin/$GIT_BRANCH"
  chmod +x "$DEPLOY_DIR/deploy.sh"
  log "  git pull 완료 ($(git rev-parse --short HEAD))"
else
  log "  저장소 없음 — 최초 clone 진행..."
  mkdir -p "$DEPLOY_DIR"
  cd "$DEPLOY_DIR"
  git init
  git remote add origin "$GIT_REPO_URL"
  git fetch origin
  git reset --hard "origin/$GIT_BRANCH"
  chmod +x "$DEPLOY_DIR/deploy.sh"
  log "  clone 완료 ($(git rev-parse --short HEAD))"
fi

# ── 3. .env 보존 안내 ─────────────────────────────────────
# .env는 git에 포함되지 않으므로 서버에 직접 관리하세요.
# APP_ENV=prd (또는 dev) 와 PRD_*_DB_* 접속 정보가 필요합니다.
# 필요 시 아래 줄 활성화:
# cp /path/to/safe/.env "$DEPLOY_DIR/.env"

if [ ! -f "$DEPLOY_DIR/.env" ]; then
  log "  ⚠  .env 파일이 없습니다. $DEPLOY_DIR/.env 를 생성하세요."
  exit 1
fi

# ── 4. 패키지 설치 ────────────────────────────────────────
log "▶ 패키지 설치 중..."
cd "$DEPLOY_DIR"
npm install --omit=dev --silent
log "  패키지 설치 완료"

# ── 5. 빌드 ───────────────────────────────────────────────
log "▶ Next.js 빌드 중..."
npm run build
log "  빌드 완료"

# ── 6. 서버 기동 ──────────────────────────────────────────
log "▶ 서버 시작 중..."
nohup node_modules/.bin/next start -p $PORT > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
log "  서버 시작 완료 (PID: $(cat "$PID_FILE"), PORT: $PORT)"
log "  로그 확인: tail -f $LOG_FILE"
log "════════════════════════ 배포 완료 ════════════════════════"
