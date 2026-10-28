// Tells the owner when sign-ins look like an attack, and tells a privileged person when their own account was locked.
// The counters live in this server's memory, which is enough for one Render instance: a restart only forgets the last few minutes.
// shortcut: with more than one server instance each would count separately; move the counters to the database then.
import { sendEmail } from "./email.js";

const WINDOW_MS = 10 * 60 * 1000;
/** Failed sign-ins across all accounts within the window that count as a probe. */
export const BURST_THRESHOLD = 15;
const QUIET_MS = 60 * 60 * 1000;

const failures: number[] = [];
const lastSent = new Map<string, number>();

const owners = () => (process.env.ACCESS_REQUEST_NOTIFY ?? "muslimfroko05@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);

/** At most one message per kind per hour, so an attack cannot also flood the inbox. */
function throttled(kind: string, now: number) {
  if (now - (lastSent.get(kind) ?? 0) < QUIET_MS) return true;
  lastSent.set(kind, now);
  return false;
}

function tellOwners(subject: string, text: string) {
  for (const to of owners()) void sendEmail({ to, subject, text }).catch(() => {});
}

/** Call on every failed password or code. Returns true when this failure tipped the count into an alert. */
export function noteSignInFailure(now = Date.now()): boolean {
  failures.push(now);
  while (failures.length && failures[0] < now - WINDOW_MS) failures.shift();
  if (failures.length < BURST_THRESHOLD || process.env.NODE_ENV === "test" || throttled("burst", now)) return failures.length >= BURST_THRESHOLD;
  tellOwners("HealthFlow: many failed sign-ins", `${failures.length} failed sign-ins in the last ten minutes across all accounts. This can be someone guessing passwords. The rate limits and account lockouts are holding. Look at the Activity screen in the platform console, and change any password you think may be known.`);
  return true;
}

/** A locked account. A locked privileged account (administrator, district officer) is reported to the owner and to the person. */
export function noteLockout(account: { email: string; role: string; privileged: boolean }, minutes: number, now = Date.now()) {
  if (process.env.NODE_ENV === "test") return;
  if (account.privileged && !throttled(`lock:${account.email}`, now)) {
    tellOwners("HealthFlow: an administrator account was locked", `${account.email} (${account.role}) was locked for ${minutes} minutes after repeated wrong passwords or codes.`);
    if (account.email.includes("@")) void sendEmail({ to: account.email, subject: "Your HealthFlow account was locked", text: `Your account was locked for ${minutes} minutes after several wrong passwords or codes. If this was not you, change your password after the lock ends and check your active sessions under Account.` }).catch(() => {});
  }
}

/** For tests. */
export function resetSecurityAlerts() {
  failures.length = 0;
  lastSent.clear();
}
