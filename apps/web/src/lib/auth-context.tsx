"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, setAccessToken } from "./api";

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  scopeType: string;
  facilityId: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string, mfa?: { totp?: string; recoveryCode?: string }) => Promise<{ mfaRequired: boolean }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // A page refresh loses the in-memory access token by design (see
    // lib/api.ts); this silently restores it from the httpOnly refresh
    // cookie if the 30-minute idle session hasn't lapsed.
    api.refreshOnLoad().finally(() => setLoading(false));
  }, []);

  async function login(
    email: string,
    password: string,
    mfa?: { totp?: string; recoveryCode?: string }
  ) {
    const res = await api.post<
      { mfaRequired: true } | { accessToken: string; user: AuthUser }
    >("/api/auth/login", { email, password, ...mfa });

    if ("mfaRequired" in res) return { mfaRequired: true };

    setAccessToken(res.accessToken);
    setUser(res.user);
    return { mfaRequired: false };
  }

  async function logout() {
    await api.post("/api/auth/logout");
    setAccessToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
