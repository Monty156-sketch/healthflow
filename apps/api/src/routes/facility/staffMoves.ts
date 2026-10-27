// Posting a member of staff to another facility that is also on HealthFlow.
// The sending administrator asks; the receiving administrator accepts. On
// acceptance a new staff record is made in the receiving facility from the
// old one, the person's login moves across, and the old record stays behind
// as "Transferred" with its contact details removed. Nothing is typed again.
import { Router, type Request } from "express";
import { z } from "zod";
import type { Prisma, Role } from "@healthflow/db";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { notifyDeciders } from "../../lib/notify.js";
import { revokeAllSessionsForUser } from "../../lib/tokens.js";
import { parseOr400 } from "../../lib/validate.js";
import { displayDate } from "../../lib/labels.js";
import { allowRoles, caller, ADMIN_ROLES } from "../../middleware/facilityAccess.js";

export const staffMovesRouter = Router();
staffMovesRouter.use(allowRoles(...ADMIN_ROLES));

const OPEN = ["TRIAL", "ACTIVE"] as const;

/** Takes a person's contact details and photo off a record that stays for the history. */
export async function scrubStaff(tx: Prisma.TransactionClient, staffId: string, status: "INACTIVE" | "TRANSFERRED") {
  await tx.staff.update({
    where: { id: staffId },
    data: { status, archivedAt: new Date(), phone: null, email: null, photoUrl: null, photoConsentId: null, emergencyContactName: null, emergencyContactPhone: null },
  });
}

/** Removes a person's login. Their sign-in sessions go with it. */
export async function removeLogin(tx: Prisma.TransactionClient, userProfileId: string) {
  await tx.refreshToken.deleteMany({ where: { userProfileId } });
  await tx.userProfile.delete({ where: { id: userProfileId } });
}

const norm = (s: string) => s.trim().toLowerCase();

// ------------------------------------------------------------ lists

/** Facilities this one can post staff to. A search, so the customer list cannot be browsed. */
staffMovesRouter.get("/destinations", async (req, res) => {
  const who = caller(req);
  const q = String(req.query.q ?? "").trim();
  if (q.length < 3) return res.json({ facilities: [] });
  const rows = await prisma.facility.findMany({
    where: { id: { not: who.facilityId }, active: true, status: { in: [...OPEN] }, name: { contains: q, mode: "insensitive" } },
    orderBy: { name: "asc" },
    take: 15,
    select: { id: true, name: true, region: true, district: { select: { name: true } } },
  });
  res.json({ facilities: rows.map((f) => ({ id: f.id, name: f.name, region: f.region, district: f.district?.name ?? null })) });
});

const rowOut = (m: { id: string; status: string; note: string | null; createdAt: Date; decidedAt: Date | null; staff: { fullName: string; staffNo: string; position: string | null; cadre: { name: string } | null }; fromFacility: { name: string }; toFacility: { name: string } }) => ({
  id: m.id, status: m.status, note: m.note, createdAt: m.createdAt, decidedAt: m.decidedAt,
  fullName: m.staff.fullName, staffNo: m.staff.staffNo, position: m.staff.position, cadre: m.staff.cadre?.name ?? null,
  from: m.fromFacility.name, to: m.toFacility.name,
});
const rowSelect = { id: true, status: true, note: true, createdAt: true, decidedAt: true, staff: { select: { fullName: true, staffNo: true, position: true, cadre: { select: { name: true } } } }, fromFacility: { select: { name: true } }, toFacility: { select: { name: true } } } satisfies Prisma.StaffMoveSelect;

staffMovesRouter.get("/", async (req, res) => {
  const who = caller(req);
  const [incoming, outgoing] = await Promise.all([
    prisma.staffMove.findMany({ where: { toFacilityId: who.facilityId }, orderBy: { createdAt: "desc" }, take: 50, select: rowSelect }),
    prisma.staffMove.findMany({ where: { fromFacilityId: who.facilityId }, orderBy: { createdAt: "desc" }, take: 50, select: rowSelect }),
  ]);
  res.json({ incoming: incoming.map(rowOut), outgoing: outgoing.map(rowOut) });
});

// ------------------------------------------------------------ ask

const askInput = z.object({
  staffId: z.string().trim().min(1),
  toFacilityId: z.string().trim().min(1, "Choose the facility."),
  note: z.string().trim().max(300).optional(),
});

staffMovesRouter.post("/", async (req, res) => {
  const who = caller(req);
  const input = parseOr400(askInput, req.body, res);
  if (!input) return;
  const staff = await prisma.staff.findFirst({ where: { id: input.staffId, facilityId: who.facilityId }, include: { userProfile: { select: { id: true } } } });
  if (!staff) return res.status(404).json({ error: "not_found" });
  if (!["ACTIVE", "ON_LEAVE"].includes(staff.status)) return res.status(409).json({ error: "not_current", message: "Only someone who is working here can be posted to another facility." });
  if (staff.userProfile?.id === who.userId) return res.status(409).json({ error: "cannot_move_self", message: "You cannot post yourself. Ask another facility administrator to do it." });
  const dest = await prisma.facility.findFirst({ where: { id: input.toFacilityId, active: true, status: { in: [...OPEN] }, NOT: { id: who.facilityId } }, select: { id: true, name: true } });
  if (!dest) return res.status(400).json({ error: "invalid_input", fields: { toFacilityId: "Choose a facility that is on HealthFlow." } });
  const already = await prisma.staffMove.findFirst({ where: { staffId: staff.id, status: "PENDING" }, select: { id: true } });
  if (already) return res.status(409).json({ error: "already_asked", message: `${staff.fullName} already has a posting waiting for an answer. Cancel it first to ask a different facility.` });

  const move = await prisma.staffMove.create({ data: { staffId: staff.id, fromFacilityId: who.facilityId, toFacilityId: dest.id, note: input.note || null, requestedBy: who.email } });
  const mine = await prisma.facility.findUniqueOrThrow({ where: { id: who.facilityId }, select: { name: true } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "staff_move_asked", entityType: "Staff", entityId: staff.id, summary: `${who.displayName} asked ${dest.name} to take ${staff.fullName} on transfer.` });
  await notifyDeciders(dest.id, { type: "staff_move_asked", title: "A member of staff is being posted to you", body: `${mine.name} asks you to take ${staff.fullName}${staff.position ? ` (${staff.position})` : ""}. Accept to bring their details across, so they do not register again.`, linkUrl: "/staff/transfers", severity: "ACTION" });
  res.status(201).json({ id: move.id });
});

// ------------------------------------------------------------ answer

async function mine(req: Request, which: "to" | "from") {
  const who = caller(req);
  const move = await prisma.staffMove.findFirst({
    where: { id: String(req.params.id), ...(which === "to" ? { toFacilityId: who.facilityId } : { fromFacilityId: who.facilityId }) },
    include: { staff: { include: { cadre: { select: { name: true } }, department: { select: { name: true } }, userProfile: true } }, fromFacility: { select: { id: true, name: true } }, toFacility: { select: { id: true, name: true } } },
  });
  return { who, move };
}

staffMovesRouter.post("/:id/decline", async (req, res) => {
  const { who, move } = await mine(req, "to");
  if (!move) return res.status(404).json({ error: "not_found" });
  if (move.status !== "PENDING") return res.status(409).json({ error: "closed", message: "That request has already been answered." });
  await prisma.staffMove.update({ where: { id: move.id }, data: { status: "DECLINED", decidedBy: who.email, decidedAt: new Date() } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "staff_move_declined", entityType: "Staff", entityId: move.staffId, summary: `${who.displayName} declined to take ${move.staff.fullName} from ${move.fromFacility.name}.` });
  await notifyDeciders(move.fromFacilityId, { type: "staff_move_declined", title: "Posting declined", body: `${move.toFacility.name} did not accept ${move.staff.fullName}. They stay with you.`, linkUrl: "/staff/transfers" });
  res.json({ ok: true });
});

staffMovesRouter.post("/:id/cancel", async (req, res) => {
  const { who, move } = await mine(req, "from");
  if (!move) return res.status(404).json({ error: "not_found" });
  if (move.status !== "PENDING") return res.status(409).json({ error: "closed", message: "That request has already been answered." });
  await prisma.staffMove.update({ where: { id: move.id }, data: { status: "CANCELLED", decidedBy: who.email, decidedAt: new Date() } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "staff_move_cancelled", entityType: "Staff", entityId: move.staffId, summary: `${who.displayName} withdrew the request to post ${move.staff.fullName} to ${move.toFacility.name}.` });
  res.json({ ok: true });
});

staffMovesRouter.post("/:id/accept", async (req, res) => {
  const { who, move } = await mine(req, "to");
  if (!move) return res.status(404).json({ error: "not_found" });
  if (move.status !== "PENDING") return res.status(409).json({ error: "closed", message: "That request has already been answered." });
  const old = move.staff;
  if (!["ACTIVE", "ON_LEAVE"].includes(old.status) || old.facilityId !== move.fromFacilityId) {
    return res.status(409).json({ error: "not_current", message: `${old.fullName} is no longer working at ${move.fromFacility.name}, so this cannot go ahead.` });
  }

  const [cadres, departments] = await Promise.all([
    prisma.cadre.findMany({ where: { facilityId: who.facilityId, active: true }, select: { id: true, name: true } }),
    prisma.department.findMany({ where: { facilityId: who.facilityId, active: true }, select: { id: true, name: true } }),
  ]);
  const cadre = old.cadre ? cadres.find((c) => norm(c.name) === norm(old.cadre!.name)) : undefined;
  const dept = old.department ? departments.find((d) => norm(d.name) === norm(old.department!.name)) : undefined;
  const taken = new Set((await prisma.staff.findMany({ where: { facilityId: who.facilityId, staffNo: { startsWith: old.staffNo } }, select: { staffNo: true } })).map((s) => norm(s.staffNo)));
  let staffNo = old.staffNo;
  for (let n = 2; taken.has(norm(staffNo)); n++) staffNo = `${old.staffNo}-${n}`;
  const profile = old.userProfile;

  const created = await prisma.$transaction(async (tx) => {
    const claimed = await tx.staffMove.updateMany({ where: { id: move.id, status: "PENDING" }, data: { status: "ACCEPTED", decidedBy: who.email, decidedAt: new Date() } });
    if (claimed.count !== 1) return null;
    const s = await tx.staff.create({
      data: {
        facilityId: who.facilityId, staffNo, fullName: old.fullName, phone: old.phone, email: old.email,
        cadreId: cadre?.id ?? null, departmentId: dept?.id ?? null,
        requestedCadre: cadre || !old.cadre ? null : old.cadre.name, requestedDepartment: dept || !old.department ? null : old.department.name,
        position: old.position, employmentStatus: old.employmentStatus, status: "ACTIVE", dateJoined: new Date(),
        emergencyContactName: old.emergencyContactName, emergencyContactPhone: old.emergencyContactPhone,
        excludedFromNights: old.excludedFromNights, exclusionReason: old.exclusionReason, morningOnly: old.morningOnly,
        willingForExtraDuties: old.willingForExtraDuties, maxDutiesPerWeek: old.maxDutiesPerWeek, canLead: old.canLead,
        leaveGrade: old.leaveGrade, maxNightsPerMonth: old.maxNightsPerMonth, maxHoursPerMonth: old.maxHoursPerMonth,
        smsOptOut: old.smsOptOut, phoneVerified: old.phoneVerified, joinedVia: "TRANSFER",
      },
    });
    await scrubStaff(tx, old.id, "TRANSFERRED");
    if (profile) {
      // Same email and password; the role starts as plain staff because duties at the old facility do not carry over.
      await tx.userProfile.update({ where: { id: profile.id }, data: { facilityId: who.facilityId, scopeId: who.facilityId, staffId: s.id, departmentId: null, role: "STAFF" as Role } });
    }
    return s;
  });
  if (!created) return res.status(409).json({ error: "closed", message: "That request has already been answered." });
  // Signs them out everywhere so the next sign in opens the new facility.
  if (profile) await revokeAllSessionsForUser(profile.id, "staff_moved_facility");

  const note = !cadre && old.cadre ? ` Their cadre (${old.cadre.name}) is not set up here yet, so choose it on their record.` : "";
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "staff_move_accepted", entityType: "Staff", entityId: created.id, summary: `${who.displayName} accepted ${old.fullName} on transfer from ${move.fromFacility.name} on ${displayDate(new Date())}.${note}` });
  await writeAuditLog({ facilityId: move.fromFacilityId, actorEmail: who.email, action: "staff_moved_out", entityType: "Staff", entityId: old.id, summary: `${old.fullName} was accepted by ${move.toFacility.name} and is now marked Transferred. Contact details were removed from this record; the history stays.` });
  await notifyDeciders(move.fromFacilityId, { type: "staff_move_accepted", title: "Posting accepted", body: `${move.toFacility.name} accepted ${old.fullName}. They are marked Transferred here.`, linkUrl: "/staff/transfers" });
  res.json({ staffId: created.id, message: `${old.fullName} now works at ${move.toFacility.name}.${note}` });
});
