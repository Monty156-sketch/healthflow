// Which in-app notifications a person can switch off (spec, notification
// preferences). Anything that changes their duties, or that a rule needs them
// to see, is not on this list and always arrives.
export interface NoteCategory {
  key: string;
  label: string;
  description: string;
  types: string[];
}

export const NOTE_CATEGORIES: NoteCategory[] = [
  {
    key: "swaps",
    label: "Duty swaps",
    description: "Someone asks you to swap, answers your request, or a swap is approved, declined or expires.",
    types: ["swap_requested", "swap_responded", "swap_accepted", "swap_cancelled", "swap_decided", "swap_expired"],
  },
  {
    key: "cover",
    label: "Cover",
    description: "You are asked to cover a duty, or cover you arranged is confirmed, moved or unfilled.",
    types: ["cover_asked", "cover_arranged", "cover_confirmed", "cover_moved", "cover_unfilled", "cover_unconfirmed"],
  },
  {
    key: "leave",
    label: "Leave requests and returns",
    description: "A leave request is sent for a decision, or someone is due back from leave.",
    types: ["leave_request_submitted", "return_due"],
  },
];

export const ALWAYS_SENT = [
  "A change to your own duties, such as a duty that has moved or being put back on the roster",
  "Overdue returns from leave, privacy and retention notices, and messages from PS Tech support",
];

const byType = new Map(NOTE_CATEGORIES.flatMap((c) => c.types.map((t) => [t, c.key] as const)));

export const categoryOf = (type: string): string | null => byType.get(type) ?? null;

/** The category keys a person has switched off. */
export function mutedFrom(prefs: unknown): string[] {
  const muted = (prefs as { muted?: unknown } | null)?.muted;
  return Array.isArray(muted) ? muted.filter((m): m is string => typeof m === "string" && NOTE_CATEGORIES.some((c) => c.key === m)) : [];
}
