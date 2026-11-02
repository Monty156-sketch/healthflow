// What the clock looks like to the screen, and a small message the clock card sends so the bar on
// every other page changes at once, without waiting for another request.
export interface ClockView {
  linked: boolean;
  enabled?: boolean;
  state?: "IN" | "OUT";
  lastAt?: string | null;
  dutyEndsAt?: string | null;
}

export const CLOCK_EVENT = "healthflow:clock";

export const announceClock = (view: ClockView) => window.dispatchEvent(new CustomEvent<ClockView>(CLOCK_EVENT, { detail: view }));

/** 24-hour time. Ghana is on UTC all year, which is how clock times are shown everywhere else. */
export const clockTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

export const hoursAndMinutes = (fromIso: string, now: number) => {
  const m = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

/** Why the person should clock out now, or null while it is fine. */
export function clockOutReason(v: ClockView, now: number): string | null {
  if (v.state !== "IN" || !v.lastAt) return null;
  if (v.dutyEndsAt && now >= new Date(v.dutyEndsAt).getTime()) return `Your duty ended at ${clockTime(v.dutyEndsAt)}. Clock out now.`;
  if (!v.dutyEndsAt && now - new Date(v.lastAt).getTime() > 14 * 3_600_000) return "You have been clocked in for more than 14 hours. If you have left, clock out now.";
  return null;
}
