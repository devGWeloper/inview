"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Role } from "@/lib/roles";
import { onSessionExpired, resetSessionExpired } from "@/lib/apiClient";
import { SessionExpiredDialog } from "./SessionExpiredDialog";

export interface SessionUser {
  userId: string;
  name: string;
  role: Role;
}

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  /** /api/auth/me 를 다시 읽어 상태 동기화 */
  refresh: () => Promise<SessionUser | null>;
  /** 로그아웃 후 로그인 페이지로 이동 */
  logout: () => Promise<void>;
  /** 로그인 성공 등으로 사용자를 즉시 반영 */
  setUser: (u: SessionUser | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);

  const refresh = useCallback(async (): Promise<SessionUser | null> => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data: { user: SessionUser | null } = await res.json();
      setUser(data.user);
      return data.user;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch { /* ignore */ }
    setUser(null);
    window.location.href = "/login";
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // 열어둔 탭에서 세션이 만료되면(어느 API 든 401) 안내 모달을 띄운다.
  // 화면이 401 응답을 데이터로 오인해 터지는 일을 막는 마지막 장치.
  useEffect(() => onSessionExpired(() => {
    setUser(null);
    setExpired(true);
  }), []);

  const dismissExpired = useCallback(() => {
    setExpired(false);
    resetSessionExpired(); // 이후 401 이 또 오면 다시 안내
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout, setUser }}>
      {children}
      {expired && <SessionExpiredDialog onClose={dismissExpired} />}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
