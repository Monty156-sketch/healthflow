// Attendance (Part 6, 2.3): one day at a time, from the published roster.
// The officer only touches the people who were scheduled. Anyone on approved
// leave is shown as On Leave and anyone without a duty as Off Duty; neither
// can be marked. Night duty belongs to the date the shift started.
import { Router } from "express";
import { z } from "zod";
import type { AttendanceStatus } from "@healthflow/db";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { allowRoles, caller, READ_ROLES } from "../../middleware/facilityAccess.js";
import { effectiveEnd, overlaps } from "../../lib/leaveWindow.js";
import { sayDay } from "../../engine/time.js";
import { staffInMyWard, wardStaffFilter } from "../../lib/wardScope.js";

export const attendanceRouter = Router();
attendanceRouter.use(allowRoles(...READ_ROLES));

const DAY = 86_400_000;
const dayOf = (d: Date) => Math.floor(d.getTime() / DAY);
const dateOf = (n: number) => new Date(n * DAY);
const isoOf = (n: number) => dateOf(n).toISOString().slice(0, 10);
const todayDay = () => Math.floor(Date.now() / DAY);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const CODE: Record<AttendanceStatus, string> = { PRESENT: "P", LATE: "LT", ABSENT: "A", EXCUSED: "E", OFF_DUTY: "OD", ON_LEAVE: "OL", OFFICIAL_ASSIGNMENT: "OA" };
const MARKABLE = ["PRESENT", "LATE", "ABSENT", "EXCUSED"] as const;

/** Every published roster for the month: one for the facility, or one per ward in a hospital. */
async function rostersFor(facilityId: string, day: number, departmentId?: string | null) {
  const d = dateOf(day);
  // A ward in-charge records attendance on their own ward's roster only.
  return prisma.roster.findMany({ where: { facilityId, status: "PUBLISHED", month: d.getUTCMonth() + 1, year: d.getUTCFullYear(), ...(departmentId ? { departmentId } : {}) } });
}

async function leaveOn(facilityId: string, from: number, to: number) {
  const rows = await prisma.leaveRequest.findMany({
    where: { facilityId, status: "APPROVED", startDate: { lte: dateOf(to) }, OR: [{ endDate: { gte: dateOf(from) } }, { actualReturnDate: null }] },
    include: { leaveType: true },
  });
  return rows.filter((r) => overlaps(r, from, to)).map((r) => ({ staffId: r.staffId, start: dayOf(r.startDate), end: effectiveEnd(r), official: r.leaveType.code === "OA", typeName: r.leaveType.name }));
}

// ------------------------------------------------------------- one day

attendanceRouter.get("/day", async (req, res) => {
  const who = caller(req);
  const { facilityId } = who;
  const q = z.object({ date: z.string().regex(ISO) }).safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "invalid_input", message: "Choose a date." });
  const day = dayOf(new Date(`${q.data.date}T00:00:00Z`));
  const [facility, rosters] = await Promise.all([prisma.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { attendanceCutoffDays: true } }), rostersFor(facilityId, day, who.departmentId)]);
  const future = day > todayDay();
  const late = todayDay() - day > facility.attendanceCutoffDays;
  const base = { date: q.data.date, cutoffDays: facility.attendanceCutoffDays, needsReason: late };

  let blocked: string | null = null;
  if (future) blocked = "This date has not happened yet, so attendance cannot be recorded.";
  else if (!rosters.length) blocked = "There is no published roster for this month. Attendance is recorded against a published roster.";

  const [leave, assignments, everyone] = await Promise.all([
    leaveOn(facilityId, day, day),
    rosters.length
      ? prisma.rosterAssignment.findMany({
          where: { rosterId: { in: rosters.map((r) => r.id) }, dutyDate: dateOf(day), shift: { countsAsDuty: true } },
          include: { staff: { select: { id: true, fullName: true, cadre: { select: { name: true } } } }, shift: true },
          orderBy: [{ shift: { sortOrder: "asc" } }, { staff: { fullName: "asc" } }],
        })
      : Promise.resolve([]),
    prisma.staff.findMany({ where: { facilityId, status: "ACTIVE", ...wardStaffFilter(who) }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
  ]);
  const records = await prisma.attendance.findMany({ where: { facilityId, dutyDate: dateOf(day), rosterAssignmentId: { in: assignments.map((a) => a.id) } } });
  const byAssignment = new Map(records.map((r) => [r.rosterAssignmentId, r]));
  const leaveOf = new Map(leave.map((l) => [l.staffId, l]));
  const assigned = new Set(assignments.map((a) => a.staffId));

  const accepted = await prisma.coverProposal.findMany({
    where: { facilityId, dutyDate: dateOf(day), status: "ACCEPTED" },
    include: { proposedStaff: { select: { fullName: true } } },
  });
  const absentNames = new Map((await prisma.staff.findMany({ where: { id: { in: accepted.map((c) => c.absentStaffId) } }, select: { id: true, fullName: true } })).map((p) => [p.id, p.fullName]));
  const coverFor = new Map(accepted.map((c) => [c.rosterAssignmentId, absentNames.get(c.absentStaffId) ?? null]));
  const shifts = new Map<string, { id: string; name: string; code: string; startTime: string | null; endTime: string | null; people: unknown[] }>();
  for (const a of assignments) {
    if (leaveOf.has(a.staffId)) continue; // approved leave wins; the roster page already flags the clash
    const s = shifts.get(a.shiftId) ?? { id: a.shift.id, name: a.shift.name, code: a.shift.code, startTime: a.shift.startTime, endTime: a.shift.endTime, people: [] };
    const r = byAssignment.get(a.id);
    s.people.push({
      assignmentId: a.id, staffId: a.staffId, name: a.staff.fullName, cadre: a.staff.cadre?.name ?? null, isCover: a.isCover, coverForName: coverFor.get(a.id) ?? null, coverState: a.isCover ? a.acknowledgementState : null,
      record: r ? { status: r.status, minutesLate: r.minutesLate, note: r.note, needsReview: r.needsReview, corrected: Boolean(r.correctedAt), originalStatus: r.originalStatus } : null,
    });
    shifts.set(a.shiftId, s);
  }
  const review = await prisma.attendance.findMany({
    where: { facilityId, dutyDate: dateOf(day), needsReview: true, rosterAssignmentId: null },
    include: { staff: { select: { fullName: true } } },
  });
  res.json({
    ...base,
    review: review.map((r) => ({ id: r.id, name: r.staff.fullName, status: r.status, minutesLate: r.minutesLate })),
    covered: accepted.map((c) => ({ absentName: absentNames.get(c.absentStaffId) ?? "", coverName: c.proposedStaff.fullName })),
    canRecord: !blocked,
    blocked,
    shifts: [...shifts.values()],
    onLeave: everyone.filter((p) => leaveOf.has(p.id)).map((p) => ({ staffId: p.id, name: p.fullName, official: leaveOf.get(p.id)!.official, typeName: leaveOf.get(p.id)!.typeName })),
    offDuty: everyone.filter((p) => !assigned.has(p.id) && !leaveOf.has(p.id)).map((p) => ({ staffId: p.id, name: p.fullName })),
  });
});

const recordInput = z.object({
  date: z.string().regex(ISO),
  reason: z.string().trim().max(300).optional().default(""),
  records: z
    .array(
      z.object({
        assignmentId: z.string(),
        status: z.enum(MARKABLE),
        minutesLate: z.number().int().min(1).max(720).nullish(),
        note: z.string().trim().max(200).optional().default(""),
      }),
    )
    .min(1)
    .max(300),
});

attendanceRouter.put("/day", async (req, res) => {
  const who = caller(req);
  const input = parseOr400(recordInput, req.body, res);
  if (!input) return;
  const day = dayOf(new Date(`${input.date}T00:00:00Z`));
  if (day > todayDay()) return res.status(409).json({ error: "future", message: "That date has not happened yet." });
  const rosters = await rostersFor(who.facilityId, day, who.departmentId);
  if (!rosters.length) return res.status(409).json({ error: "not_published", message: "There is no published roster for that month." });
  const facility = await prisma.facility.findUniqueOrThrow({ where: { id: who.facilityId }, select: { attendanceCutoffDays: true } });
  const late = todayDay() - day > facility.attendanceCutoffDays;

  const assignments = await prisma.rosterAssignment.findMany({
    where: { id: { in: input.records.map((r) => r.assignmentId) }, rosterId: { in: rosters.map((r) => r.id) }, dutyDate: dateOf(day) },
    include: { staff: { select: { fullName: true } } },
  });
  if (assignments.length !== new Set(input.records.map((r) => r.assignmentId)).size) {
    return res.status(400).json({ error: "invalid_input", message: "Some of those duties are not on this day's roster. Reload the page and try again." });
  }
  const leave = await leaveOn(who.facilityId, day, day);
  const onLeave = new Set(leave.map((l) => l.staffId));
  const existing = await prisma.attendance.findMany({ where: { rosterAssignmentId: { in: assignments.map((a) => a.id) } } });
  const had = new Map(existing.map((e) => [e.rosterAssignmentId, e]));
  const byId = new Map(assignments.map((a) => [a.id, a]));

  const fields: Record<string, string> = {};
  let changing = false;
  for (const r of input.records) {
    const a = byId.get(r.assignmentId)!;
    if (onLeave.has(a.staffId)) return res.status(409).json({ error: "on_leave", message: `${a.staff.fullName} is on approved leave on this day and cannot be marked.` });
    if (r.status === "LATE" && !r.minutesLate) fields[`late:${r.assignmentId}`] = `Say how many minutes late ${a.staff.fullName} was.`;
    const prev = had.get(r.assignmentId);
    if (prev && prev.status !== r.status) changing = true;
  }
  if (Object.keys(fields).length) return res.status(400).json({ error: "invalid_input", fields, message: "Some people marked late have no minutes." });
  if ((late || changing) && input.reason.length < 10) {
    return res.status(400).json({
      error: "reason_required",
      message: late ? `This is more than ${facility.attendanceCutoffDays} days ago. Give a reason (at least 10 characters); it is kept as a correction.` : "You are changing something already recorded. Give a reason (at least 10 characters).",
    });
  }

  let written = 0;
  for (const r of input.records) {
    const a = byId.get(r.assignmentId)!;
    const prev = had.get(r.assignmentId);
    if (prev && prev.status === r.status && (prev.minutesLate ?? null) === (r.minutesLate ?? null) && (prev.note ?? "") === r.note) continue;
    const data = {
      status: r.status, minutesLate: r.status === "LATE" ? (r.minutesLate ?? null) : null, note: r.note || null,
    };
    if (!prev) {
      await prisma.attendance.create({
        data: {
          facilityId: who.facilityId, staffId: a.staffId, rosterId: a.rosterId, rosterAssignmentId: a.id, dutyDate: a.dutyDate, shiftId: a.shiftId,
          ...data, recordedBy: who.email, ...(late ? { correctedBy: who.email, correctedAt: new Date(), correctionReason: input.reason } : {}),
        },
      });
    } else {
      await prisma.attendance.update({
        where: { id: prev.id },
        data: { ...data, originalStatus: prev.originalStatus ?? prev.status, correctedBy: who.email, correctedAt: new Date(), correctionReason: input.reason, needsReview: false },
      });
    }
    written++;
    await writeAuditLog({
      facilityId: who.facilityId, actorEmail: who.email, action: prev ? "attendance_corrected" : "attendance_recorded", entityType: "Attendance", entityId: a.id,
      before: prev ? { status: prev.status, minutesLate: prev.minutesLate } : undefined, after: data, reason: prev ? input.reason : null,
      summary: prev
        ? `${who.displayName} changed ${a.staff.fullName}'s attendance on ${sayDay(day)} from ${prev.status.toLowerCase().replace("_", " ")} to ${r.status.toLowerCase()}. Reason: ${input.reason}`
        : `${who.displayName} recorded ${a.staff.fullName} as ${r.status.toLowerCase()} on ${sayDay(day)}.`,
    });
  }
  for (const id of new Set(assignments.map((a) => a.rosterId))) await refreshCompleteness(id, who.facilityId, day);
  res.json({ saved: written });
});

/** The officer has looked at a flagged record and it stands. */
attendanceRouter.post("/:id/resolve", async (req, res) => {
  const who = caller(req);
  const row = await prisma.attendance.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId }, include: { staff: { select: { fullName: true } } } });
  if (!row || !(await staffInMyWard(who, row.staffId))) return res.status(404).json({ error: "not_found" });
  await prisma.attendance.update({ where: { id: row.id }, data: { needsReview: false } });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "attendance_review_cleared", entityType: "Attendance", entityId: row.id,
    summary: `${who.displayName} checked ${row.staff.fullName}'s attendance on ${sayDay(dayOf(row.dutyDate))} after the duty changed, and kept it as ${row.status.toLowerCase().replace("_", " ")}.`,
  });
  res.json({ ok: true });
});

/** Share of past duties in the roster's month that have a record. */
async function refreshCompleteness(rosterId: string, facilityId: string, day: number) {
  const d = dateOf(day);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const until = dateOf(Math.min(todayDay(), dayOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)))));
  const [due, done] = await Promise.all([
    prisma.rosterAssignment.count({ where: { rosterId, shift: { countsAsDuty: true }, dutyDate: { gte: first, lte: until } } }),
    prisma.attendance.count({ where: { facilityId, rosterId, dutyDate: { gte: first, lte: until } } }),
  ]);
  await prisma.roster.update({ where: { id: rosterId }, data: { attendanceCompleteness: due ? Math.min(1, done / due) : null } });
}

// ------------------------------------------------------------- the month

attendanceRouter.get("/month", async (req, res) => {
  const who = caller(req);
  const { facilityId } = who;
  const q = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "invalid_input", message: "Choose a month." });
  const [y, m] = q.data.month.split("-").map(Number);
  const first = dayOf(new Date(Date.UTC(y, m - 1, 1)));
  const last = dayOf(new Date(Date.UTC(y, m, 0)));
  const rosters = await rostersFor(facilityId, first, who.departmentId);
  const roster = rosters.length ? rosters : null;
  const [staff, leave, assignments, records] = await Promise.all([
    prisma.staff.findMany({
      where: { facilityId, status: "ACTIVE", ...wardStaffFilter(who) }, orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, staffNo: true, cadre: { select: { name: true } }, department: { select: { id: true, name: true } } },
    }),
    leaveOn(facilityId, first, last),
    roster ? prisma.rosterAssignment.findMany({ where: { rosterId: { in: roster.map((r) => r.id) }, shift: { countsAsDuty: true } }, select: { staffId: true, dutyDate: true } }) : Promise.resolve([]),
    prisma.attendance.findMany({ where: { facilityId, dutyDate: { gte: dateOf(first), lte: dateOf(last) } }, select: { staffId: true, dutyDate: true, status: true, needsReview: true } }),
  ]);
  const cells: { staffId: string; date: string; code: string; needsReview?: boolean }[] = [];
  const rec = new Map(records.map((r) => [`${r.staffId}|${dayOf(r.dutyDate)}`, r]));
  const duty = new Set(assignments.map((a) => `${a.staffId}|${dayOf(a.dutyDate)}`));
  const today = todayDay();
  for (const s of staff) {
    for (let d = first; d <= Math.min(last, today); d++) {
      const r = rec.get(`${s.id}|${d}`);
      const l = leave.find((x) => x.staffId === s.id && d >= x.start && d <= x.end);
      if (r) cells.push({ staffId: s.id, date: isoOf(d), code: CODE[r.status], ...(r.needsReview ? { needsReview: true } : {}) });
      else if (l) cells.push({ staffId: s.id, date: isoOf(d), code: l.official ? "OA" : "OL" });
      else if (duty.has(`${s.id}|${d}`)) continue; // scheduled and not yet recorded: left blank on purpose
      else if (roster) cells.push({ staffId: s.id, date: isoOf(d), code: "OD" });
    }
  }
  res.json({
    month: q.data.month, published: Boolean(roster), completeness: (() => { const v = (roster ?? []).map((r) => r.attendanceCompleteness).filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; })(),
    staff: staff.map((s) => ({ id: s.id, name: s.fullName, cadreName: s.cadre?.name ?? null, departmentId: s.department?.id ?? null, departmentName: s.department?.name ?? null })),
    departments: [...new Map(staff.filter((s) => s.department).map((s) => [s.department!.id, s.department!])).values()],
    cells,
  });
});
