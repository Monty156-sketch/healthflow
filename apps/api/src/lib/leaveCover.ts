// Planned absence. When leave is going to take someone off duties that are
// already published, the better answer is a swap: the person works another day
// near their return and a colleague works the duty, with no debt on either
// side. Cover is the fallback. This finds both for each affected duty, shows
// swaps first, and says what each would do to the ledger.
import { prisma } from "./prisma.js";
import { writeAuditLog } from "./audit.js";
import { notifyStaff } from "./notify.js";
import { openBalances } from "./ledger.js";
import { assignCover, coverOptions, CoverError, type CoverOption } from "./cover.js";
import { sayDay } from "../engine/time.js";
import { evaluateSwap } from "../routes/facility/swaps.js";

const DAY = 86_400_000;
const dayOf = (d: Date) => Math.floor(d.getTime() / DAY);
const isoOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const WINDOW = 14; // how far past the leave a swapped-in duty may fall
const MAX_DUTIES = 6; // duties given full options in one plan

export class LeaveCoverError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface SwapOption {
  targetStaffId: string;
  targetAssignmentId: string;
  name: string;
  date: string;
  shift: string;
  score: number;
  reasons: string[];
  warnings: string[];
}

export interface AffectedDuty {
  assignmentId: string;
  date: string;
  shift: string;
  swaps: SwapOption[];
  cover: CoverOption[];
  coverSummary: string | null;
  ledger: string;
  openSwap: boolean;
}

async function load(facilityId: string, leaveRequestId: string) {
  const r = await prisma.leaveRequest.findFirst({ where: { id: leaveRequestId, facilityId }, include: { staff: { select: { id: true, fullName: true, cadreId: true } }, leaveType: true } });
  if (!r) throw new LeaveCoverError(404, "That leave was not found.");
  if (r.status !== "SUBMITTED" && r.status !== "APPROVED") throw new LeaveCoverError(409, "This leave is closed, so there is nothing to arrange cover for.");
  const today = Math.floor(Date.now() / DAY);
  const start = Math.max(dayOf(r.startDate), today);
  const end = r.isOpenEnded ? start + 30 : dayOf(r.endDate);
  return { r, start, end, today };
}

/** Duties on published rosters that this leave would take the person off. */
async function dutiesIn(facilityId: string, staffId: string, start: number, end: number) {
  return prisma.rosterAssignment.findMany({
    where: { facilityId, staffId, shift: { countsAsDuty: true, isOnCall: false }, dutyDate: { gte: new Date(start * DAY), lte: new Date(end * DAY) }, roster: { status: "PUBLISHED" } },
    include: { shift: true },
    orderBy: { dutyDate: "asc" },
  });
}

function ledgerSentence(typeName: string, debt: boolean, name: string) {
  return debt
    ? `${typeName} leave is worked back. If a colleague covers, ${name} owes one duty and the colleague is owed one. A swap leaves no debt.`
    : `${typeName} leave is not worked back, so cover leaves no debt. A swap leaves none either.`;
}

/** Exchanges that would put the person on another day soon after they return. */
async function findSwapPartners(facilityId: string, leaverId: string, duty: Awaited<ReturnType<typeof dutiesIn>>[number], leaveEnd: number, leaveStart: number): Promise<SwapOption[]> {
  const candidates = await prisma.rosterAssignment.findMany({
    where: {
      facilityId, roster: { status: "PUBLISHED" }, staffId: { not: leaverId }, locked: false, shift: { countsAsDuty: true, isOnCall: false }, staff: { status: "ACTIVE" },
      dutyDate: { gt: new Date(leaveEnd * DAY), lte: new Date((leaveEnd + WINDOW) * DAY) },
    },
    include: { shift: true, staff: { select: { id: true, fullName: true, cadreId: true } } },
  });
  const open = await prisma.dutySwap.findMany({ where: { facilityId, status: { in: ["REQUESTED", "ACCEPTED"] } }, select: { requesterAssignmentId: true, targetAssignmentId: true } });
  const busy = new Set(open.flatMap((o) => [o.requesterAssignmentId, o.targetAssignmentId]));
  const counts = await prisma.rosterAssignment.groupBy({ by: ["staffId", "rosterId"], where: { rosterId: { in: [...new Set([duty.rosterId, ...candidates.map((c) => c.rosterId)])] }, shift: { countsAsDuty: true } }, _count: { _all: true } });
  const countIn = (rosterId: string) => new Map(counts.filter((c) => c.rosterId === rosterId).map((c) => [c.staffId, c._count._all]));
  const balances = await openBalances(facilityId);
  const mate = await prisma.staff.findMany({ where: { facilityId, status: "ACTIVE" }, select: { id: true, cadreId: true } });
  const avgOf = (cadreId: string | null, rosterId: string) => {
    const count = countIn(rosterId);
    const m = mate.filter((x) => x.cadreId === cadreId);
    return m.reduce((n, x) => n + (count.get(x.id) ?? 0), 0) / Math.max(1, m.length);
  };
  const scored = candidates
    .filter((c) => !busy.has(c.id) && dayOf(c.dutyDate) > leaveEnd && !(dayOf(c.dutyDate) >= leaveStart && dayOf(c.dutyDate) <= leaveEnd))
    .map((c) => {
      const d = dayOf(c.dutyDate);
      const reasons: string[] = [];
      let score = 0;
      if (d - leaveEnd <= 7) { score += 4; reasons.push("falls within a week of their return"); }
      if (c.shiftId === duty.shiftId) { score += 3; reasons.push("same shift as the one given up"); }
      if (!(balances.get(c.staffId)?.owed)) { score += 2; reasons.push("the colleague is not owed any duties"); } else reasons.push("the colleague is already owed a duty");
      if ((countIn(c.rosterId).get(c.staffId) ?? 0) <= avgOf(c.staff.cadreId, c.rosterId)) { score += 2; reasons.push("the colleague is at or below the average this month"); }
      return { c, score, reasons, d };
    })
    .sort((a, b) => b.score - a.score || a.d - b.d)
    .slice(0, 8);

  const out: SwapOption[] = [];
  for (const s of scored) {
    if (out.length >= 3) break;
    const o = await evaluateSwap(facilityId, { rosterId: duty.rosterId, requesterStaffId: leaverId, requesterAssignmentId: duty.id, targetStaffId: s.c.staffId, targetAssignmentId: s.c.id }, { enforceCutoff: false });
    if (!o.ok) continue;
    out.push({ targetStaffId: s.c.staffId, targetAssignmentId: s.c.id, name: s.c.staff.fullName, date: isoOf(s.d), shift: s.c.shift.name, score: s.score, reasons: s.reasons, warnings: o.warnings });
  }
  return out;
}

export async function leaveCoverPlan(facilityId: string, leaveRequestId: string) {
  const { r, start, end } = await load(facilityId, leaveRequestId);
  const duties = await dutiesIn(facilityId, r.staffId, start, end);
  const open = await prisma.dutySwap.findMany({ where: { facilityId, status: { in: ["REQUESTED", "ACCEPTED"] }, requesterAssignmentId: { in: duties.map((d) => d.id) } }, select: { requesterAssignmentId: true } });
  const asked = new Set(open.map((o) => o.requesterAssignmentId));
  const out: AffectedDuty[] = [];
  for (const [i, d] of duties.entries()) {
    const item: AffectedDuty = {
      assignmentId: d.id, date: isoOf(dayOf(d.dutyDate)), shift: d.shift.name, swaps: [], cover: [], coverSummary: null,
      ledger: ledgerSentence(r.leaveType.name, r.leaveType.createsDutyDebt, r.staff.fullName), openSwap: asked.has(d.id),
    };
    if (i < MAX_DUTIES && !item.openSwap) {
      if (!r.isOpenEnded) item.swaps = await findSwapPartners(facilityId, r.staffId, d, end, start);
      try {
        const c = await coverOptions(facilityId, d.id);
        item.cover = c.options.slice(0, 3);
        item.coverSummary = c.summary;
      } catch (err) {
        if (!(err instanceof CoverError)) throw err;
        item.coverSummary = err.message;
      }
    }
    out.push(item);
  }
  return {
    staff: { id: r.staffId, name: r.staff.fullName },
    owedBack: r.leaveType.createsDutyDebt,
    duties: out,
    more: Math.max(0, duties.length - MAX_DUTIES),
    note: duties.length === 0 ? "None of these days has a published duty for this person, so there is nothing to arrange." : `${duties.length} published ${duties.length === 1 ? "duty falls" : "duties fall"} in these dates. Swaps are shown first because they leave no debt, and can be with a duty in the following month.`,
  };
}

/** Asks a colleague, on the absent person's behalf, to exchange duties. Follows the ordinary swap steps from here. */
export async function requestLeaveSwap(facilityId: string, leaveRequestId: string, assignmentId: string, targetAssignmentId: string, by: { email: string; displayName: string }) {
  const { r } = await load(facilityId, leaveRequestId);
  const mine = await prisma.rosterAssignment.findFirst({ where: { id: assignmentId, facilityId, staffId: r.staffId }, include: { shift: true } });
  if (!mine) throw new LeaveCoverError(404, "That duty was not found.");
  const theirs = await prisma.rosterAssignment.findFirst({ where: { id: targetAssignmentId, facilityId, roster: { status: "PUBLISHED" } }, include: { shift: true, staff: { select: { id: true, fullName: true } } } });
  if (!theirs) throw new LeaveCoverError(404, "The colleague's duty was not found.");
  const dup = await prisma.dutySwap.findFirst({ where: { requesterAssignmentId: mine.id, status: { in: ["REQUESTED", "ACCEPTED"] } } });
  if (dup) throw new LeaveCoverError(409, "A swap is already open for this duty.");
  const o = await evaluateSwap(facilityId, { rosterId: mine.rosterId, requesterStaffId: r.staffId, requesterAssignmentId: mine.id, targetStaffId: theirs.staffId, targetAssignmentId: theirs.id }, { enforceCutoff: false });
  if (!o.ok) throw new LeaveCoverError(409, o.hard[0] ?? "That swap is not possible.");
  const swap = await prisma.dutySwap.create({
    data: {
      facilityId, rosterId: mine.rosterId, swapType: "EXCHANGE", requesterStaffId: r.staffId, requesterAssignmentId: mine.id, targetStaffId: theirs.staffId, targetAssignmentId: theirs.id,
      reason: `Arranged by ${by.displayName} for ${r.leaveType.name.toLowerCase()} leave`, revalidationResult: { ok: true, warnings: o.warnings, at: new Date().toISOString() },
    },
  });
  await notifyStaff(facilityId, theirs.staffId, { type: "swap_requested", title: `${r.staff.fullName} asks you to swap duties`, body: `${o.summary!.give} for your ${o.summary!.take}. Arranged by the in-charge because of approved leave.`, linkUrl: "/swaps", severity: "ACTION" });
  await writeAuditLog({ facilityId, actorEmail: by.email, action: "swap_requested", entityType: "DutySwap", entityId: swap.id, summary: `${by.displayName} asked ${theirs.staff.fullName} to swap ${o.summary!.take} for ${r.staff.fullName}'s ${o.summary!.give}, because of leave.` });
  return { swapId: swap.id, warnings: o.warnings };
}

/**
 * On approval of a short absence: the best-ranked cover is asked for each duty
 * that has no swap open. Longer absences are left to the in-charge, who sees
 * the same list. Returns what was done and what could not be.
 */
export async function coverOnApproval(facilityId: string, leaveRequestId: string, by: { email: string; displayName: string }) {
  const { r, start, end } = await load(facilityId, leaveRequestId);
  const fac = await prisma.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { autoAssignCover: true } });
  const days = end - start + 1;
  if (!fac.autoAssignCover || !r.leaveType.isShortAbsence || r.isOpenEnded || days > r.leaveType.maxDaysForAutoCover) return null;
  const duties = await dutiesIn(facilityId, r.staffId, start, end);
  const open = await prisma.dutySwap.findMany({ where: { facilityId, status: { in: ["REQUESTED", "ACCEPTED"] }, requesterAssignmentId: { in: duties.map((d) => d.id) } }, select: { requesterAssignmentId: true } });
  const asked = new Set(open.map((o) => o.requesterAssignmentId));
  const started: string[] = [];
  const unfilled: string[] = [];
  for (const d of duties.slice(0, 10)) {
    if (asked.has(d.id)) continue;
    const what = `${d.shift.name} on ${sayDay(dayOf(d.dutyDate))}`;
    try {
      const c = await coverOptions(facilityId, d.id);
      if (c.options.length === 0) { unfilled.push(what); continue; }
      await assignCover(facilityId, d.id, c.options[0].proposalId, by, r.leaveType.createsDutyDebt);
      started.push(`${what}: ${c.options[0].name}`);
    } catch (err) {
      if (!(err instanceof CoverError)) throw err;
      unfilled.push(what);
    }
  }
  if (started.length + unfilled.length === 0) return null;
  await writeAuditLog({ facilityId, actorEmail: by.email, action: "leave_cover_started", entityType: "LeaveRequest", entityId: leaveRequestId, summary: `Approving ${r.staff.fullName}'s ${r.leaveType.name.toLowerCase()} leave started cover for ${started.length} ${started.length === 1 ? "duty" : "duties"}${unfilled.length ? `; ${unfilled.length} could not be covered` : ""}.` });
  return { asked: started, unfilled };
}
