// Inter-ward transfers. The person keeps their record, leave, history and
// account; only their ward changes, on the effective date. Their duties in the
// old ward from that date are taken off its roster, the ones before it are
// kept (locked, so a regenerate cannot drop them), and the new ward's roster
// counts them from that date. Set up by the facility administrator, or by a
// ward's in-charge for someone leaving their ward. Open swaps and cover
// requests in the old ward from that date are cancelled.
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Prisma } from "@healthflow/db";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { notifyStaff, notifyWard } from "../../lib/notify.js";
import { detachAttendance } from "../../lib/attendanceReview.js";
import { isInCharge } from "../../lib/dutyPlan.js";
import { allowRoles, caller, READ_ROLES } from "../../middleware/facilityAccess.js";

export const transfersRouter = Router();

const DAY = 86_400_000;
const today = () => Math.floor(Date.now() / DAY);
const dayOf = (d: Date) => Math.floor(d.getTime() / DAY);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const say = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const include = {
  staff: { select: { fullName: true, staffNo: true } },
  fromDepartment: { select: { name: true } },
  toDepartment: { select: { name: true } },
} satisfies Prisma.WardTransferInclude;
type Row = Prisma.WardTransferGetPayload<{ include: typeof include }>;

const present = (t: Row) => ({
  id: t.id, staffId: t.staffId, name: t.staff.fullName, staffNo: t.staff.staffNo, fromDepartmentId: t.fromDepartmentId,
  from: t.fromDepartment?.name ?? null, to: t.toDepartment.name, effectiveDate: iso(t.effectiveDate), kind: t.kind, inCharge: t.inCharge, reason: t.reason,
  status: t.cancelledAt ? "CANCELLED" : t.appliedAt ? "DONE" : "SCHEDULED", createdBy: t.createdBy, createdAt: t.createdAt,
});

/** The administrator sees every transfer; a ward in-charge sees the ones into and out of their ward. */
transfersRouter.get("/", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId, departmentId: ward } = caller(req);
  const rows = await prisma.wardTransfer.findMany({
    where: { facilityId, ...(ward ? { OR: [{ fromDepartmentId: ward }, { toDepartmentId: ward }] } : {}) },
    include, orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }], take: 200,
  });
  res.json({ transfers: rows.map(present) });
});

const createInput = z.object({
  staffId: z.string().min(1, "Choose the person."),
  toDepartmentId: z.string().min(1, "Choose the ward they move to."),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  kind: z.enum(["ROUTINE", "EMERGENCY"]).default("ROUTINE"),
  reason: z.string().trim().max(300, "Keep the reason under 300 characters.").optional(),
  /** They take charge of the new ward's rosters. */
  inCharge: z.boolean().default(false),
});

/** The administrator, or a ward in-charge for their own ward. Null (and a reply sent) for anyone else. */
function mover(req: Request, res: Response) {
  const who = caller(req);
  if (who.role === "FACILITY_ADMIN" || (who.departmentId && ["ROSTER_MANAGER", "SUPERVISOR"].includes(who.role))) return who;
  res.status(403).json({ error: "forbidden", message: "Only the administrator or a ward in-charge can transfer staff." });
  return null;
}

transfersRouter.post("/", allowRoles(...READ_ROLES), async (req, res) => {
  const who = mover(req, res);
  if (!who) return;
  const input = parseOr400(createInput, req.body, res);
  if (!input) return;
  const person = await prisma.staff.findFirst({ where: { id: input.staffId, facilityId: who.facilityId, status: { in: ["ACTIVE", "ON_LEAVE"] }, ...(who.departmentId ? { departmentId: who.departmentId } : {}) }, select: { id: true, fullName: true, departmentId: true } });
  if (!person) return res.status(400).json({ error: "invalid_input", fields: { staffId: who.departmentId ? "Choose someone in your ward." : "Choose a current member of staff." } });
  // Only the administrator appoints an in-charge.
  if (input.inCharge && who.departmentId) return res.status(403).json({ error: "forbidden", message: "Only the administrator can make someone a ward in-charge." });
  const to = await prisma.department.findFirst({ where: { id: input.toDepartmentId, facilityId: who.facilityId, active: true }, select: { id: true, name: true } });
  if (!to) return res.status(400).json({ error: "invalid_input", fields: { toDepartmentId: "Choose an active ward." } });
  if (to.id === person.departmentId) return res.status(400).json({ error: "invalid_input", fields: { toDepartmentId: `${person.fullName} is already in ${to.name}.` } });
  const date = new Date(`${input.effectiveDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || dayOf(date) < today()) return res.status(400).json({ error: "invalid_input", fields: { effectiveDate: "Choose today or a later date." } });
  if (dayOf(date) > today() + 366) return res.status(400).json({ error: "invalid_input", fields: { effectiveDate: "Choose a date within the next year." } });
  const open = await prisma.wardTransfer.findFirst({ where: { staffId: person.id, appliedAt: null, cancelledAt: null }, select: { id: true } });
  if (open) return res.status(409).json({ error: "transfer_open", message: `${person.fullName} already has a transfer waiting. Cancel it first.` });

  const t = await prisma.wardTransfer.create({
    data: {
      facilityId: who.facilityId, staffId: person.id, fromDepartmentId: person.departmentId, toDepartmentId: to.id, effectiveDate: date,
      kind: input.kind, inCharge: input.inCharge, reason: input.reason || null, createdBy: who.email,
    },
    include,
  });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "ward_transfer_set", entityType: "Staff", entityId: person.id,
    summary: `${who.displayName} set ${input.kind === "EMERGENCY" ? "an emergency" : "a"} transfer for ${person.fullName} from ${t.fromDepartment?.name ?? "no ward"} to ${to.name}, from ${say(date)}.${input.reason ? ` Reason: ${input.reason}` : ""}`,
  });
  if (dayOf(date) <= today()) await applyTransfer(t.id, who.email);
  else {
    await notifyStaff(who.facilityId, person.id, { type: "ward_transfer", title: `You move to ${to.name}`, body: `You move to ${to.name} from ${say(date)}.`, linkUrl: "/my-duties" });
    await notifyWard(who.facilityId, to.id, { type: "ward_transfer", title: `${person.fullName} joins ${to.name}`, body: `${person.fullName} joins ${to.name} from ${say(date)}. They are counted on its rosters from that day.`, linkUrl: "/transfers" });
  }
  const fresh = await prisma.wardTransfer.findUniqueOrThrow({ where: { id: t.id }, include });
  res.status(201).json({ transfer: present(fresh) });
});

transfersRouter.post("/:id/cancel", allowRoles(...READ_ROLES), async (req, res) => {
  const who = mover(req, res);
  if (!who) return;
  const t = await prisma.wardTransfer.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId, ...(who.departmentId ? { fromDepartmentId: who.departmentId } : {}) }, include });
  if (!t) return res.status(404).json({ error: "not_found" });
  if (t.appliedAt || t.cancelledAt) return res.status(409).json({ error: "not_open", message: t.appliedAt ? "This transfer has already happened. Set a new transfer to move them back." : "This transfer is already cancelled." });
  await prisma.wardTransfer.update({ where: { id: t.id }, data: { cancelledAt: new Date() } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "ward_transfer_cancelled", entityType: "Staff", entityId: t.staffId, summary: `${who.displayName} cancelled ${t.staff.fullName}'s transfer to ${t.toDepartment.name}.` });
  await notifyStaff(who.facilityId, t.staffId, { type: "ward_transfer", title: "Transfer cancelled", body: `Your move to ${t.toDepartment.name} was cancelled.` });
  res.json({ ok: true });
});

/** Moves the person. Safe to call twice: only the first call does anything. */
export async function applyTransfer(id: string, actor: string): Promise<boolean> {
  const t = await prisma.wardTransfer.findUnique({ where: { id }, include: { ...include, staff: { select: { fullName: true, staffNo: true, position: true, userProfile: { select: { id: true, role: true, departmentId: true } } } } } });
  if (!t || t.appliedAt || t.cancelledAt) return false;
  const inCharge = t.inCharge;
  const eff = t.effectiveDate;
  const monthStart = new Date(Date.UTC(eff.getUTCFullYear(), eff.getUTCMonth(), 1));
  const profile = t.staff.userProfile;
  const wasWardManager = Boolean(profile && profile.role !== "FACILITY_ADMIN" && profile.role !== "STAFF" && profile.departmentId && profile.departmentId === t.fromDepartmentId);

  let removed = 0;
  let closed = 0;
  const done = await prisma.$transaction(async (tx) => {
    const claimed = await tx.wardTransfer.updateMany({ where: { id, appliedAt: null, cancelledAt: null }, data: { appliedAt: new Date() } });
    if (claimed.count === 0) return false;
    await tx.staff.update({
      where: { id: t.staffId },
      data: {
        departmentId: t.toDepartmentId,
        ...(inCharge ? { morningOnly: true, ...(isInCharge(t.staff.position) ? {} : { position: "Ward in-charge" }) } : wasWardManager ? { morningOnly: false, ...(isInCharge(t.staff.position) ? { position: null } : {}) } : {}),
      },
    });
    if (t.fromDepartmentId) {
      const old = { staffId: t.staffId, roster: { departmentId: t.fromDepartmentId } };
      // Duties already worked in the old ward stay on its roster and survive a regenerate.
      await tx.rosterAssignment.updateMany({ where: { ...old, dutyDate: { gte: monthStart, lt: eff } }, data: { locked: true } });
      const later = { ...old, dutyDate: { gte: eff } };
      // Swaps and cover they are part of in the old ward from that day no longer make sense.
      const oldWard = (await tx.rosterAssignment.findMany({ where: { roster: { departmentId: t.fromDepartmentId }, dutyDate: { gte: eff } }, select: { id: true } })).map((a) => a.id);
      const theirs = { OR: [{ requesterStaffId: t.staffId }, { targetStaffId: t.staffId }] };
      closed += (await tx.dutySwap.updateMany({
        where: { status: { in: ["REQUESTED", "ACCEPTED"] }, ...theirs, AND: [{ OR: [{ requesterAssignmentId: { in: oldWard } }, { targetAssignmentId: { in: oldWard } }] }] },
        data: { status: "CANCELLED", decisionNote: `Cancelled: moved to ${t.toDepartment.name}.`, decidedAt: new Date() },
      })).count;
      closed += (await tx.coverProposal.updateMany({
        where: { status: "PROPOSED", rosterAssignmentId: { in: oldWard }, OR: [{ proposedStaffId: t.staffId }, { absentStaffId: t.staffId }] },
        data: { status: "SUPERSEDED" },
      })).count;
      await detachAttendance(tx, later);
      removed = (await tx.rosterAssignment.deleteMany({ where: later })).count;
    }
    if (profile && profile.role !== "FACILITY_ADMIN") {
      if (inCharge) await tx.userProfile.update({ where: { id: profile.id }, data: { role: "ROSTER_MANAGER", departmentId: t.toDepartmentId } });
      // An in-charge of the old ward does not take charge of the new one unless that was asked for.
      else if (wasWardManager) await tx.userProfile.update({ where: { id: profile.id }, data: { role: "STAFF", departmentId: null } });
    }
    return true;
  });
  if (!done) return false;

  const from = t.fromDepartment?.name ?? "no ward";
  await writeAuditLog({
    facilityId: t.facilityId, actorEmail: actor, action: "ward_transfer_done", entityType: "Staff", entityId: t.staffId,
    summary: `${t.staff.fullName} moved from ${from} to ${t.toDepartment.name} on ${say(eff)}.${removed ? ` ${removed} ${removed === 1 ? "duty" : "duties"} in ${from} from that day were taken off its roster.` : ""}${closed ? ` ${closed} open ${closed === 1 ? "swap or cover request was" : "swaps or cover requests were"} cancelled.` : ""}${inCharge ? ` They are now in charge of ${t.toDepartment.name}.` : wasWardManager ? ` They are no longer in charge of ${from}.` : ""}`,
  });
  await notifyStaff(t.facilityId, t.staffId, { type: "ward_transfer", title: `You are now in ${t.toDepartment.name}`, body: `You moved from ${from} to ${t.toDepartment.name} on ${say(eff)}. Your new ward's roster shows your duties.`, linkUrl: "/my-duties" });
  await notifyWard(t.facilityId, t.toDepartmentId, { type: "ward_transfer", title: `${t.staff.fullName} joined ${t.toDepartment.name}`, body: `${t.staff.fullName} is now in ${t.toDepartment.name}. Add them to this month's roster or generate it again.`, linkUrl: "/roster" });
  if (t.fromDepartmentId && removed) {
    await notifyWard(t.facilityId, t.fromDepartmentId, { type: "ward_transfer", title: `${t.staff.fullName} left ${from}`, body: `${removed} of ${t.staff.fullName}'s duties from ${say(eff)} were taken off the ${from} roster. Fill the gaps.`, linkUrl: "/roster" });
  }
  return true;
}

/** For the scheduler: every transfer whose day has come. */
export async function applyDueTransfers(): Promise<number> {
  const due = await prisma.wardTransfer.findMany({ where: { appliedAt: null, cancelledAt: null, effectiveDate: { lte: new Date(today() * DAY) } }, select: { id: true } });
  let n = 0;
  for (const t of due) if (await applyTransfer(t.id, "HealthFlow scheduler")) n++;
  return n;
}

/** A ward changed on the staff record: recorded as a transfer from today, so the rosters follow. */
export async function transferToday(facilityId: string, staffId: string, toDepartmentId: string, actorEmail: string): Promise<string | null> {
  const open = await prisma.wardTransfer.findFirst({ where: { staffId, appliedAt: null, cancelledAt: null }, select: { id: true } });
  if (open) return "This person has a transfer waiting. Cancel it on the Ward transfers page first.";
  const person = await prisma.staff.findUniqueOrThrow({ where: { id: staffId }, select: { departmentId: true } });
  const t = await prisma.wardTransfer.create({
    data: { facilityId, staffId, fromDepartmentId: person.departmentId, toDepartmentId, effectiveDate: new Date(today() * DAY), reason: "Changed on the staff record.", createdBy: actorEmail },
  });
  await applyTransfer(t.id, actorEmail);
  return null;
}
