// The facility dashboard: one read that gathers what the home page shows.
// Every figure is counted from the facility's own records; nothing is
// estimated, and an empty facility gets zeros rather than made-up values.
import { demandOn } from "../../engine/demand.js";
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { allowRoles, caller, READ_ROLES } from "../../middleware/facilityAccess.js";
import { isoDate } from "../../lib/labels.js";
import { rostersByUnit } from "../../lib/unitDemand.js";
import { WARD_FACILITY_TYPES } from "./rosters.js";

export const dashboardRouter = Router();

function utcDay(offset = 0): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offset));
}

dashboardRouter.get("/", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId, departmentId: ownWard } = caller(req);
  const today = utcDay();
  const weekStart = utcDay(-6);
  const tomorrow = utcDay(1);
  const month = today.getUTCMonth() + 1;
  const year = today.getUTCFullYear();

  const todayHoliday = await prisma.publicHoliday.findFirst({ where: { OR: [{ facilityId }, { facilityId: null }], date: today }, select: { id: true } });
  const [statusGroups, shifts, todayAssignments, todayAttendance, onLeaveToday, monthRosters, nextRosters, leavePending, swapsPending, returns, weekAssignments, weekAttendance] =
    await Promise.all([
      prisma.staff.groupBy({ by: ["status"], where: { facilityId }, _count: { _all: true } }),
      prisma.shift.findMany({
        where: { facilityId, active: true, countsAsDuty: true, isOnCall: false },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, code: true, colour: true, startTime: true, endTime: true, minStaff: true, weekendMinStaff: true, holidayMinStaff: true },
      }),
      prisma.rosterAssignment.groupBy({ by: ["shiftId"], where: { facilityId, dutyDate: today }, _count: { _all: true } }),
      prisma.attendance.groupBy({ by: ["status"], where: { facilityId, dutyDate: today }, _count: { _all: true } }),
      prisma.leaveRequest.count({ where: { facilityId, status: "APPROVED", startDate: { lte: today }, endDate: { gte: today } } }),
      prisma.roster.findMany({
        where: { facilityId, month, year },
        select: { id: true, status: true, version: true, publishedAt: true, attendanceCompleteness: true, hasUnresolvedConflicts: true },
      }),
      prisma.roster.findMany({
        where: { facilityId, month: month === 12 ? 1 : month + 1, year: month === 12 ? year + 1 : year },
        select: { status: true },
      }),
      prisma.leaveRequest.count({ where: { facilityId, status: "SUBMITTED" } }),
      prisma.dutySwap.count({ where: { facilityId, status: "ACCEPTED" } }),
      prisma.leaveRequest.groupBy({ by: ["returnStatus"], where: { facilityId, returnStatus: { in: ["DUE", "OVERDUE"] } }, _count: { _all: true } }),
      prisma.rosterAssignment.groupBy({ by: ["dutyDate"], where: { facilityId, dutyDate: { gte: weekStart, lt: tomorrow } }, _count: { _all: true } }),
      prisma.attendance.groupBy({ by: ["dutyDate", "status"], where: { facilityId, dutyDate: { gte: weekStart, lt: tomorrow } }, _count: { _all: true } }),
    ]);

  // A hospital has one roster per ward: show the one furthest from published, and count findings across all of them.
  const RANK = ["DRAFT", "GENERATED", "UNDER_REVIEW", "APPROVED", "PUBLISHED", "ARCHIVED"];
  const furthest = <T extends { status: string }>(rows: T[]) => [...rows].sort((a, b) => RANK.indexOf(a.status) - RANK.indexOf(b.status))[0] ?? null;
  const roster = furthest(monthRosters);
  const nextRoster = furthest(nextRosters);
  const findings = monthRosters.length
    ? await prisma.complianceFinding.groupBy({ by: ["severity"], where: { rosterId: { in: monthRosters.map((r) => r.id) }, status: "OPEN" }, _count: { _all: true } })
    : [];

  // A facility that rosters by ward or unit: one line per unit, with its own roster, rule findings and today's cover against its own minimums.
  const facilityRow = await prisma.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { facilityType: true } });
  let units: unknown[] | null = null;
  if (await rostersByUnit(facilityId, facilityRow.facilityType, WARD_FACILITY_TYPES)) {
    const depts = await prisma.department.findMany({
      where: { facilityId, active: true, archivedAt: null, kind: "WARD", ...(ownWard ? { id: ownWard } : {}) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    const unitRosters = monthRosters.length ? await prisma.roster.findMany({ where: { facilityId, month, year, departmentId: { in: depts.map((d) => d.id) } }, select: { id: true, departmentId: true, status: true, version: true } }) : [];
    const rosterIds = unitRosters.map((r) => r.id);
    const [unitFindings, unitToday, demand] = await Promise.all([
      rosterIds.length ? prisma.complianceFinding.groupBy({ by: ["rosterId", "severity"], where: { rosterId: { in: rosterIds }, status: "OPEN" }, _count: { _all: true } }) : [],
      rosterIds.length ? prisma.rosterAssignment.groupBy({ by: ["rosterId", "shiftId"], where: { rosterId: { in: rosterIds }, dutyDate: today }, _count: { _all: true } }) : [],
      prisma.shiftDemand.findMany({ where: { facilityId, departmentId: { in: depts.map((d) => d.id) } } }),
    ]);
    const dayNo = Math.floor(today.getTime() / 86_400_000);
    units = depts.map((d) => {
      const r = unitRosters.find((x) => x.departmentId === d.id) ?? null;
      const need = demand.filter((x) => x.departmentId === d.id);
      const cover = shifts
        .map((sh) => {
          const row = need.find((x) => x.shiftId === sh.id);
          const needed = row
            ? demandOn({ minStaff: row.minStaff, minByCadre: {}, weekendMinStaff: row.weekendMinStaff, holidayMinStaff: row.holidayMinStaff }, dayNo, todayHoliday ? [dayNo] : []).minStaff
            : 0;
          const scheduled = r ? unitToday.filter((t) => t.rosterId === r.id && t.shiftId === sh.id).reduce((n, t) => n + t._count._all, 0) : 0;
          return { code: sh.code, name: sh.name, colour: sh.colour, needed, scheduled };
        })
        .filter((c) => c.needed > 0 || c.scheduled > 0);
      const count = (sev: string) => (r ? unitFindings.filter((f) => f.rosterId === r.id && f.severity === sev).reduce((n, f) => n + f._count._all, 0) : 0);
      return { id: d.id, name: d.name, rosterId: r?.id ?? null, status: r?.status ?? null, version: r?.version ?? null, openBlocks: count("BLOCK"), openWarnings: count("WARN"), cover };
    });
  }

  const staffBy = Object.fromEntries(statusGroups.map((g) => [g.status, g._count._all]));
  const scheduledByShift = Object.fromEntries(todayAssignments.map((g) => [g.shiftId, g._count._all]));
  const attBy = Object.fromEntries(todayAttendance.map((g) => [g.status, g._count._all]));
  const retBy = Object.fromEntries(returns.map((g) => [g.returnStatus, g._count._all]));
  const findBy = Object.fromEntries(findings.map((g) => [g.severity, g._count._all]));

  const week = Array.from({ length: 7 }, (_, i) => {
    const d = utcDay(i - 6);
    const key = isoDate(d);
    const scheduled = weekAssignments.filter((a) => isoDate(a.dutyDate) === key).reduce((n, a) => n + a._count._all, 0);
    const rows = weekAttendance.filter((a) => isoDate(a.dutyDate) === key);
    const sum = (...s: string[]) => rows.filter((r) => s.includes(r.status)).reduce((n, r) => n + r._count._all, 0);
    return { date: key, scheduled, present: sum("PRESENT", "LATE", "OFFICIAL_ASSIGNMENT"), absent: sum("ABSENT"), recorded: rows.reduce((n, r) => n + r._count._all, 0) };
  });

  res.json({
    date: isoDate(today),
    staff: {
      total: statusGroups.reduce((n, g) => n + g._count._all, 0),
      active: staffBy.ACTIVE ?? 0,
      onLeaveToday,
    },
    today: {
      scheduled: todayAssignments.reduce((n, g) => n + g._count._all, 0),
      recorded: todayAttendance.reduce((n, g) => n + g._count._all, 0),
      present: (attBy.PRESENT ?? 0) + (attBy.LATE ?? 0) + (attBy.OFFICIAL_ASSIGNMENT ?? 0),
      late: attBy.LATE ?? 0,
      absent: attBy.ABSENT ?? 0,
      // Today's minimum: weekends and public holidays may ask for fewer.
      shifts: shifts.map(({ weekendMinStaff, holidayMinStaff, ...s }) => ({
        ...s, minStaff: demandOn({ minStaff: s.minStaff, minByCadre: {}, weekendMinStaff, holidayMinStaff }, Math.floor(today.getTime() / 86_400_000), todayHoliday ? [Math.floor(today.getTime() / 86_400_000)] : []).minStaff,
        scheduled: scheduledByShift[s.id] ?? 0,
      })),
    },
    roster: roster
      ? {
          status: roster.status,
          version: roster.version,
          publishedAt: roster.publishedAt,
          attendanceCompleteness: roster.attendanceCompleteness,
          hasUnresolvedConflicts: roster.hasUnresolvedConflicts,
          openBlocks: findBy.BLOCK ?? 0,
          openWarnings: findBy.WARN ?? 0,
        }
      : null,
    month,
    year,
    nextMonthStatus: nextRoster?.status ?? null,
    units,
    waiting: { leave: leavePending, swaps: swapsPending, returnsDue: retBy.DUE ?? 0, returnsOverdue: retBy.OVERDUE ?? 0 },
    week,
  });
});
