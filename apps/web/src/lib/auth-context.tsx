"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import { SESSION_IDLE_TIMEOUT_MINUTES } from "@healthflow/shared";
import { api, setAccessToken, setOnSessionExpired, type Session, type SessionUser } from "./api";

export type AuthUser = SessionUser;

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (
    email: string,
    password: string,
    mfa?: { totp?: string; recoveryCode?: string },
    audience?: "facility" | "district" | "platform"
  ) => Promise<{ mfaRequired: boolean }>;
  logout: () => Promise<void>;
  adoptSession: (session: Session) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const IDLE_LIMIT_MS = SESSION_IDLE_TIMEOUT_MINUTES * 60 * 1000;
// Renew well inside the 15-minute access token and the server's 30-minute
// idle window, but only when the person has actually done something.
const KEEPALIVE_EVERY_MS = 10 * 60 * 1000;
const CHECK_EVERY_MS = 30 * 1000;

// Shared between tabs, so working in one tab keeps the others signed in.
const ACTIVITY_KEY = "hf:lastActivity";

function readSharedActivity(): number {
  try {
    return Number(localStorage.getItem(ACTIVITY_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeSharedActivity(at: number) {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(at));
  } catch {
    // Private mode or blocked storage: this tab still tracks its own activity.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Set for real at sign-in and on session restore.
  const lastActivity = useRef(0);
  const lastRenewal = useRef(0);
  const inFlight = useRef<Promise<Session | null> | null>(null);
  const ending = useRef(false);
  const roleRef = useRef<string | null>(null);

  // One refresh at a time. Each refresh rotates the session cookie, so two
  // running at once would make the second use an already-retired cookie.
  const renew = useCallback(() => {
    if (!inFlight.current) {
      inFlight.current = api.refreshSession().finally(() => {
        inFlight.current = null;
      });
    }
    return inFlight.current;
  }, []);

  // A full page load, not a client-side route change: it discards everything
  // the signed-in page held in memory, and nothing else on the page can race
  // it with its own redirect (which would drop the ?reason message).
  const endSession = useCallback((reason: "idle" | "expired" | "signed_out") => {
    setAccessToken(null);
    // Back to the page this kind of account signs in on.
    const door = roleRef.current === "PLATFORM_ADMIN" ? "/platform/login" : roleRef.current === "DISTRICT_OFFICER" ? "/district/login" : "/login";
    window.location.replace(reason === "signed_out" ? door : `${door}?reason=${reason}`);
  }, []);

  useEffect(() => {
    if (user) roleRef.current = user.role;
  }, [user]);

  // Restore the session after a page load or refresh.
  useEffect(() => {
    let cancelled = false;
    renew().then((session) => {
      if (cancelled) return;
      if (session) {
        ending.current = false;
        setUser(session.user);
        lastActivity.current = Date.now();
        lastRenewal.current = Date.now();
        writeSharedActivity(lastActivity.current);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [renew]);

  // The server ended the session (idle, deactivated, signed out elsewhere).
  useEffect(() => {
    setOnSessionExpired(() => endSession("expired"));
    return () => setOnSessionExpired(null);
  }, [endSession]);

  // Track activity and enforce the idle limit while signed in.
  useEffect(() => {
    if (!user) return;

    let lastWrite = 0;
    const markActive = () => {
      const now = Date.now();
      lastActivity.current = now;
      if (now - lastWrite > 5000) {
        lastWrite = now;
        writeSharedActivity(now);
      }
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart", "mousemove"] as const;
    events.forEach((e) => window.addEventListener(e, markActive, { passive: true }));

    const timer = window.setInterval(async () => {
      const now = Date.now();
      const latest = Math.max(lastActivity.current, readSharedActivity());

      if (now - latest >= IDLE_LIMIT_MS) {
        if (ending.current) return;
        ending.current = true;
        await api.post("/api/auth/logout").catch(() => undefined);
        endSession("idle");
        return;
      }

      if (latest > lastRenewal.current && now - lastRenewal.current >= KEEPALIVE_EVERY_MS) {
        const session = await renew();
        if (session) {
          lastRenewal.current = Date.now();
        } else {
          endSession("expired");
        }
      }
    }, CHECK_EVERY_MS);

    return () => {
      events.forEach((e) => window.removeEventListener(e, markActive));
      window.clearInterval(timer);
    };
  }, [user, renew, endSession]);

  async function login(
    email: string,
    password: string,
    mfa?: { totp?: string; recoveryCode?: string },
    audience?: "facility" | "district" | "platform"
  ) {
    const res = await api.post<{ mfaRequired: true } | Session>("/api/auth/login", {
      email,
      password,
      ...mfa,
      ...(audience ? { audience } : {}),
    });

    if ("mfaRequired" in res) return { mfaRequired: true };
    adoptSession(res);
    return { mfaRequired: false };
  }

  /** Starts using a session the server just issued (sign-in, or sign-in after setup). */
  function adoptSession(session: Session) {
    setAccessToken(session.accessToken);
    ending.current = false;
    lastActivity.current = Date.now();
    lastRenewal.current = Date.now();
    writeSharedActivity(lastActivity.current);
    setUser(session.user);
  }

  async function logout() {
    await api.post("/api/auth/logout").catch(() => undefined);
    endSession("signed_out");
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, adoptSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
