// A thin fetch wrapper. The access token lives in a module-level variable,
// not localStorage — it never survives a hard refresh, which is deliberate
// (see the Security architecture section of the build plan): a script
// injected by any means has nothing to steal. A silent refresh against the
// httpOnly refresh cookie restores it on load.

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

// Same origin on purpose: /api/* is forwarded to the Express API by
// src/app/api/[...path]/route.ts, which keeps the session cookie first-party.
const API_BASE = "";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : "api_error");
    this.status = status;
    this.body = body;
  }
}

const NO_REFRESH = [
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/auth/logout",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/mfa/enrol",
];

async function request<T>(
  path: string,
  options: RequestInit = {},
  retry = true
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include", // sends the httpOnly refresh cookie
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  });

  // A 401 on a normal call means the 15-minute access token ran out: get a
  // new one from the session cookie and retry once. The sign-in endpoints
  // answer 401 for wrong credentials, which a refresh cannot fix.
  if (res.status === 401 && retry && !NO_REFRESH.some((p) => path.startsWith(p))) {
    const session = await refreshSession();
    if (session) return request<T>(path, options, false);
    onSessionExpired?.();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

/** Fetches a file with the signed-in session and hands it to the browser as a download. */
async function download(path: string, fallbackName: string, retry = true): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (res.status === 401 && retry) {
    if (await refreshSession()) return download(path, fallbackName, false);
    onSessionExpired?.();
  }
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface SessionUser {
  id: string;
  email: string;
  role: string;
  scopeType: string;
  facilityId: string | null;
}

export interface Session {
  accessToken: string;
  user: SessionUser;
}

// Lets the auth context hear about a session the server has ended (idle
// timeout, deactivation, sign-out elsewhere) so it can return to login.
let onSessionExpired: (() => void) | null = null;
export function setOnSessionExpired(handler: (() => void) | null) {
  onSessionExpired = handler;
}

/**
 * Trades the httpOnly session cookie for a fresh access token and the
 * signed-in user. Returns null when there is no live session.
 */
async function refreshSession(): Promise<Session | null> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Session;
    setAccessToken(data.accessToken);
    return data;
  } catch {
    return null;
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  download,
  refreshSession,
};
