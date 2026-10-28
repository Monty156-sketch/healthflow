// The scheduler. A single timer inside the API wakes every minute and runs
// whichever jobs are due, recording each run in JobRun so the console can show
// what ran, what failed and what is late. HealthFlow runs as one API instance;
// the keep-awake workflow stops the free host from sleeping through a run.
// A job that is already recorded as started within its interval is not
// started again, so a restart does not repeat work.
import { prisma } from "./prisma.js";
import { runRetentionJob } from "./retention.js";
import { closeExpiredSessions } from "../routes/platformSupport.js";
import { markOverdue } from "../routes/platformBilling.js";
import { runAccessJob } from "./access.js";
import { applyDueTransfers } from "../routes/facility/transfers.js";
import { runCredentialReminders } from "./credentials.js";

const MIN = 60_000;
const HOUR = 60 * MIN;

export interface Job {
  name: string;
  label: string;
  everyMs: number;
  run: () => Promise<string>;
}

export const JOBS: Job[] = [
  { name: "support-expiry", label: "End expired support sessions", everyMs: 5 * MIN, run: async () => { await closeExpiredSessions(); return "Checked."; } },
  { name: "overdue-invoices", label: "Mark overdue invoices", everyMs: 6 * HOUR, run: async () => `${await markOverdue()} invoice(s) marked overdue.` },
  { name: "access-and-reminders", label: "Lock unpaid facilities and send payment reminders", everyMs: HOUR, run: async () => { const r = await runAccessJob(); return `${r.lapsed} locked, ${r.reminded} reminded.`; } },
  { name: "ward-transfers", label: "Move staff whose ward transfer is due", everyMs: 30 * MIN, run: async () => `${await applyDueTransfers()} transfer(s) done.` },
  { name: "credential-reminders", label: "Remind staff whose licences are nearing their date", everyMs: 24 * HOUR, run: async () => `${await runCredentialReminders()} reminder(s) sent.` },
  { name: "handover-cleanup", label: "Delete handover notes older than 90 days", everyMs: 24 * HOUR, run: async () => { const old = { lt: new Date(Date.now() - 90 * 86_400_000) }; const notes = await prisma.handoverNote.deleteMany({ where: { createdAt: old } }); return `${notes.count} note(s) removed.`; } },
  { name: "retention-scan", label: "Retention scan", everyMs: 24 * HOUR, run: async () => JSON.stringify(await runRetentionJob()).slice(0, 500) },
  { name: "sms-log-cleanup", label: "Delete text message records older than 90 days", everyMs: 24 * HOUR, run: async () => `${(await prisma.smsMessage.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 90 * 86_400_000) } } })).count} record(s) removed.` },
];

/** Runs one job now and records it. Never throws. */
export async function runJob(job: Job): Promise<boolean> {
  const row = await prisma.jobRun.create({ data: { name: job.name } });
  try {
    const detail = await job.run();
    await prisma.jobRun.update({ where: { id: row.id }, data: { finishedAt: new Date(), ok: true, detail } });
    return true;
  } catch (e) {
    await prisma.jobRun.update({ where: { id: row.id }, data: { finishedAt: new Date(), ok: false, detail: (e instanceof Error ? e.message : String(e)).slice(0, 500) } }).catch(() => undefined);
    return false;
  }
}

/** Runs every job whose interval has passed since it last started. */
export async function tick(now = new Date()): Promise<string[]> {
  const ran: string[] = [];
  for (const job of JOBS) {
    const last = await prisma.jobRun.findFirst({ where: { name: job.name }, orderBy: { startedAt: "desc" }, select: { startedAt: true } });
    if (last && now.getTime() - last.startedAt.getTime() < job.everyMs) continue;
    await runJob(job);
    ran.push(job.name);
  }
  return ran;
}

let timer: NodeJS.Timeout | undefined;

export function startScheduler() {
  if (timer || process.env.NODE_ENV === "test" || process.env.SCHEDULER === "off") return;
  const go = () => tick().catch((e) => console.error("scheduler tick failed", e));
  setTimeout(go, 20_000);
  timer = setInterval(go, MIN);
  timer.unref();
}

/** For the health page: the last run of each job and whether it is late. */
export async function jobStatus(now = new Date()) {
  return Promise.all(
    JOBS.map(async (j) => {
      const [last, lastOk, failed] = await Promise.all([
        prisma.jobRun.findFirst({ where: { name: j.name }, orderBy: { startedAt: "desc" } }),
        prisma.jobRun.findFirst({ where: { name: j.name, ok: true }, orderBy: { startedAt: "desc" } }),
        prisma.jobRun.count({ where: { name: j.name, ok: false, startedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } } }),
      ]);
      const late = !lastOk || now.getTime() - lastOk.startedAt.getTime() > j.everyMs * 2 + 10 * MIN;
      return { name: j.name, label: j.label, everyMinutes: Math.round(j.everyMs / MIN), lastRunAt: last?.startedAt ?? null, lastOk: last?.ok ?? null, lastDetail: last?.detail ?? null, failedLast7Days: failed, late };
    })
  );
}
