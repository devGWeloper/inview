
// 클라이언트의 유일한 /api 호출 경로. 원시 fetch + res.json() 은 세션 만료 401 을
// 데이터로 둔갑시켜 렌더에서 죽는다. docs/architecture/ui-conventions.md

export const SESSION_EXPIRED_MSG = "세션이 만료되었습니다. 다시 로그인해 주세요.";
export const FORBIDDEN_MSG = "접근 권한이 없습니다.";

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();
let expired = false;

export function onSessionExpired(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

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
    }
  });
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function isLoginCall(input: RequestInfo | URL): boolean {
  return urlOf(input).includes("/api/auth/login");
}

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
  }
  if (res.status === 401) msg = SESSION_EXPIRED_MSG; // 서버 문구보다 행동 안내가 명확
  else if (res.status === 403) msg = msg || FORBIDDEN_MSG;
  return new ApiError(msg || `요청에 실패했습니다 (HTTP ${res.status})`, res.status);
}

export async function apiJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await apiFetch(input, init);
  if (!res.ok) throw await errorFrom(res);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError("응답을 해석할 수 없습니다.", res.status);
  }
}

export function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function errMessage(e: unknown, fallback = "요청에 실패했습니다."): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message || fallback;
  return fallback;
}
