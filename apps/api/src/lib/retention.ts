// The retention job. It lists what has passed its approved period and tells
// the facility administrator. It deletes nothing on its own: a person confirms
// each kind, and what was deleted and who confirmed it is written to the audit
// log. The audit log itself is never deleted (the database does not allow it).
import { prisma } from "./prisma.js";
import { writeAuditLog } from "./audit.js";
import { notifyDeciders } from "./notify.js";
import { RETENTION_LABEL } from "../routes/facility/privacy.js";

const monthsAgo = (m: number) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - m);
  return d;
};

type Counter = (facilityId: string, before: Date) => Promise<number>;
type Remover = (facilityId: string, before: Date) => Promise<number>;

/** What the job knows how to remove. Anything else is reported but left for a person to deal with. */
const HANDLERS: Record<string, { count: Counter; remove: Remover }> = {
  Notification: {
    count: (f, b) => prisma.notification.count({ where: { facilityId: f, createdAt: { lt: b } } }),
    remove: async (f, b) => (await prisma.notification.deleteMany({ where: { facilityId: f, createdAt: { lt: b } } })).count,
  },
  Attendance: {
    count: (f, b) => prisma.attendance.count({ where: { facilityId: f, dutyDate: { lt: b } } }),
    remove: async (f, b) => (await prisma.attendance.deleteMany({ where: { facilityId: f, dutyDate: { lt: b } } })).count,
  },
  LeaveRequest: {
    count: (f, b) => prisma.leaveRequest.count({ where: { facilityId: f, endDate: { lt: b }, status: { in: ["APPROVED", "REJECTED", "CANCELLED"] } } }),
    remove: async (f, b) => {
      const ids = (await prisma.leaveRequest.findMany({ where: { facilityId: f, endDate: { lt: b }, status: { in: ["APPROVED", "REJECTED", "CANCELLED"] } }, select: { id: true } })).map((r) => r.id);
      await prisma.dutyLedgerEntry.updateMany({ where: { relatedLeaveRequestId: { in: ids } }, data: { relatedLeaveRequestId: null } });
      return (await prisma.leaveRequest.deleteMany({ where: { id: { in: ids } } })).count;
    },
  },
};

export interface Expired {
  entityType: string;
  label: string;
  months: number;
  cutoff: string;
  count: number;
  removable: boolean;
  note: string | null;
}

export async function expiredFor(facilityId: string): Promise<Expired[]> {
  const policies = await prisma.retentionPolicy.findMany({ where: { facilityId, active: true } });
  const out: Expired[] = [];
  for (const p of policies) {
    const cutoff = monthsAgo(p.retentionMonths);
    const h = HANDLERS[p.entityType];
    if (!h) {
      out.push({ entityType: p.entityType, label: RETENTION_LABEL[p.entityType] ?? p.entityType, months: p.retentionMonths, cutoff: cutoff.toISOString().slice(0, 10), count: 0, removable: false, note: p.entityType === "AuditLog" ? "The audit log cannot be deleted. That is a protection, not an omission." : "This kind is reviewed by hand. The job does not remove it." });
      continue;
    }
    out.push({ entityType: p.entityType, label: RETENTION_LABEL[p.entityType] ?? p.entityType, months: p.retentionMonths, cutoff: cutoff.toISOString().slice(0, 10), count: await h.count(facilityId, cutoff), removable: true, note: null });
  }
  return out;
}

/** The monthly scan. Looks, tells the administrator, deletes nothing. */
export async function runRetentionJob(): Promise<{ facilities: number; notified: number }> {
  const facilities = await prisma.facility.findMany({ where: { active: true }, select: { id: true } });
  let notified = 0;
  for (const f of facilities) {
    const due = (await expiredFor(f.id)).filter((e) => e.removable && e.count > 0);
    if (due.length === 0) continue;
    await notifyDeciders(f.id, {
      type: "retention_due",
      title: "Records have passed their retention period",
      body: `${due.map((d) => `${d.count} ${d.label.toLowerCase()}`).join(", ")}. Nothing is deleted until a facility administrator confirms.`,
      linkUrl: "/privacy-and-data",
      severity: "ACTION",
    });
    notified++;
  }
  return { facilities: facilities.length, notified };
}

/** Deletes one kind, only when a person has confirmed it. */
export async function confirmRetention(facilityId: string, entityType: string, approver: { email: string; displayName: string }): Promise<number> {
  const h = HANDLERS[entityType];
  const policy = await prisma.retentionPolicy.findFirst({ where: { facilityId, entityType, active: true } });
  if (!h || !policy) throw new Error("not_removable");
  const cutoff = monthsAgo(policy.retentionMonths);
  const n = await h.remove(facilityId, cutoff);
  await prisma.retentionPolicy.update({ where: { id: policy.id }, data: { lastRunAt: new Date() } });
  await writeAuditLog({
    facilityId, actorEmail: approver.email, action: "retention_deleted", entityType: "RetentionPolicy", entityId: policy.id,
    summary: `${approver.displayName} confirmed deleting ${n} ${(RETENTION_LABEL[entityType] ?? entityType).toLowerCase()} older than ${cutoff.toISOString().slice(0, 10)}, past the approved ${policy.retentionMonths} months.`,
  });
  return n;
}
