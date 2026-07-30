// ─────────────────────────────────────────────────────────────────────────────
// 클라이언트 공용 API 호출 헬퍼.
//
// 왜 필요한가 (세션 만료 크래시):
//   세션은 7일(SESSION_TTL_SEC)이라 화면을 오래 열어두면 언젠가 만료된다.
//   페이지 '이동' 은 미들웨어가 /login 으로 리다이렉트해 주지만, **이미 떠 있는
//   탭에서 쏘는 fetch 는 리다이렉트가 아니라 401 JSON({error})** 을 받는다.
//   각 화면이 res.ok 를 보지 않고 곧장 `await res.json()` 결과를 상태에 넣으면
//   기대한 배열이 undefined 가 되어 렌더에서 터졌다
//   (예: Traces 화면의 `summaries.filter(...)` → TypeError).
//
// 규칙:
//   - 모든 /api 호출은 apiFetch / apiJson 을 쓴다. 원시 fetch 를 쓰지 말 것.
//   - 401 → 전역 '세션 만료' 이벤트를 쏘고 ApiError 를 던진다.
//     (AuthProvider 가 받아 재로그인 안내 모달을 띄운다 → SessionExpiredDialog)
//   - 그 외 실패도 서버의 error 메시지를 담은 ApiError 로 통일한다.
//   - 응답 배열은 asArray() 로 감싸 렌더가 절대 undefined 를 만지지 않게 한다.
// ─────────────────────────────────────────────────────────────────────────────

export const SESSION_EXPIRED_MSG = "세션이 만료되었습니다. 다시 로그인해 주세요.";
export const FORBIDDEN_MSG = "접근 권한이 없습니다.";

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
  /** 인증/인가 실패 (재로그인 또는 권한 문제) */
  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

// ── 전역 '세션 만료' 신호 ────────────────────────────────────────────────────
type Listener = () => void;
const listeners = new Set<Listener>();
let expired = false;

/** 세션 만료 구독. 반환값을 호출하면 구독 해제. */
export function onSessionExpired(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** 안내를 닫았을 때 호출 — 이후 401 이 또 오면 다시 알린다. */
export function resetSessionExpired(): void {
  expired = false;
}

function markExpired(): void {
  if (expired) return; // 동시에 여러 요청이 401 이어도 안내는 한 번만
  expired = true;
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* 리스너 하나가 실패해도 나머지는 알린다 */
    }
  });
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

// 로그인 API 의 401 은 '비밀번호 오류' 이지 세션 만료가 아니다 — 제외.
function isLoginCall(input: RequestInfo | URL): boolean {
  return urlOf(input).includes("/api/auth/login");
}

// ── fetch 래퍼 ───────────────────────────────────────────────────────────────

/** fetch + 401 감지. 응답 자체가 필요할 때(직접 상태코드 분기) 사용. */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401 && !isLoginCall(input)) markExpired();
  return res;
}

async function errorFrom(res: Response): Promise<ApiError> {
  let msg = "";
  try {
    const d: unknown = await res.json();
    if (d && typeof d === "object" && typeof (d as { error?: unknown }).error === "string") {
      msg = (d as { error: string }).error;
    }
  } catch {
    /* JSON 이 아닌 응답(HTML 에러 페이지 등) — 아래 기본 문구 사용 */
  }
  if (res.status === 401) msg = SESSION_EXPIRED_MSG; // 서버 문구보다 행동 안내가 명확
  else if (res.status === 403) msg = msg || FORBIDDEN_MSG;
  return new ApiError(msg || `요청에 실패했습니다 (HTTP ${res.status})`, res.status);
}

/** fetch + 상태코드 검사 + JSON 파싱. 실패는 전부 ApiError 로 던진다. */
export async function apiJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await apiFetch(input, init);
  if (!res.ok) throw await errorFrom(res);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError("응답을 해석할 수 없습니다.", res.status);
  }
}

// ── 방어적 읽기 ──────────────────────────────────────────────────────────────

/** 배열이 아니면 빈 배열. 렌더가 undefined.filter/map 으로 터지는 걸 원천 차단. */
export function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** 실패 사유를 사람이 읽는 한 줄로. */
export function errMessage(e: unknown, fallback = "요청에 실패했습니다."): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message || fallback;
  return fallback;
}
