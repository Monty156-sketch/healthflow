// Tells the owner when sign-ins look like an attack, and tells a privileged person when their own account was locked.
// The counts live in the database (SecurityEvent), so a restart forgets nothing and several API servers agree.
import { prisma } from "./prisma.js";
import { sendEmail } from "./email.js";

const WINDOW_MS = 10 * 60 * 1000;
/** Failed sign-ins across all accounts within the window that count as a probe. */
export const BURST_THRESHOLD = 15;
const QUIET_MS = 60 * 60 * 1000;

const owners = () => (process.env.ACCESS_REQUEST_NOTIFY ?? "muslimfroko05@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);

/** At most one message per kind per hour, so an attack cannot also flood the inbox. The check and the mark are one write-after-read; a rare double send is harmless. */
async function throttled(kind: string, key: string | null, now: number) {
  const recent = await prisma.securityEvent.findFirst({ where: { kind, key, createdAt: { gt: new Date(now - QUIET_MS) } }, select: { id: true } });
  if (recent) return true;
  await prisma.securityEvent.create({ data: { kind, key, createdAt: new Date(now) } });
  return false;
}

function tellOwners(subject: string, text: string) {
  for (const to of owners()) void sendEmail({ to, subject, text }).catch(() => {});
}

/** Call on every failed password or code. Resolves true when this failure tipped the count into an alert. Never throws. */
export async function noteSignInFailure(now = Date.now()): Promise<boolean> {
  try {
    await prisma.securityEvent.create({ data: { kind: "failed_signin", createdAt: new Date(now) } });
    const count = await prisma.securityEvent.count({ where: { kind: "failed_signin", createdAt: { gt: new Date(now - WINDOW_MS) } } });
    // Tidy: nothing older than two hours is needed.
    await prisma.securityEvent.deleteMany({ where: { createdAt: { lt: new Date(now - 2 * QUIET_MS) } } });
    if (count < BURST_THRESHOLD) return false;
    if (process.env.NODE_ENV === "test" || (await throttled("alert_burst", null, now))) return true;
    tellOwners("HealthFlow: many failed sign-ins", `${count} failed sign-ins in the last ten minutes across all accounts. This can be someone guessing passwords. The rate limits and account lockouts are holding. Look at the Activity screen in the platform console, and change any password you think may be known.`);
    return true;
  } catch {
    return false;
  }
}

/** A locked account. A locked privileged account (administrator, district officer) is reported to the owner and to the person. */
export async function noteLockout(account: { email: string; role: string; privileged: boolean }, minutes: number, now = Date.now()) {
  if (process.env.NODE_ENV === "test") return;
  try {
    if (account.privileged && !(await throttled("alert_lock", account.email, now))) {
      tellOwners("HealthFlow: an administrator account was locked", `${account.email} (${account.role}) was locked for ${minutes} minutes after repeated wrong passwords or codes.`);
      if (account.email.includes("@")) void sendEmail({ to: account.email, subject: "Your HealthFlow account was locked", text: `Your account was locked for ${minutes} minutes after several wrong passwords or codes. If this was not you, change your password after the lock ends and check your active sessions under Account.` }).catch(() => {});
    }
  } catch {
    // The watch must never get in the way of signing in.
  }
}
