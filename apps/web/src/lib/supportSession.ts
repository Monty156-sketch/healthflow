// The support session this browser tab is acting inside, if any. Kept in
// sessionStorage so it ends with the tab and is never shared between tabs.

export interface ActiveSupport {
  id: string;
  facility: string;
  level: "READ_ONLY" | "FULL";
  expiresAt: string;
}

const KEY = "hf_support_session";

export function getSupport(): ActiveSupport | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as ActiveSupport;
    return new Date(s.expiresAt).getTime() > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function setSupport(s: ActiveSupport | null) {
  try {
    if (s) window.sessionStorage.setItem(KEY, JSON.stringify(s));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked: support entry simply does not persist */
  }
}
