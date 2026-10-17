// Cover for an absence. Swap first is for planned absence; this is the
// fallback and the same-day path. For one duty with an absent holder it finds
// everyone who could lawfully take it, ranks them with reasons, keeps the top
// five, and moves the duty only when asked. A cover duty nobody has confirmed
// is not cover: it stays "awaiting", and escalates when the window passes.
import type { Prisma } from "@healthflow/db";
import { prisma } from "./prisma.js";
import { writeAuditLog } from "./audit.js";
import { notifyDeciders, notifyStaff } from "./notify.js";
import { openBalances, writePair } from "./ledger.js";
import { sayDay } from "../engine/time.js";
import { evaluateSwap } from "../routes/facility/swaps.js";
import { checkOf, loadEngineData, monthName, saveVersion, storeFindings } from "../routes/facility/rosters.js";

const DAY = 86_400_000;
const dayOf = (d: Date) => Math.floor(d.getTime() / DAY);

export class CoverError extends Error {
  constructor(public status: number, message: string, public reasons?: string[]) {
    super(message);
  }
}

async function load(facilityId: string, assignmentId: string) {
  const a = await prisma.rosterAssignment.findFirst({
    where: { id: assignmentId, facilityId, shift: { countsAsDuty: true } },
    include: { shift: true, roster: true, staff: { select: { id: true, fullName: true, cadreId: true } } },
  });
  if (!a) throw new CoverError(404, "That duty was not found.");
  if (a.roster.status !== "PUBLISHED") throw new CoverError(409, `The ${monthName(a.roster)} roster is not published, so cover cannot be arranged on it.`);
  if (dayOf(a.dutyDate) < Math.floor(Date.now() / DAY)) throw new CoverError(409, "That duty is already in the past.");
  return a;
}

export interface CoverOption {
  proposalId: string;
  rank: number;
  staffId: string;
  name: string;
  cadre: string | null;
  score: number;
  reasons: string[];
  warnings: string[];
}

/** The ranked list for one duty, with the reason for each. Replaces any earlier list. */
export async function coverOptions(facilityId: string, assignmentId: string) {
  const a = await load(facilityId, assignmentId);
  const day = dayOf(a.dutyDate);
  const [people, counts, near, bal] = await Promise.all([
    prisma.staff.findMany({ where: { facilityId, status: "ACTIVE", id: { not: a.staffId } }, select: { id: true, fullName: true, staffNo: true, cadreId: true, willingForExtraDuties: true, cadre: { select: { name: true } } } }),
    prisma.rosterAssignment.groupBy({ by: ["staffId"], where: { rosterId: a.rosterId, shift: { countsAsDuty: true } }, _count: { _all: true } }),
    prisma.rosterAssignment.findMany({ where: { rosterId: a.rosterId, shift: { countsAsDuty: true }, dutyDate: { in: [new Date((day - 1) * DAY), new Date((day + 1) * DAY)] } }, select: { staffId: true } }),
    openBalances(facilityId),
  ]);
  const everyone = await prisma.staff.findMany({ where: { facilityId, status: "ACTIVE" }, select: { id: true, cadreId: true } });
  const count = new Map(counts.map((c) => [c.staffId, c._count._all]));
  const cadreAvg = new Map<string | null, number>();
  for (const cid of new Set(everyone.map((e) => e.cadreId))) {
    const members = everyone.filter((e) => e.cadreId === cid);
    cadreAvg.set(cid, members.reduce((n, m) => n + (count.get(m.id) ?? 0), 0) / Math.max(1, members.length));
  }
  const adjacent = new Set(near.map((n) => n.staffId));

  const lawful: (Omit<CoverOption, "proposalId" | "rank"> & { staffNo: string })[] = [];
  const ruledOut: { name: string; why: string }[] = [];
  for (const c of people) {
    const o = await evaluateSwap(facilityId, { rosterId: a.rosterId, requesterStaffId: a.staffId, requesterAssignmentId: a.id, targetStaffId: c.id, targetAssignmentId: null }, { enforceCutoff: false, ignoreStart: true });
    if (!o.ok) {
      if (!/cadre is not eligible|not set up for the|excluded from night/.test(o.hard[0] ?? "")) ruledOut.push({ name: c.fullName, why: o.hard[0] ?? "Not possible." });
      continue;
    }
    const mine = count.get(c.id) ?? 0;
    const deficit = (cadreAvg.get(c.cadreId) ?? 0) - mine;
    const b = bal.get(c.id) ?? { owes: 0, owed: 0 };
    const balance = b.owes - b.owed;
    const cont = adjacent.has(c.id) ? 1 : 0;
    const reasons: string[] = [];
    if (deficit >= 1) reasons.push(`${Math.round(deficit)} ${Math.round(deficit) === 1 ? "duty" : "duties"} below the ${(c.cadre?.name ?? "staff").toLowerCase()} average this month`);
    else if (deficit <= -1) reasons.push(`${Math.round(-deficit)} ${Math.round(-deficit) === 1 ? "duty" : "duties"} above the ${(c.cadre?.name ?? "staff").toLowerCase()} average this month`);
    else reasons.push("in line with the average duties this month");
    if (b.owes > 0) reasons.push(`owes ${b.owes} ${b.owes === 1 ? "duty" : "duties"} to the ledger, so this settles part of it`);
    if (b.owed > 0) reasons.push(`is already owed ${b.owed} ${b.owed === 1 ? "duty" : "duties"}`);
    if (cont) reasons.push("already works the day before or after");
    const willing = c.willingForExtraDuties ? 1 : 0;
    if (willing) reasons.push("has said they are willing to cover extra duties");
    lawful.push({ staffId: c.id, staffNo: c.staffNo, name: c.fullName, cadre: c.cadre?.name ?? null, score: Math.round((10 * deficit + 8 * balance + 2 * cont + 2 * willing) * 10) / 10, reasons, warnings: o.warnings });
  }
  lawful.sort((x, y) => y.score - x.score || x.staffNo.localeCompare(y.staffNo));
  const top = lawful.slice(0, 5);

  await prisma.coverProposal.updateMany({ where: { rosterAssignmentId: a.id, status: "PROPOSED" }, data: { status: "SUPERSEDED" } });
  const options: CoverOption[] = [];
  for (const [i, t] of top.entries()) {
    const row = await prisma.coverProposal.create({
      data: { facilityId, rosterAssignmentId: a.id, absentStaffId: a.isCover && a.coverForStaffId ? a.coverForStaffId : a.staffId, dutyDate: a.dutyDate, shiftId: a.shiftId, proposedStaffId: t.staffId, rank: i + 1, score: t.score, reasons: { lines: t.reasons, warnings: t.warnings } },
    });
    options.push({ proposalId: row.id, rank: i + 1, staffId: t.staffId, name: t.name, cadre: t.cadre, score: t.score, reasons: t.reasons, warnings: t.warnings });
  }
  return {
    duty: { id: a.id, date: a.dutyDate.toISOString().slice(0, 10), shift: a.shift.name, holder: a.staff.fullName },
    options,
    ruledOut: ruledOut.slice(0, 8),
    summary: options.length === 0 ? `Nobody can lawfully take the ${a.shift.name} duty on ${sayDay(day)}. It would stay unfilled.` : `${lawful.length} ${lawful.length === 1 ? "person" : "people"} could lawfully take this duty. The best ${options.length === 1 ? "is" : `${options.length} are`} shown.`,
  };
}

export async function refreshFindings(facilityId: string, roster: { id: string; year: number; month: number }) {
  const data = await loadEngineData(facilityId, roster.id, roster.year, roster.month);
  const findings = checkOf(data, data.current);
  await prisma.$transaction(async (tx) => {
    await storeFindings(tx, roster.id, facilityId, findings);
    await tx.roster.update({ where: { id: roster.id }, data: { hasUnresolvedConflicts: findings.some((f) => f.severity === "BLOCK") } });
  });
}

/** Moves one duty to another person, keeping a version of the roster first. */
async function applyMove(
  facilityId: string,
  a: { id: string; rosterId: string; dutyDate: Date; roster: { id: string; year: number; month: number; version: number } },
  toStaffId: string | null,
  by: string,
  reason: string,
  cover?: { originalStaffId: string },
) {
  await prisma.$transaction(
    async (tx) => {
      const version = a.roster.version + 1;
      await saveVersion(tx, a.rosterId, version, by, reason);
      // The record of who was away stays; it just no longer hangs off this duty.
      await tx.attendance.updateMany({ where: { rosterAssignmentId: a.id }, data: { rosterAssignmentId: null } });
      if (toStaffId === null) await tx.rosterAssignment.delete({ where: { id: a.id } });
      else {
        // An off-duty marker on that day gives way to the duty.
        await tx.rosterAssignment.deleteMany({ where: { rosterId: a.rosterId, staffId: toStaffId, dutyDate: a.dutyDate, id: { not: a.id } } });
        await tx.rosterAssignment.update({
          where: { id: a.id },
          data: { staffId: toStaffId, source: "COVER", locked: true, isCover: true, coverForStaffId: cover?.originalStaffId ?? null, notifiedAt: new Date(), acknowledgedAt: null, acknowledgementState: "AWAITING", needsReview: false },
        });
      }
      await tx.roster.update({ where: { id: a.rosterId }, data: { version } });
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
  await refreshFindings(facilityId, a.roster).catch(() => undefined);
}

export interface ActingUser {
  email: string;
  displayName: string;
}

/** Gives the duty to the proposed person after checking it is still lawful, from current data. */
export async function assignCover(facilityId: string, assignmentId: string, proposalId: string, who: ActingUser, owedBack: boolean) {
  const a = await load(facilityId, assignmentId);
  const prop = await prisma.coverProposal.findFirst({ where: { id: proposalId, facilityId, rosterAssignmentId: assignmentId, status: "PROPOSED" }, include: { proposedStaff: { select: { fullName: true } } } });
  if (!prop) throw new CoverError(409, "That option is no longer open. Ask for the list again.");
  const o = await evaluateSwap(facilityId, { rosterId: a.rosterId, requesterStaffId: a.staffId, requesterAssignmentId: a.id, targetStaffId: prop.proposedStaffId, targetAssignmentId: null }, { enforceCutoff: false, ignoreStart: true });
  if (!o.ok) {
    await prisma.coverProposal.update({ where: { id: prop.id }, data: { status: "DECLINED", respondedAt: new Date(), declineReason: `No longer lawful: ${o.hard[0]}` } });
    throw new CoverError(409, `${prop.proposedStaff.fullName} can no longer take this duty: ${o.hard[0]}`, o.hard);
  }
  const original = a.isCover && a.coverForStaffId ? a.coverForStaffId : a.staffId;
  const absent = await prisma.staff.findUnique({ where: { id: original }, select: { fullName: true } });
  await applyMove(facilityId, a, prop.proposedStaffId, who.email, "Before cover was arranged", { originalStaffId: original });
  const old = (prop.reasons ?? {}) as Record<string, unknown>;
  await prisma.coverProposal.update({ where: { id: prop.id }, data: { status: "ACCEPTED", respondedAt: new Date(), reasons: { ...old, owedBack } as Prisma.InputJsonValue } });
  const day = dayOf(a.dutyDate);
  const what = `${a.shift.name} on ${sayDay(day)}`;
  await notifyStaff(facilityId, prop.proposedStaffId, { type: "cover_asked", title: `You are asked to cover ${what}`, body: `${absent?.fullName ?? "A colleague"} cannot work it. Confirm that you can, or say you cannot.`, linkUrl: "/my-duties", severity: "ACTION" });
  if (original !== prop.proposedStaffId) await notifyStaff(facilityId, original, { type: "cover_arranged", title: `Your ${what} is being covered`, body: `${prop.proposedStaff.fullName} has been asked to take it.`, linkUrl: "/my-duties" });
  await writeAuditLog({
    facilityId, actorEmail: who.email, action: "cover_assigned", entityType: "RosterAssignment", entityId: a.id,
    summary: `${who.displayName} asked ${prop.proposedStaff.fullName} to cover ${absent?.fullName ?? "the absent colleague"}'s ${what} in the ${monthName(a.roster)} roster. ${owedBack ? "The duty is to be worked back." : "It is not owed back."}`,
  });
  return { warnings: o.warnings };
}

/** The person asked to cover answers. Declining moves to the next-ranked option automatically. */
export async function respondToCover(facilityId: string, assignmentId: string, staffId: string, accept: boolean, reason: string, who: ActingUser) {
  const a = await prisma.rosterAssignment.findFirst({ where: { id: assignmentId, facilityId, staffId, isCover: true, acknowledgementState: { in: ["AWAITING", "ESCALATED"] } }, include: { shift: true, roster: true, staff: { select: { fullName: true } } } });
  if (!a) throw new CoverError(404, "There is no cover waiting for your answer on that duty.");
  const day = dayOf(a.dutyDate);
  const what = `${a.shift.name} on ${sayDay(day)}`;
  const accepted = await prisma.coverProposal.findFirst({ where: { rosterAssignmentId: a.id, proposedStaffId: staffId, status: "ACCEPTED" }, orderBy: { createdAt: "desc" } });
  const owedBack = Boolean(((accepted?.reasons ?? {}) as { owedBack?: boolean }).owedBack);
  const absentId = a.coverForStaffId;

  if (accept) {
    await prisma.rosterAssignment.update({ where: { id: a.id }, data: { acknowledgementState: "CONFIRMED", acknowledgedAt: new Date() } });
    if (owedBack && absentId) {
      const absent = await prisma.staff.findUnique({ where: { id: absentId }, select: { fullName: true } });
      await writePair({ facilityId, debtorId: absentId, creditorId: staffId, duties: 1, reason: "ABSENCE_COVER", description: `${absent?.fullName ?? "A colleague"} was away for ${what}, covered by ${a.staff.fullName}` });
    }
    await notifyDeciders(facilityId, { type: "cover_confirmed", title: `${a.staff.fullName} confirmed cover`, body: `${what} is covered.`, linkUrl: "/my-duties" }, who.email);
    await writeAuditLog({ facilityId, actorEmail: who.email, action: "cover_confirmed", entityType: "RosterAssignment", entityId: a.id, summary: `${who.displayName} confirmed they will cover ${what}.${owedBack ? " One duty is now owed back by the person who was away." : ""}` });
    return { outcome: "confirmed" as const };
  }

  if (reason.trim().length < 5) throw new CoverError(400, "Say why you cannot, in a few words.");
  if (accepted) await prisma.coverProposal.update({ where: { id: accepted.id }, data: { status: "DECLINED", respondedAt: new Date(), declineReason: reason } });
  const next = await prisma.coverProposal.findMany({ where: { rosterAssignmentId: a.id, status: "PROPOSED" }, orderBy: { rank: "asc" }, include: { proposedStaff: { select: { fullName: true } } } });
  for (const n of next) {
    const o = await evaluateSwap(facilityId, { rosterId: a.rosterId, requesterStaffId: staffId, requesterAssignmentId: a.id, targetStaffId: n.proposedStaffId, targetAssignmentId: null }, { enforceCutoff: false, ignoreStart: true });
    if (!o.ok) {
      await prisma.coverProposal.update({ where: { id: n.id }, data: { status: "DECLINED", respondedAt: new Date(), declineReason: `No longer lawful: ${o.hard[0]}` } });
      continue;
    }
    await applyMove(facilityId, a, n.proposedStaffId, who.email, "Before cover moved to the next person", { originalStaffId: absentId ?? staffId });
    await prisma.coverProposal.update({ where: { id: n.id }, data: { status: "ACCEPTED", respondedAt: new Date(), reasons: { ...((n.reasons ?? {}) as object), owedBack } as Prisma.InputJsonValue } });
    await notifyStaff(facilityId, n.proposedStaffId, { type: "cover_asked", title: `You are asked to cover ${what}`, body: "A colleague could not take it. Confirm that you can, or say you cannot.", linkUrl: "/my-duties", severity: "ACTION" });
    await notifyDeciders(facilityId, { type: "cover_moved", title: `${a.staff.fullName} cannot cover ${what}`, body: `${n.proposedStaff.fullName} was asked next. Reason given: ${reason}`, linkUrl: "/attendance" });
    await writeAuditLog({ facilityId, actorEmail: who.email, action: "cover_declined", entityType: "RosterAssignment", entityId: a.id, summary: `${who.displayName} could not cover ${what}: ${reason}. ${n.proposedStaff.fullName} was asked next.` });
    return { outcome: "moved" as const, to: n.proposedStaff.fullName };
  }
  // Nobody is left. The duty goes back to being unfilled and the in-charge is told.
  await applyMove(facilityId, a, null, who.email, "Before an unfilled duty was left open");
  await prisma.coverProposal.updateMany({ where: { rosterAssignmentId: a.id, status: "PROPOSED" }, data: { status: "EXPIRED" } });
  await notifyDeciders(facilityId, { type: "cover_unfilled", title: `Nobody is left to cover ${what}`, body: `${a.staff.fullName} could not take it and no other lawful option remains. The duty is unfilled.`, linkUrl: `/rosters/${a.rosterId}`, severity: "URGENT" });
  await writeAuditLog({ facilityId, actorEmail: who.email, action: "cover_unfilled", entityType: "RosterAssignment", entityId: a.id, summary: `${who.displayName} could not cover ${what}: ${reason}. No lawful option was left, so the duty is unfilled.` });
  return { outcome: "unfilled" as const };
}

/** Cover nobody has confirmed in time is escalated once. */
export async function syncCover(facilityId: string) {
  const f = await prisma.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { coverAckWindowHours: true, coverAckUrgentHours: true } });
  const waiting = await prisma.rosterAssignment.findMany({
    where: { facilityId, isCover: true, acknowledgementState: "AWAITING", notifiedAt: { not: null }, roster: { status: "PUBLISHED" } },
    include: { shift: true, staff: { select: { fullName: true } } },
  });
  const now = Date.now();
  for (const w of waiting) {
    const startsIn = w.dutyDate.getTime() - now;
    const hours = startsIn < DAY ? f.coverAckUrgentHours : f.coverAckWindowHours;
    if (now - w.notifiedAt!.getTime() < hours * 3_600_000) continue;
    const moved = await prisma.rosterAssignment.updateMany({ where: { id: w.id, acknowledgementState: "AWAITING" }, data: { acknowledgementState: "ESCALATED" } });
    if (moved.count === 0) continue;
    await notifyDeciders(facilityId, {
      type: "cover_unconfirmed", title: `${w.staff.fullName} has not confirmed cover`,
      body: `${w.shift.name} on ${sayDay(dayOf(w.dutyDate))} was handed to them ${hours} ${hours === 1 ? "hour" : "hours"} ago with no answer. Until they confirm it is not covered.`, linkUrl: "/cover", severity: "ACTION",
    });
  }
}
