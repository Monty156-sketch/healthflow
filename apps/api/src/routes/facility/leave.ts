// Leave (Part 5, 5.1 to 5.3): request, decide and see it on a calendar.
// Approving a request tells the approver what it does to cover, in plain
// words, before they decide. Approved leave is read by the roster engine, so
// a person on leave is not rostered.
import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@healthflow/db";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { notifyDeciders, notifyStaff } from "../../lib/notify.js";
import { overlaps, todayDay } from "../../lib/leaveWindow.js";
import { holidayDays } from "../../lib/holidays.js";
import { expectedBack, liveStatus, resumptionOf, syncReturns } from "../../lib/returns.js";
import { LeaveCoverError, coverOnApproval, leaveCoverPlan, requestLeaveSwap } from "../../lib/leaveCover.js";
import { ReinstateError, reinstate, reinstatementPlan } from "../../lib/reinstate.js";
import { parseOr400 } from "../../lib/validate.js";
import { allowRoles, caller, READ_ROLES } from "../../middleware/facilityAccess.js";
import { isoOf, sayDay, sayRange, dayOf } from "../../engine/time.js";

export const leaveRouter = Router();

const DECIDERS = READ_ROLES; // supervisor, roster manager and facility admin
const dayFromDate = (d: Date) => Math.floor(d.getTime() / 86_400_000);
const dateFromDay = (n: number) => new Date(n * 86_400_000);
const isoToDay = (iso: string) => dayFromDate(new Date(`${iso}T00:00:00Z`));

// ------------------------------------------------------------- types

const NOTE = "Confirm this matches your facility's existing leave practice before the first leave year.";
const SEED: { code: string; name: string; colour: string; counts: boolean; paid: boolean; short?: boolean; debt?: boolean; confirms?: boolean }[] = [
  { code: "L", name: "Annual", colour: "#25619f", counts: true, paid: true },
  { code: "S", name: "Study", colour: "#6b4f9e", counts: false, paid: true },
  { code: "SK", name: "Sick", colour: "#b56b12", counts: false, paid: true, confirms: true },
  { code: "MAT", name: "Maternity", colour: "#9e3f6b", counts: false, paid: true },
  { code: "PAT", name: "Paternity", colour: "#2f7a8c", counts: false, paid: true },
  { code: "COM", name: "Compassionate", colour: "#5b6770", counts: false, paid: true, short: true },
  { code: "OA", name: "Official assignment", colour: "#1f7a4d", counts: false, paid: true },
  { code: "U", name: "Unpaid", colour: "#77878a", counts: false, paid: false },
  { code: "PERM", name: "Permission", colour: "#8c6d1f", counts: false, paid: true, short: true, debt: true },
];

export async function ensureLeaveTypes(facilityId: string) {
  if ((await prisma.leaveType.count({ where: { facilityId } })) > 0) return;
  await prisma.leaveType.createMany({
    data: SEED.map((t, i) => ({
      facilityId, code: t.code, name: t.name, colour: t.colour, isPaid: t.paid, countsAgainstEntitlement: t.counts, sortOrder: i + 1,
      isShortAbsence: Boolean(t.short), createsDutyDebt: Boolean(t.debt), returnDateSetBy: t.short || t.confirms ? "STAFF_CONFIRMS" : "IN_CHARGE",
    })),
  });
}

leaveRouter.get("/types", async (req, res) => {
  const { facilityId } = caller(req);
  await ensureLeaveTypes(facilityId);
  const types = await prisma.leaveType.findMany({ where: { facilityId, active: true }, orderBy: { sortOrder: "asc" } });
  const people = DECIDERS.includes(caller(req).role)
    ? (await prisma.staff.findMany({ where: { facilityId, status: "ACTIVE" }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } })).map((p) => ({ id: p.id, name: p.fullName }))
    : [];
  res.json({
    note: NOTE,
    people,
    myStaffId: caller(req).staffId,
    types: types.map((t) => ({ id: t.id, code: t.code, name: t.name, colour: t.colour, countsAgainstEntitlement: t.countsAgainstEntitlement, deductionBasis: t.deductionBasis, returnDateSetBy: t.returnDateSetBy })),
  });
});

// ------------------------------------------------------------- days

/**
 * Days a request takes off the balance, by the type's deduction basis.
 * Calendar days count every day. Working days skip weekends and public holidays.
 * Scheduled duty days count the days the person is rostered on an approved or
 * published roster; where no roster covers the dates yet, every calendar day counts.
 */
export async function leaveDays(facilityId: string, staffId: string, startDay: number, endDay: number, basis: string) {
  const holidays = await holidayDays(facilityId, startDay, endDay);
  let days = 0;
  let skippedHolidays = 0;
  let note: string | null = null;
  if (basis === "SCHEDULED_DUTY_DAYS") {
    const duties = await prisma.rosterAssignment.findMany({
      where: { facilityId, staffId, shift: { countsAsDuty: true }, dutyDate: { gte: dateFromDay(startDay), lte: dateFromDay(endDay) }, roster: { status: { in: ["APPROVED", "PUBLISHED"] } } },
      select: { dutyDate: true },
    });
    const set = new Set(duties.map((d) => dayFromDate(d.dutyDate)));
    if (set.size > 0) days = set.size;
    else {
      days = endDay - startDay + 1;
      note = "No approved roster covers these dates yet, so every calendar day is counted.";
    }
    return { days, skippedHolidays, note };
  }
  for (let d = startDay; d <= endDay; d++) {
    const wd = new Date(d * 86_400_000).getUTCDay();
    if (basis === "WORKING_DAYS_MON_FRI") {
      if (wd < 1 || wd > 5) continue;
      if (holidays.has(d)) {
        skippedHolidays++;
        continue;
      }
    }
    days++;
  }
  return { days, skippedHolidays, note };
}

// ------------------------------------------------------------- coverage impact

interface Impact {
  summary: string[];
  riskDates: string[];
  needsReview: boolean;
}

async function impactOf(facilityId: string, staffId: string, startDay: number, endDay: number): Promise<Impact> {
  const person = await prisma.staff.findFirst({ where: { id: staffId, facilityId }, include: { cadre: { select: { id: true, name: true } } } });
  if (!person?.cadreId) return { summary: ["This person has no cadre set, so the effect on cover cannot be worked out."], riskDates: [], needsReview: false };
  const [shifts, peers, away] = await Promise.all([
    prisma.shift.findMany({ where: { facilityId, countsAsDuty: true, active: true, isOnCall: false } }),
    prisma.staff.findMany({ where: { facilityId, cadreId: person.cadreId, status: "ACTIVE" }, select: { id: true } }),
    prisma.leaveRequest.findMany({
      where: { facilityId, status: "APPROVED", staffId: { not: staffId }, startDate: { lte: dateFromDay(endDay) }, OR: [{ endDate: { gte: dateFromDay(startDay) } }, { actualReturnDate: null }], staff: { cadreId: person.cadreId } },
      select: { staffId: true, startDate: true, endDate: true, isOpenEnded: true, actualReturnDate: true, returnStatus: true },
    }),
  ]);
  const perDay = shifts.reduce((n, s) => n + (((s.minByCadre ?? {}) as Record<string, number>)[person.cadreId!] ?? 0), 0);
  const cadre = person.cadre?.name ?? "staff";
  const pl = (w: string) => (/(fe|f)$/i.test(w) ? w.replace(/(fe|f)$/i, "ves") : /(s|x|ch|sh)$/i.test(w) ? `${w}es` : /[^aeiou]y$/i.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`);
  if (perDay === 0) return { summary: [`No shift sets a minimum number of ${pl(cadre.toLowerCase())}, so this leave does not put a minimum at risk.`], riskDates: [], needsReview: false };

  const risk: number[] = [];
  let lowest = Infinity;
  for (let d = startDay; d <= endDay; d++) {
    const onLeave = new Set(away.filter((a) => overlaps(a, d, d)).map((a) => a.staffId));
    const available = peers.filter((p) => p.id !== staffId && !onLeave.has(p.id)).length;
    lowest = Math.min(lowest, available);
    if (available < perDay) risk.push(d);
  }
  const plural = (n: number) => `${n} ${n === 1 ? cadre.toLowerCase() : pl(cadre.toLowerCase())}`;
  const summary = [
    `Approving this leaves ${plural(lowest)} available${startDay === endDay ? ` on ${sayDay(startDay)}` : ` from ${sayRange(startDay, endDay)}`}. The shifts need ${plural(perDay)} between them each day.`,
  ];
  if (risk.length) summary.push(`Cover would be short on ${risk.length <= 6 ? risk.map(sayDay).join(", ") : `${risk.length} of those days, starting ${sayDay(risk[0])}`}.`);
  else summary.push("Every day still has enough people to meet the minimums.");
  return { summary, riskDates: risk.map(isoOf), needsReview: risk.length > 0 };
}

// ------------------------------------------------------------- balance

async function balanceOf(facilityId: string, staffId: string, leaveTypeId: string, year: number) {
  const type = await prisma.leaveType.findFirst({ where: { id: leaveTypeId, facilityId } });
  if (!type?.countsAgainstEntitlement) return null;
  const ent = await prisma.leaveEntitlement.findUnique({ where: { staffId_leaveTypeId_leaveYear: { staffId, leaveTypeId, leaveYear: year } } });
  const taken = await prisma.leaveRequest.aggregate({
    where: { facilityId, staffId, leaveTypeId, status: "APPROVED", startDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
    _sum: { daysDeducted: true },
  });
  const pending = await prisma.leaveRequest.aggregate({
    where: { facilityId, staffId, leaveTypeId, status: "SUBMITTED", startDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
    _sum: { daysDeducted: true },
  });
  const entitled = ent ? ent.daysEntitled + ent.daysCarriedOver : null;
  return { configured: Boolean(ent), entitled, taken: taken._sum.daysDeducted ?? 0, pending: pending._sum.daysDeducted ?? 0, remaining: entitled === null ? null : entitled - (taken._sum.daysDeducted ?? 0) };
}

// ------------------------------------------------------------- requests

type Row = Prisma.LeaveRequestGetPayload<{ include: { staff: { select: { id: true; fullName: true; cadre: { select: { name: true } } } }; leaveType: { select: { id: true; name: true; code: true; colour: true; returnDateSetBy: true } } } }>;

const include = {
  staff: { select: { id: true, fullName: true, cadre: { select: { name: true } } } },
  leaveType: { select: { id: true, name: true, code: true, colour: true, returnDateSetBy: true } },
} as const;

function present(r: Row) {
  return {
    id: r.id, staffId: r.staffId, staffName: r.staff.fullName, cadreName: r.staff.cadre?.name ?? null,
    leaveTypeId: r.leaveTypeId, typeName: r.leaveType.name, typeCode: r.leaveType.code, colour: r.leaveType.colour,
    startDate: isoOf(dayFromDate(r.startDate)), endDate: isoOf(dayFromDate(r.endDate)), days: r.daysDeducted, reason: r.reason,
    status: r.status, submittedAt: r.submittedAt, decidedBy: r.decidedBy, decidedAt: r.decidedAt, decisionNote: r.decisionNote,
    expectedReturnDate: r.expectedReturnDate ? isoOf(dayFromDate(r.expectedReturnDate)) : null, conflictsPublishedRoster: r.conflictsPublishedRoster,
    isOpenEnded: r.isOpenEnded, returnDateSetBy: r.leaveType.returnDateSetBy, extensionOfId: r.extensionOfId,
    returnStatus: r.status === "APPROVED" ? liveStatus(r) : null,
    actualReturnDate: r.actualReturnDate ? isoOf(dayFromDate(r.actualReturnDate)) : null,
  };
}

leaveRouter.get("/requests", async (req, res) => {
  const who = caller(req);
  await syncReturns(who.facilityId);
  const isDecider = DECIDERS.includes(who.role);
  if (!isDecider && !who.staffId) return res.json({ requests: [] });
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const mine = req.query.mine === "1" || !isDecider;
  const rows = await prisma.leaveRequest.findMany({
    where: {
      facilityId: who.facilityId,
      ...(mine ? { staffId: who.staffId ?? "none" } : {}),
      ...(status === "open" ? { status: "SUBMITTED" } : status && ["APPROVED", "REJECTED", "CANCELLED"].includes(status) ? { status: status as "APPROVED" | "REJECTED" | "CANCELLED" } : {}),
    },
    include,
    orderBy: [{ startDate: "desc" }],
    take: 200,
  });
  res.json({ requests: rows.map(present) });
});

const requestInput = z.object({
  staffId: z.string().optional(),
  leaveTypeId: z.string().min(1, "Choose a type of leave."),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date."),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose an end date."),
  reason: z.string().trim().max(300, "Keep the reason under 300 characters.").optional(),
  openEnded: z.boolean().optional(),
});

leaveRouter.post("/requests", async (req, res) => {
  const who = caller(req);
  const input = parseOr400(requestInput, req.body, res);
  if (!input) return;
  const onBehalf = Boolean(input.staffId) && input.staffId !== who.staffId;
  if (onBehalf && !DECIDERS.includes(who.role)) return res.status(403).json({ error: "forbidden", message: "You can only ask for your own leave." });
  const staffId = input.staffId ?? who.staffId;
  if (!staffId) return res.status(400).json({ error: "no_staff_record", message: "Your account is not linked to a staff record, so leave cannot be requested for you. Ask your in-charge." });
  const person = await prisma.staff.findFirst({ where: { id: staffId, facilityId: who.facilityId, status: "ACTIVE" } });
  if (!person) return res.status(404).json({ error: "not_found", message: "That person is not an active member of staff here." });
  await ensureLeaveTypes(who.facilityId);
  const type = await prisma.leaveType.findFirst({ where: { id: input.leaveTypeId, facilityId: who.facilityId, active: true } });
  if (!type) return res.status(400).json({ error: "invalid_input", fields: { leaveTypeId: "Choose a type of leave." } });

  const start = isoToDay(input.startDate);
  const openEnded = Boolean(input.openEnded);
  if (openEnded && type.returnDateSetBy !== "STAFF_CONFIRMS") {
    return res.status(400).json({ error: "invalid_input", fields: { openEnded: `${type.name} leave has a set return date, so it cannot be open-ended.` } });
  }
  const end = openEnded ? start : isoToDay(input.endDate);
  if (end < start) return res.status(400).json({ error: "invalid_input", fields: { endDate: "The end date is before the start date." } });
  if (end - start > 400) return res.status(400).json({ error: "invalid_input", fields: { endDate: "That is longer than a year. Request it in parts." } });
  if (type.maxConsecutiveDays && end - start + 1 > type.maxConsecutiveDays) {
    return res.status(400).json({ error: "invalid_input", fields: { endDate: `${type.name} leave is limited to ${type.maxConsecutiveDays} days at a time.` } });
  }
  const clash = await prisma.leaveRequest.findFirst({
    where: { staffId, status: { in: ["SUBMITTED", "APPROVED"] }, startDate: { lte: dateFromDay(end) }, endDate: { gte: dateFromDay(start) } },
    include: { leaveType: { select: { name: true } } },
  });
  if (clash) {
    return res.status(409).json({
      error: "overlap",
      message: `${person.fullName} already has ${clash.leaveType.name.toLowerCase()} leave from ${sayRange(dayFromDate(clash.startDate), dayFromDate(clash.endDate))}. Change the dates or cancel that one first.`,
    });
  }
  const { days } = await leaveDays(who.facilityId, staffId, start, end, type.deductionBasis);
  const request = await prisma.leaveRequest.create({
    data: {
      facilityId: who.facilityId, staffId, leaveTypeId: type.id, startDate: dateFromDay(start), endDate: dateFromDay(end), daysDeducted: days,
      reason: input.reason || null, status: "SUBMITTED", submittedAt: new Date(), createdBy: who.email, isOpenEnded: openEnded,
    },
    include,
  });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "leave_requested", entityType: "LeaveRequest", entityId: request.id,
    summary: `${who.displayName} ${onBehalf ? `asked for ${person.fullName}'s` : "asked for"} ${type.name.toLowerCase()} leave, ${openEnded ? `from ${sayDay(start)} with no end date` : sayRange(start, end)}.`,
  });
  await notifyDeciders(who.facilityId, {
    type: "leave_request_submitted", title: `${person.fullName} asked for ${type.name.toLowerCase()} leave`,
    body: `${openEnded ? `From ${sayDay(start)}, no end date` : `${sayRange(start, end)}, ${days} ${days === 1 ? "day" : "days"}`}. It is waiting for a decision.`, linkUrl: "/leave", severity: "ACTION",
  }, who.email);
  res.status(201).json({ request: present(request) });
});

/** A live preview for the request form: days and balance, before anything is sent. */
leaveRouter.get("/preview", async (req, res) => {
  const who = caller(req);
  const q = z.object({ leaveTypeId: z.string(), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), staffId: z.string().optional() }).safeParse(req.query);
  if (!q.success) return res.json({ days: null });
  const staffId = q.data.staffId && DECIDERS.includes(who.role) ? q.data.staffId : who.staffId;
  const type = await prisma.leaveType.findFirst({ where: { id: q.data.leaveTypeId, facilityId: who.facilityId } });
  const start = isoToDay(q.data.startDate);
  const end = isoToDay(q.data.endDate);
  if (!type || end < start || !staffId) return res.json({ days: null });
  const counted = await leaveDays(who.facilityId, staffId, start, end, type.deductionBasis);
  const days = counted.days;
  const balance = await balanceOf(who.facilityId, staffId, type.id, new Date(q.data.startDate).getUTCFullYear());
  res.json({ days, basis: type.deductionBasis, skippedHolidays: counted.skippedHolidays, note: counted.note, balance: balance && { ...balance, after: balance.remaining === null ? null : balance.remaining - days } });
});

leaveRouter.get("/requests/:id", async (req, res) => {
  const who = caller(req);
  const row = await prisma.leaveRequest.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId }, include });
  if (!row) return res.status(404).json({ error: "not_found" });
  const isDecider = DECIDERS.includes(who.role);
  if (!isDecider && row.staffId !== who.staffId) return res.status(404).json({ error: "not_found" });
  const start = dayFromDate(row.startDate);
  const end = dayFromDate(row.endDate);
  const [impact, balance, history] = await Promise.all([
    isDecider ? impactOf(who.facilityId, row.staffId, start, end) : null,
    balanceOf(who.facilityId, row.staffId, row.leaveTypeId, row.startDate.getUTCFullYear()),
    isDecider
      ? prisma.leaveRequest.findMany({ where: { staffId: row.staffId, id: { not: row.id }, status: "APPROVED" }, include, orderBy: { startDate: "desc" }, take: 6 })
      : [],
  ]);
  res.json({ request: present(row), impact, balance, history: history.map(present) });
});

const decideInput = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(300).optional(),
  reviewedImpact: z.boolean().optional(),
  expectedReturnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

leaveRouter.post("/requests/:id/decide", allowRoles(...DECIDERS), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(decideInput, req.body, res);
  if (!input) return;
  const row = await prisma.leaveRequest.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId }, include });
  if (!row) return res.status(404).json({ error: "not_found" });
  if (row.status !== "SUBMITTED") return res.status(409).json({ error: "already_decided", message: "This request has already been decided." });
  if (input.decision === "reject" && !input.note) return res.status(400).json({ error: "invalid_input", fields: { note: "Say why, so the person knows." } });

  const start = dayFromDate(row.startDate);
  let end = dayFromDate(row.endDate);
  let days = row.daysDeducted;
  let resumeDay: number | null = row.isOpenEnded ? null : end + 1;
  // The in-charge may set the date duty resumes, as long as it is after the first day of leave.
  if (input.decision === "approve" && input.expectedReturnDate && !row.isOpenEnded) {
    const back = isoToDay(input.expectedReturnDate);
    if (back <= start) return res.status(400).json({ error: "invalid_input", fields: { expectedReturnDate: "Duty cannot resume on or before the first day of leave." } });
    if (back - start > 401) return res.status(400).json({ error: "invalid_input", fields: { expectedReturnDate: "That is longer than a year." } });
    if (back !== end + 1) {
      const clash = await prisma.leaveRequest.findFirst({
        where: { staffId: row.staffId, id: { not: row.id }, status: { in: ["SUBMITTED", "APPROVED"] }, startDate: { lte: dateFromDay(back - 1) }, endDate: { gte: dateFromDay(start) } },
      });
      if (clash) return res.status(409).json({ error: "overlap", message: "That date runs into other leave this person already has." });
    }
    end = back - 1;
    resumeDay = back;
    const type = await prisma.leaveType.findUnique({ where: { id: row.leaveTypeId } });
    const basis = type?.deductionBasis ?? "CALENDAR_DAYS";
    days = (await leaveDays(who.facilityId, row.staffId, start, end, basis)).days;
    // Public holidays inside the leave are not leave days, matching the resumption calculation.
    if (basis === "CALENDAR_DAYS") days = Math.max(0, days - (await holidayDays(who.facilityId, start, end)).size);
  }
  let conflicts = false;
  if (input.decision === "approve") {
    const impact = await impactOf(who.facilityId, row.staffId, start, end);
    if (impact.needsReview && !input.reviewedImpact) {
      return res.status(409).json({ error: "review_impact", message: "Cover would be short on some of these days. Read the coverage impact and tick that you have reviewed it.", impact });
    }
    const mine = await prisma.rosterAssignment.count({
      where: { staffId: row.staffId, shift: { countsAsDuty: true }, dutyDate: { gte: row.startDate, lte: dateFromDay(end) }, roster: { status: { in: ["APPROVED", "PUBLISHED"] } } },
    });
    conflicts = mine > 0;
  }
  const updated = await prisma.leaveRequest.update({
    where: { id: row.id },
    data: {
      status: input.decision === "approve" ? "APPROVED" : "REJECTED", decidedBy: who.email, decidedAt: new Date(), decisionNote: input.note || null,
      ...(input.decision === "approve"
        ? { endDate: dateFromDay(end), daysDeducted: days, expectedReturnDate: resumeDay === null ? null : dateFromDay(resumeDay), returnStatus: "NOT_DUE" as const, conflictsPublishedRoster: conflicts }
        : {}),
    },
    include,
  });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: input.decision === "approve" ? "leave_approved" : "leave_rejected", entityType: "LeaveRequest", entityId: row.id,
    summary: `${who.displayName} ${input.decision === "approve" ? "approved" : "rejected"} ${row.staff.fullName}'s ${row.leaveType.name.toLowerCase()} leave, ${row.isOpenEnded ? `from ${sayDay(start)} with no end date` : sayRange(start, end)}${input.decision === "approve" && resumeDay !== null && resumeDay !== dayFromDate(row.endDate) + 1 ? `, back on duty ${sayDay(resumeDay)}` : ""}${input.note ? `. Note: ${input.note}` : ""}.`,
  });
  if (input.decision === "approve" && row.extensionOfId) {
    await prisma.leaveRequest.updateMany({ where: { id: row.extensionOfId, facilityId: who.facilityId, actualReturnDate: null }, data: { returnStatus: "EXTENDED" } });
  }
  await notifyStaff(who.facilityId, row.staffId, {
    type: "leave_decided", title: `Your ${row.leaveType.name.toLowerCase()} leave was ${input.decision === "approve" ? "approved" : "not approved"}`,
    body: `${row.isOpenEnded ? `From ${sayDay(start)}, no end date.` : `${sayRange(start, end)}${resumeDay !== null && input.decision === "approve" ? `. Back on duty ${sayDay(resumeDay)}` : ""}.`}${input.note ? ` ${input.note}` : ""}`, linkUrl: "/leave", severity: "INFO",
  });
  let cover: Awaited<ReturnType<typeof coverOnApproval>> = null;
  if (input.decision === "approve" && conflicts) cover = await coverOnApproval(who.facilityId, row.id, { email: who.email, displayName: who.displayName }).catch(() => null);
  res.json({
    cover,
    request: present(updated),
    warning: conflicts ? "This person has duties on an approved or published roster in these dates. Regenerate or edit that roster so they are not rostered while away." : null,
  });
});

leaveRouter.post("/requests/:id/cancel", async (req, res) => {
  const who = caller(req);
  const row = await prisma.leaveRequest.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId }, include });
  if (!row) return res.status(404).json({ error: "not_found" });
  const own = row.staffId === who.staffId;
  if (!own && !DECIDERS.includes(who.role)) return res.status(404).json({ error: "not_found" });
  if (!["SUBMITTED", "APPROVED"].includes(row.status)) return res.status(409).json({ error: "not_cancellable", message: "This request is already closed." });
  if (row.status === "APPROVED" && own && !DECIDERS.includes(who.role)) return res.status(403).json({ error: "forbidden", message: "Approved leave can only be cancelled by your in-charge. Ask them." });
  const updated = await prisma.leaveRequest.update({ where: { id: row.id }, data: { status: "CANCELLED" }, include });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "leave_cancelled", entityType: "LeaveRequest", entityId: row.id,
    summary: `${who.displayName} cancelled ${own ? "their" : `${row.staff.fullName}'s`} ${row.leaveType.name.toLowerCase()} leave, ${sayRange(dayFromDate(row.startDate), dayFromDate(row.endDate))}.`,
  });
  res.json({ request: present(updated) });
});

// ------------------------------------------------------------- returns

/** Proposes the date duty resumes, with the working. The in-charge can change it. */
leaveRouter.get("/resumption", allowRoles(...DECIDERS), async (req, res) => {
  const who = caller(req);
  const q = z.object({ leaveTypeId: z.string(), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), days: z.coerce.number().int().min(1).max(400) }).safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "invalid_input", message: "Give a leave type, a start date and a number of days." });
  const type = await prisma.leaveType.findFirst({ where: { id: q.data.leaveTypeId, facilityId: who.facilityId } });
  if (!type) return res.status(404).json({ error: "not_found" });
  const r = await resumptionOf(who.facilityId, isoToDay(q.data.startDate), q.data.days, type.deductionBasis);
  res.json({ resumptionDate: isoOf(r.date), lastLeaveDay: isoOf(r.lastLeaveDay), skippedHolidays: r.skippedHolidays, sentence: r.sentence });
});

/** Who is back, who is due, who is overdue and who is away with no end date. */
leaveRouter.get("/returns", allowRoles(...DECIDERS), async (req, res) => {
  const who = caller(req);
  await syncReturns(who.facilityId);
  const today = todayDay();
  const rows = await prisma.leaveRequest.findMany({
    where: { facilityId: who.facilityId, status: "APPROVED", actualReturnDate: null, returnStatus: { not: "EXTENDED" }, startDate: { lte: dateFromDay(today + 14) } },
    include: { ...include, extensions: { where: { status: "SUBMITTED" }, select: { id: true } } },
    orderBy: { endDate: "asc" },
  });
  const item = (r: (typeof rows)[number]) => {
    const back = expectedBack(r);
    return {
      ...present(r), expectedReturnDate: back === null ? null : isoOf(back), daysLate: back !== null && today > back ? today - back : 0,
      daysAway: today - dayFromDate(r.startDate) + 1, extensionPending: r.extensions.length > 0,
    };
  };
  const overdue: ReturnType<typeof item>[] = [];
  const soon: ReturnType<typeof item>[] = [];
  const open: ReturnType<typeof item>[] = [];
  for (const r of rows) {
    if (dayFromDate(r.startDate) > today && !r.extensionOfId) continue; // not started yet (an extension carries on from leave already under way)
    const back = expectedBack(r);
    if (back === null) open.push(item(r));
    else if (today > back) overdue.push(item(r));
    else if (back - today <= 14) soon.push(item(r));
  }
  soon.sort((a, b) => String(a.expectedReturnDate).localeCompare(String(b.expectedReturnDate)));
  overdue.sort((a, b) => b.daysLate - a.daysLate);
  res.json({ today: isoOf(today), overdue, soon, open });
});

const reportInput = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the day they resumed duty.") });

/** The person, or a supervisor on their behalf, says the day they are back on duty. */
leaveRouter.post("/requests/:id/report-back", async (req, res) => {
  const who = caller(req);
  const input = parseOr400(reportInput, req.body, res);
  if (!input) return;
  const row = await prisma.leaveRequest.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId }, include });
  if (!row) return res.status(404).json({ error: "not_found" });
  const own = row.staffId === who.staffId;
  if (!own && !DECIDERS.includes(who.role)) return res.status(404).json({ error: "not_found" });
  if (row.status !== "APPROVED" || row.actualReturnDate || row.returnStatus === "EXTENDED") return res.status(409).json({ error: "not_open", message: "There is no open leave here to report back from." });
  const start = dayFromDate(row.startDate);
  const end = dayFromDate(row.endDate);
  const day = isoToDay(input.date);
  if (day <= start) return res.status(400).json({ error: "invalid_input", fields: { date: "The day back must be after the first day of leave." } });
  if (day > todayDay()) return res.status(400).json({ error: "invalid_input", fields: { date: "That day has not come yet. Report back on the day they resume." } });
  const early = !row.isOpenEnded && day <= end;
  const data: Prisma.LeaveRequestUpdateInput = {
    actualReturnDate: dateFromDay(day), returnStatus: early ? "RETURNED_EARLY" : "CONFIRMED", returnConfirmedAt: new Date(), returnConfirmedBy: who.email,
  };
  if (early) {
    const type = await prisma.leaveType.findUnique({ where: { id: row.leaveTypeId } });
    data.daysDeducted = (await leaveDays(who.facilityId, row.staffId, start, day - 1, type?.deductionBasis ?? "CALENDAR_DAYS")).days;
  }
  if (row.isOpenEnded) data.endDate = dateFromDay(day - 1);
  const updated = await prisma.leaveRequest.update({ where: { id: row.id }, data, include });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "leave_return_confirmed", entityType: "LeaveRequest", entityId: row.id,
    summary: `${who.displayName} confirmed ${own ? "their" : `${row.staff.fullName}'s`} return from ${row.leaveType.name.toLowerCase()} leave on ${sayDay(day)}${early ? ", before the leave was due to end" : day > end + 1 && !row.isOpenEnded ? `, ${day - end - 1} ${day - end - 1 === 1 ? "day" : "days"} after the expected date` : ""}.`,
  });
  if (own) {
    await notifyDeciders(who.facilityId, { type: "return_confirmed", title: `${row.staff.fullName} is back on duty`, body: `Resumed ${sayDay(day)} after ${row.leaveType.name.toLowerCase()} leave.`, linkUrl: "/returns", severity: "INFO" }, who.email);
  } else {
    await notifyStaff(who.facilityId, row.staffId, { type: "return_confirmed", title: "Your return to duty was recorded", body: `Back on duty ${sayDay(day)}.`, linkUrl: "/leave", severity: "INFO" });
  }
  res.json({ request: present(updated) });
});

/** Swaps first, then cover, for each published duty this leave takes the person off. */
leaveRouter.get("/requests/:id/cover-plan", allowRoles(...DECIDERS), async (req, res) => {
  const who = caller(req);
  try {
    res.json(await leaveCoverPlan(who.facilityId, String(req.params.id)));
  } catch (err) {
    if (err instanceof LeaveCoverError) return res.status(err.status).json({ error: "cannot_plan", message: err.message });
    throw err;
  }
});

const swapRequestInput = z.object({ assignmentId: z.string(), targetAssignmentId: z.string() });

/** Asks a colleague to exchange duties on the absent person's behalf. */
leaveRouter.post("/requests/:id/swap-request", allowRoles(...DECIDERS), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(swapRequestInput, req.body, res);
  if (!input) return;
  try {
    res.status(201).json(await requestLeaveSwap(who.facilityId, String(req.params.id), input.assignmentId, input.targetAssignmentId, { email: who.email, displayName: who.displayName }));
  } catch (err) {
    if (err instanceof LeaveCoverError) return res.status(err.status).json({ error: "cannot_swap", message: err.message });
    throw err;
  }
});

/** What would put someone back on the roster after they return. Proposes only. */
leaveRouter.get("/requests/:id/reinstatement", allowRoles(...DECIDERS), async (req, res) => {
  const who = caller(req);
  try {
    res.json(await reinstatementPlan(who.facilityId, String(req.params.id)));
  } catch (err) {
    if (err instanceof ReinstateError) return res.status(err.status).json({ error: "cannot_reinstate", message: err.message });
    throw err;
  }
});

const reinstateInput = z.object({
  items: z.array(z.object({ kind: z.enum(["FILL", "RELIEVE", "CREDIT"]), day: z.number().int().optional(), shiftId: z.string().optional(), assignmentId: z.string().optional() })).min(1, "Choose at least one duty.").max(40),
});

/** Applies the duties the supervisor accepted. Each is checked again first. */
leaveRouter.post("/requests/:id/reinstate", allowRoles(...DECIDERS), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(reinstateInput, req.body, res);
  if (!input) return;
  try {
    res.json(await reinstate(who.facilityId, String(req.params.id), input.items, { email: who.email, displayName: who.displayName }));
  } catch (err) {
    if (err instanceof ReinstateError) return res.status(err.status).json({ error: "cannot_reinstate", message: err.message });
    throw err;
  }
});

const extendInput = z.object({
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the new last day of leave."),
  reason: z.string().trim().max(300).optional(),
});

/** Asks for more time. A linked request starts the day after the leave ends. */
leaveRouter.post("/requests/:id/extend", async (req, res) => {
  const who = caller(req);
  const input = parseOr400(extendInput, req.body, res);
  if (!input) return;
  const row = await prisma.leaveRequest.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId }, include: { ...include, extensions: { where: { status: "SUBMITTED" }, select: { id: true } } } });
  if (!row) return res.status(404).json({ error: "not_found" });
  const own = row.staffId === who.staffId;
  if (!own && !DECIDERS.includes(who.role)) return res.status(404).json({ error: "not_found" });
  if (row.status !== "APPROVED" || row.actualReturnDate || row.isOpenEnded || row.returnStatus === "EXTENDED") {
    return res.status(409).json({ error: "not_extendable", message: "This leave cannot be extended. If the person is already back, record the return instead." });
  }
  if (row.extensions.length > 0) return res.status(409).json({ error: "extension_pending", message: "An extension is already waiting for a decision." });
  const from = dayFromDate(row.endDate) + 1;
  const to = isoToDay(input.endDate);
  if (to < from) return res.status(400).json({ error: "invalid_input", fields: { endDate: `The new last day must be ${sayDay(from)} or later.` } });
  if (to - from > 400) return res.status(400).json({ error: "invalid_input", fields: { endDate: "That is longer than a year. Request it in parts." } });
  const type = await prisma.leaveType.findUnique({ where: { id: row.leaveTypeId } });
  const clash = await prisma.leaveRequest.findFirst({
    where: { staffId: row.staffId, id: { not: row.id }, status: { in: ["SUBMITTED", "APPROVED"] }, startDate: { lte: dateFromDay(to) }, endDate: { gte: dateFromDay(from) } },
  });
  if (clash) return res.status(409).json({ error: "overlap", message: "That runs into other leave this person already has." });
  const { days } = await leaveDays(who.facilityId, row.staffId, from, to, type?.deductionBasis ?? "CALENDAR_DAYS");
  const created = await prisma.leaveRequest.create({
    data: {
      facilityId: who.facilityId, staffId: row.staffId, leaveTypeId: row.leaveTypeId, startDate: dateFromDay(from), endDate: dateFromDay(to), daysDeducted: days,
      reason: input.reason || null, status: "SUBMITTED", submittedAt: new Date(), createdBy: who.email, extensionOfId: row.id,
    },
    include,
  });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "leave_extension_requested", entityType: "LeaveRequest", entityId: created.id,
    summary: `${who.displayName} asked to extend ${own ? "their" : `${row.staff.fullName}'s`} ${row.leaveType.name.toLowerCase()} leave to ${sayDay(to)}.`,
  });
  await notifyDeciders(who.facilityId, {
    type: "leave_extension_requested", title: `${row.staff.fullName} asked for more time`,
    body: `${row.leaveType.name} leave extended to ${sayDay(to)}, ${days} more ${days === 1 ? "day" : "days"}. It is waiting for a decision.`, linkUrl: "/leave", severity: "ACTION",
  }, who.email);
  res.status(201).json({ request: present(created) });
});

// ------------------------------------------------------------- calendar

leaveRouter.get("/calendar", allowRoles(...DECIDERS), async (req, res) => {
  const { facilityId } = caller(req);
  const month = typeof req.query.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const first = dayOf(y, m, 1);
  const last = dayOf(y, m + 1, 1) - 1;
  const [rows, staff, cadres, departments] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { facilityId, status: { in: ["SUBMITTED", "APPROVED"] }, startDate: { lte: dateFromDay(last) }, endDate: { gte: dateFromDay(first) } },
      include,
    }),
    prisma.staff.findMany({
      where: { facilityId, status: "ACTIVE" },
      include: { cadre: { select: { id: true, name: true, code: true, sortOrder: true } }, department: { select: { name: true } } },
      orderBy: { staffNo: "asc" },
    }),
    prisma.cadre.findMany({ where: { facilityId, active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.department.findMany({ where: { facilityId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  res.json({
    month, year: y, monthNumber: m,
    staff: staff.map((s) => ({
      id: s.id, name: s.fullName, staffNo: s.staffNo, cadreId: s.cadreId, cadreCode: s.cadre?.code ?? s.cadre?.name ?? null, cadreName: s.cadre?.name ?? null,
      cadreOrder: s.cadre?.sortOrder ?? 999, departmentId: s.departmentId, departmentName: s.department?.name ?? null,
    })),
    leave: rows.map((r) => ({ id: r.id, staffId: r.staffId, code: r.leaveType.code, typeName: r.leaveType.name, colour: r.leaveType.colour, startDate: isoOf(dayFromDate(r.startDate)), endDate: isoOf(dayFromDate(r.endDate)), pending: r.status === "SUBMITTED" })),
    cadres, departments,
  });
});
