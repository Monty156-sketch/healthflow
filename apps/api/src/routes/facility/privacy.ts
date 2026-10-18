// Privacy foundation (Part 3, 0.5): the facility's privacy notice, with
// every published version kept, and its retention policy, proposed by
// HealthFlow but approved by the facility.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { allowRoles, caller, ADMIN_ROLES } from "../../middleware/facilityAccess.js";
import { notifyStaff } from "../../lib/notify.js";
import { applyErasure, erasurePlan, planSentence } from "../../lib/erasure.js";
import { confirmRetention, expiredFor } from "../../lib/retention.js";
import { exportFacilityData, rowsToCsv } from "../../lib/exportFacility.js";

export const privacyRouter = Router();

// ------------------------------------------------------------- privacy notice

/** A starting point the facility must read and edit before publishing. */
export function noticeTemplate(facilityName: string): string {
  return `${facilityName} uses HealthFlow to plan duty rosters, record leave and attendance, and check rosters against the Labour Act.

What we hold about you: your name, staff number, cadre, department, position, employment type, the date you joined, your phone number and email, an emergency contact, your duties, leave and attendance, and a record of changes made to these. If you agree separately, a photograph.

What we never hold: any diagnosis, symptom, condition or medical note. Sickness is recorded only as a type of leave and its dates.

Why: to run the facility's duty roster fairly and lawfully, and to keep the records an employer must keep.

Who can see it: facility administrators and roster managers at ${facilityName}, your supervisors for operational purposes, and PS Tech (who provide HealthFlow) only when needed to give support. Every such access is recorded and visible to the facility.

How long we keep it: as set out in the facility's approved retention periods.

Your rights: you can ask to see the information held about you, ask for it to be corrected, object to its use, or ask for it to be deleted where the law allows. Ask the data protection contact named below.

Data protection contact: [name and email of the facility's contact]`;
}

privacyRouter.get("/notices", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  const [notices, facility] = await Promise.all([
    prisma.privacyNotice.findMany({ where: { facilityId }, orderBy: { publishedAt: "desc" } }),
    prisma.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { name: true } }),
  ]);
  res.json({ notices, template: noticeTemplate(facility.name) });
});

const noticeInput = z.object({
  body: z
    .string({ required_error: "Write the notice." })
    .trim()
    .min(200, "A privacy notice needs to explain what is held, why, who sees it and people's rights. Write at least a few paragraphs.")
    .max(20000, "Keep the notice under 20,000 characters.")
    .refine((b) => !b.includes("[name and email"), "Replace the placeholder in square brackets with your data protection contact."),
});

privacyRouter.post("/notices", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(noticeInput, req.body, res);
  if (!input) return;
  const count = await prisma.privacyNotice.count({ where: { facilityId: who.facilityId } });
  const notice = await prisma.privacyNotice.create({
    data: {
      facilityId: who.facilityId,
      version: String(count + 1),
      body: input.body,
      publishedAt: new Date(),
      publishedBy: who.email,
    },
  });
  await writeAuditLog({
    facilityId: who.facilityId,
    actorEmail: who.email,
    action: "privacy_notice_published",
    entityType: "PrivacyNotice",
    entityId: notice.id,
    summary: `${who.displayName} published version ${notice.version} of the privacy notice.`,
  });
  res.status(201).json({ notice });
});

/** The version people accept when they join. */
export async function currentNotice(facilityId: string) {
  return prisma.privacyNotice.findFirst({
    where: { facilityId, publishedAt: { not: null } },
    orderBy: { publishedAt: "desc" },
  });
}

// ------------------------------------------------------------- retention

/** The spec's proposals (Part 3, 0.5). Created unapproved. */
const PROPOSALS: { entityType: string; months: number; note: string }[] = [
  { entityType: "Roster", months: 72, note: "Employment record" },
  { entityType: "Attendance", months: 72, note: "Employment record" },
  { entityType: "LeaveRequest", months: 72, note: "Counted from the end of employment" },
  { entityType: "AuditLog", months: 84, note: "" },
  { entityType: "ComplianceFinding", months: 72, note: "" },
  { entityType: "Notification", months: 12, note: "" },
  { entityType: "FailedSignIn", months: 3, note: "" },
  { entityType: "Staff", months: 72, note: "Counted from the end of employment" },
];

export const RETENTION_LABEL: Record<string, string> = {
  Roster: "Rosters and assignments",
  Attendance: "Attendance",
  LeaveRequest: "Leave requests and decisions",
  AuditLog: "Audit log",
  ComplianceFinding: "Compliance findings and overrides",
  Notification: "Notifications",
  FailedSignIn: "Failed sign-in records",
  Staff: "Staff records after leaving",
};

async function ensureProposals(facilityId: string) {
  const existing = await prisma.retentionPolicy.findMany({ where: { facilityId }, select: { entityType: true } });
  const have = new Set(existing.map((e) => e.entityType));
  const missing = PROPOSALS.filter((p) => !have.has(p.entityType));
  if (missing.length) {
    await prisma.retentionPolicy.createMany({
      data: missing.map((p) => ({
        facilityId,
        entityType: p.entityType,
        retentionMonths: p.months,
        basisNote: p.note || null,
        active: false,
      })),
    });
  }
}

function describeMonths(m: number) {
  if (m % 12 === 0) return `${m / 12} ${m === 12 ? "year" : "years"}`;
  return `${m} ${m === 1 ? "month" : "months"}`;
}

privacyRouter.get("/retention", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  await ensureProposals(facilityId);
  const rows = await prisma.retentionPolicy.findMany({ where: { facilityId } });
  const order = PROPOSALS.map((p) => p.entityType);
  rows.sort((a, b) => order.indexOf(a.entityType) - order.indexOf(b.entityType));
  res.json({
    policies: rows.map((r) => ({
      id: r.id,
      entityType: r.entityType,
      label: RETENTION_LABEL[r.entityType] ?? r.entityType,
      retentionMonths: r.retentionMonths,
      basisNote: r.basisNote,
      approved: r.active,
      approvedBy: r.approvedBy,
      approvedAt: r.approvedAt,
    })),
  });
});

const retentionInput = z.object({
  retentionMonths: z
    .number({ invalid_type_error: "Enter a number of months." })
    .int("Use whole months.")
    .min(1, "At least 1 month.")
    .max(1200, "At most 1,200 months."),
  basisNote: z.string().trim().max(300).nullish().transform((v) => v || null),
});

/** Changing a period withdraws its approval: the new period must be approved again. */
privacyRouter.patch("/retention/:id", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(retentionInput, req.body, res);
  if (!input) return;
  const row = await prisma.retentionPolicy.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!row) return res.status(404).json({ error: "not_found" });
  const periodChanged = row.retentionMonths !== input.retentionMonths;
  const updated = await prisma.retentionPolicy.update({
    where: { id: row.id },
    data: {
      retentionMonths: input.retentionMonths,
      basisNote: input.basisNote,
      ...(periodChanged ? { active: false, approvedAt: null, approvedBy: null } : {}),
    },
  });
  if (periodChanged) {
    await writeAuditLog({
      facilityId: who.facilityId,
      actorEmail: who.email,
      action: "retention_changed",
      entityType: "RetentionPolicy",
      entityId: row.id,
      before: { retentionMonths: row.retentionMonths },
      after: { retentionMonths: updated.retentionMonths },
      summary: `${who.displayName} changed the retention period for ${(RETENTION_LABEL[row.entityType] ?? row.entityType).toLowerCase()} from ${describeMonths(row.retentionMonths)} to ${describeMonths(updated.retentionMonths)}. It needs approval again.`,
    });
  }
  res.json({ ok: true });
});

privacyRouter.post("/retention/:id/approve", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const row = await prisma.retentionPolicy.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!row) return res.status(404).json({ error: "not_found" });
  if (row.active) return res.json({ ok: true });
  await prisma.retentionPolicy.update({
    where: { id: row.id },
    data: { active: true, approvedAt: new Date(), approvedBy: who.email },
  });
  await writeAuditLog({
    facilityId: who.facilityId,
    actorEmail: who.email,
    action: "retention_approved",
    entityType: "RetentionPolicy",
    entityId: row.id,
    summary: `${who.displayName} approved keeping ${(RETENTION_LABEL[row.entityType] ?? row.entityType).toLowerCase()} for ${describeMonths(row.retentionMonths)}.`,
  });
  res.json({ ok: true });
});

// ------------------------------------------------------------- data subject requests

const DAYMS = 86_400_000;

privacyRouter.get("/requests", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  const rows = await prisma.dataSubjectRequest.findMany({ where: { facilityId }, include: { staff: { select: { fullName: true } } }, orderBy: { receivedAt: "desc" } });
  const now = Date.now();
  res.json({
    requests: rows.map((r) => {
      const open = r.status === "RECEIVED" || r.status === "IN_PROGRESS";
      const left = r.dueAt ? Math.ceil((r.dueAt.getTime() - now) / DAYMS) : null;
      return { id: r.id, staff: r.staff.fullName, type: r.requestType, description: r.description, status: r.status, receivedAt: r.receivedAt, dueAt: r.dueAt, daysLeft: open ? left : null, overdue: open && left !== null && left < 0, completedAt: r.completedAt, outcomeNote: r.outcomeNote };
    }),
  });
});

privacyRouter.get("/requests/:id/erasure-plan", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const r = await prisma.dataSubjectRequest.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId, requestType: "ERASURE" } });
  if (!r) return res.status(404).json({ error: "not_found" });
  res.json({ plan: await erasurePlan(r.staffId, who.facilityId) });
});

async function close(req: Parameters<typeof caller>[0], id: string, status: "COMPLETED" | "REFUSED", outcomeNote: string, apply?: boolean) {
  const who = caller(req);
  const r = await prisma.dataSubjectRequest.findFirst({ where: { id, facilityId: who.facilityId } });
  if (!r) return null;
  if (r.status === "COMPLETED" || r.status === "REFUSED") return "closed" as const;
  if (apply) await applyErasure(r.staffId, who.facilityId);
  await prisma.dataSubjectRequest.update({ where: { id: r.id }, data: { status, completedAt: new Date(), handledBy: who.email, outcomeNote } });
  await notifyStaff(who.facilityId, r.staffId, { type: "dsr_answered", title: status === "REFUSED" ? "Your data request was not granted" : "Your data request was answered", body: outcomeNote, linkUrl: "/my-data", severity: "INFO" });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: `dsr_${status.toLowerCase()}`, entityType: "DataSubjectRequest", entityId: r.id, summary: `${who.displayName} ${status === "REFUSED" ? "refused" : "completed"} a ${r.requestType.toLowerCase()} request. ${outcomeNote}` });
  return "ok" as const;
}

const outcome = z.object({ outcomeNote: z.string().trim().min(10, "Say what was done, in a sentence.").max(1000) });

privacyRouter.post("/requests/:id/complete", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const input = parseOr400(outcome, req.body, res);
  if (!input) return;
  const out = await close(req, String(req.params.id), "COMPLETED", input.outcomeNote);
  if (!out) return res.status(404).json({ error: "not_found" });
  if (out === "closed") return res.status(409).json({ error: "closed", message: "This request is already closed." });
  res.json({ ok: true });
});

/** A refusal is allowed. A refusal with no reason is not. */
privacyRouter.post("/requests/:id/refuse", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const input = parseOr400(z.object({ reason: z.string().trim().min(10, "Give the reason, in a sentence. A refusal needs one.").max(1000) }), req.body, res);
  if (!input) return;
  const out = await close(req, String(req.params.id), "REFUSED", input.reason);
  if (!out) return res.status(404).json({ error: "not_found" });
  if (out === "closed") return res.status(409).json({ error: "closed", message: "This request is already closed." });
  res.json({ ok: true });
});

/** Carries out the erasure that is possible, keeps the rest, and tells the person both. */
privacyRouter.post("/requests/:id/erase", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const r = await prisma.dataSubjectRequest.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId, requestType: "ERASURE" } });
  if (!r) return res.status(404).json({ error: "not_found" });
  const note = planSentence(await erasurePlan(r.staffId, who.facilityId));
  const out = await close(req, r.id, "COMPLETED", note, true);
  if (out === "closed") return res.status(409).json({ error: "closed", message: "This request is already closed." });
  res.json({ ok: true, outcomeNote: note });
});

// ------------------------------------------------------------- retention job

privacyRouter.get("/retention-due", allowRoles(...ADMIN_ROLES), async (req, res) => {
  res.json({ expired: await expiredFor(caller(req).facilityId) });
});

privacyRouter.post("/retention-due/confirm", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(z.object({ entityType: z.string() }), req.body, res);
  if (!input) return;
  try {
    res.json({ deleted: await confirmRetention(who.facilityId, input.entityType, who) });
  } catch {
    res.status(409).json({ error: "not_removable", message: "That kind is not removed by the job, or its period is not approved." });
  }
});

// ------------------------------------------------------------- facility export

privacyRouter.get("/export.json", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "facility_exported", entityType: "Facility", entityId: who.facilityId, summary: `${who.displayName} exported all of the facility's data.` });
  res.setHeader("Content-Disposition", `attachment; filename="facility-data.json"`);
  res.json(await exportFacilityData(who.facilityId));
});

privacyRouter.get("/export/:entity.csv", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const data = await exportFacilityData(who.facilityId);
  const rows = (data.entities as Record<string, Record<string, unknown>[]>)[String(req.params.entity)];
  if (!rows) return res.status(404).json({ error: "not_found" });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${String(req.params.entity)}.csv"`);
  res.send(rowsToCsv(rows));
});

privacyRouter.get("/export", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const data = await exportFacilityData(caller(req).facilityId);
  res.json({ entities: Object.entries(data.entities).map(([name, rows]) => ({ name, rows: (rows as unknown[]).length })) });
});
