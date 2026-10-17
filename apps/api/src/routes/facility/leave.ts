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
import { holidayDays } from "../../lib/holidays.js";
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
const SEED: { code: string; name: string; colour: string; counts: boolean; paid: boolean; short?: boolean; debt?: boolean }[] = [
  { code: "L", name: "Annual", colour: "#25619f", counts: true, paid: true },
  { code: "S", name: "Study", colour: "#6b4f9e", counts: false, paid: true },
  { code: "SK", name: "Sick", colour: "#b56b12", counts: false, paid: true },
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
      isShortAbsence: Boolean(t.short), createsDutyDebt: Boolean(t.debt), returnDateSetBy: t.short ? "STAFF_CONFIRMS" : "IN_CHARGE",
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
    types: types.map((t) => ({ id: t.id, code: t.code, name: t.name, colour: t.colour, countsAgainstEntitlement: t.countsAgainstEntitlement, deductionBasis: t.deductionBasis })),
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
      where: { facilityId, status: "APPROVED", staffId: { not: staffId }, startDate: { lte: dateFromDay(endDay) }, endDate: { gte: dateFromDay(startDay) }, staff: { cadreId: person.cadreId } },
      select: { staffId: true, startDate: true, endDate: true },
    }),
  ]);
  const perDay = shifts.reduce((n, s) => n + (((s.minByCadre ?? {}) as Record<string, number>)[person.cadreId!] ?? 0), 0);
  const cadre = person.cadre?.name ?? "staff";
  const pl = (w: string) => (/(fe|f)$/i.test(w) ? w.replace(/(fe|f)$/i, "ves") : /(s|x|ch|sh)$/i.test(w) ? `${w}es` : /[^aeiou]y$/i.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`);
  if (perDay === 0) return { summary: [`No shift sets a minimum number of ${pl(cadre.toLowerCase())}, so this leave does not put a minimum at risk.`], riskDates: [], needsReview: false };

  const risk: number[] = [];
  let lowest = Infinity;
  for (let d = startDay; d <= endDay; d++) {
    const onLeave = new Set(away.filter((a) => dayFromDate(a.startDate) <= d && dayFromDate(a.endDate) >= d).map((a) => a.staffId));
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

type Row = Prisma.LeaveRequestGetPayload<{ include: { staff: { select: { id: true; fullName: true; cadre: { select: { name: true } } } }; leaveType: { select: { id: true; name: true; code: true; colour: true } } } }>;

const include = {
  staff: { select: { id: true, fullName: true, cadre: { select: { name: true } } } },
  leaveType: { select: { id: true, name: true, code: true, colour: true } },
} as const;

function present(r: Row) {
  return {
    id: r.id, staffId: r.staffId, staffName: r.staff.fullName, cadreName: r.staff.cadre?.name ?? null,
    leaveTypeId: r.leaveTypeId, typeName: r.leaveType.name, typeCode: r.leaveType.code, colour: r.leaveType.colour,
    startDate: isoOf(dayFromDate(r.startDate)), endDate: isoOf(dayFromDate(r.endDate)), days: r.daysDeducted, reason: r.reason,
    status: r.status, submittedAt: r.submittedAt, decidedBy: r.decidedBy, decidedAt: r.decidedAt, decisionNote: r.decisionNote,
    expectedReturnDate: r.expectedReturnDate ? isoOf(dayFromDate(r.expectedReturnDate)) : null, conflictsPublishedRoster: r.conflictsPublishedRoster,
  };
}

leaveRouter.get("/requests", async (req, res) => {
  const who = caller(req);
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
  const end = isoToDay(input.endDate);
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
      reason: input.reason || null, status: "SUBMITTED", submittedAt: new Date(), createdBy: who.email,
    },
    include,
  });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "leave_requested", entityType: "LeaveRequest", entityId: request.id,
    summary: `${who.displayName} ${onBehalf ? `asked for ${person.fullName}'s` : "asked for"} ${type.name.toLowerCase()} leave, ${sayRange(start, end)}.`,
  });
  await notifyDeciders(who.facilityId, {
    type: "leave_request_submitted", title: `${person.fullName} asked for ${type.name.toLowerCase()} leave`,
    body: `${sayRange(start, end)}, ${days} ${days === 1 ? "day" : "days"}. It is waiting for a decision.`, linkUrl: "/leave", severity: "ACTION",
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
  const end = dayFromDate(row.endDate);
  let conflicts = false;
  if (input.decision === "approve") {
    const impact = await impactOf(who.facilityId, row.staffId, start, end);
    if (impact.needsReview && !input.reviewedImpact) {
      return res.status(409).json({ error: "review_impact", message: "Cover would be short on some of these days. Read the coverage impact and tick that you have reviewed it.", impact });
    }
    const mine = await prisma.rosterAssignment.count({
      where: { staffId: row.staffId, shift: { countsAsDuty: true }, dutyDate: { gte: row.startDate, lte: row.endDate }, roster: { status: { in: ["APPROVED", "PUBLISHED"] } } },
    });
    conflicts = mine > 0;
  }
  const updated = await prisma.leaveRequest.update({
    where: { id: row.id },
    data: {
      status: input.decision === "approve" ? "APPROVED" : "REJECTED", decidedBy: who.email, decidedAt: new Date(), decisionNote: input.note || null,
      ...(input.decision === "approve" ? { expectedReturnDate: dateFromDay(end + 1), conflictsPublishedRoster: conflicts } : {}),
    },
    include,
  });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: input.decision === "approve" ? "leave_approved" : "leave_rejected", entityType: "LeaveRequest", entityId: row.id,
    summary: `${who.displayName} ${input.decision === "approve" ? "approved" : "rejected"} ${row.staff.fullName}'s ${row.leaveType.name.toLowerCase()} leave, ${sayRange(start, end)}${input.note ? `. Note: ${input.note}` : ""}.`,
  });
  await notifyStaff(who.facilityId, row.staffId, {
    type: "leave_decided", title: `Your ${row.leaveType.name.toLowerCase()} leave was ${input.decision === "approve" ? "approved" : "not approved"}`,
    body: `${sayRange(start, end)}.${input.note ? ` ${input.note}` : ""}`, linkUrl: "/leave", severity: "INFO",
  });
  res.json({
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
