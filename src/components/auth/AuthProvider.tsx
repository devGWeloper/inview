"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Role } from "@/lib/roles";
import { onSessionExpired, resetSessionExpired } from "@/lib/apiClient";
import { SessionExpiredDialog } from "./SessionExpiredDialog";

export interface SessionUser {
  userId: string;
  name: string;
  role: Role;
  agentId?: string | null;
  global?: boolean;
}

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<SessionUser | null>;
  logout: () => Promise<void>;
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
