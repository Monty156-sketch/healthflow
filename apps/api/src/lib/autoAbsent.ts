// Marks people absent when their published duty has ended and they never clocked in.
// The record is flagged for review so the administrator checks the facility's book before the month is approved.
// Only facilities with a clock-in location are looked at (without one nobody can clock in), only duties that ended in the
// last 36 hours (so old months are never filled in behind anyone's back), and never someone on approved leave.
import { prisma } from "./prisma.js";
import { asSystem, inFacilityRun } from "./tenant.js";
import { refreshCompleteness } from "../routes/facility/attendance.js";

const DAY = 86_400_000;
const LOOKBACK = 36 * 3_600_000;

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** When a duty ends, in UTC (Ghana keeps UTC). A shift that ends at or before it starts finishes the next morning. */
export function dutyEnd(dutyDate: Date, start: string | null, end: string, overnight: boolean): Date {
  const spill = overnight || (start !== null && minutes(end) <= minutes(start));
  return new Date(dutyDate.getTime() + (spill ? DAY : 0) + minutes(end) * 60_000);
}

export async function runAutoAbsent(now = new Date()): Promise<number> {
  const facilities = await asSystem(() => prisma.facility.findMany({
    where: { status: { in: ["TRIAL", "ACTIVE"] }, geoLat: { not: null }, geoLng: { not: null } },
    select: { id: true },
  }));
  const from = new Date(Math.floor((now.getTime() - LOOKBACK) / DAY) * DAY - DAY);
  const to = new Date(Math.floor(now.getTime() / DAY) * DAY);
  let made = 0;
  for (const f of facilities) made += await inFacilityRun(f.id, async () => {
    const duties = await prisma.rosterAssignment.findMany({
      where: { facilityId: f.id, dutyDate: { gte: from, lte: to }, roster: { status: "PUBLISHED" }, shift: { countsAsDuty: true, endTime: { not: null } }, staff: { status: "ACTIVE" } },
      select: { id: true, staffId: true, rosterId: true, dutyDate: true, shiftId: true, shift: { select: { startTime: true, endTime: true, isOvernight: true } } },
    });
    const ended = duties.filter((d) => {
      const end = dutyEnd(d.dutyDate, d.shift.startTime, d.shift.endTime!, d.shift.isOvernight).getTime();
      return end <= now.getTime() && end >= now.getTime() - LOOKBACK;
    });
    if (!ended.length) return 0;
    const [have, leave] = await Promise.all([
      prisma.attendance.findMany({ where: { facilityId: f.id, rosterAssignmentId: { in: ended.map((d) => d.id) } }, select: { rosterAssignmentId: true } }),
      prisma.leaveRequest.findMany({ where: { facilityId: f.id, status: "APPROVED", startDate: { lte: to }, endDate: { gte: from } }, select: { staffId: true, startDate: true, endDate: true } }),
    ]);
    const done = new Set(have.map((h) => h.rosterAssignmentId));
    let n = 0;
    const rosters = new Map<string, number>();
    for (const d of ended) {
      if (done.has(d.id)) continue;
      if (leave.some((l) => l.staffId === d.staffId && l.startDate <= d.dutyDate && l.endDate >= d.dutyDate)) continue;
      await prisma.attendance.create({
        data: {
          facilityId: f.id, staffId: d.staffId, rosterId: d.rosterId, rosterAssignmentId: d.id, dutyDate: d.dutyDate, shiftId: d.shiftId,
          status: "ABSENT", source: "AUTO", needsReview: true, recordedBy: "Automatic", note: "No clock-in. Check the book.",
        },
      });
      rosters.set(d.rosterId, d.dutyDate.getTime());
      n++;
    }
    for (const [rosterId, ms] of rosters) await refreshCompleteness(rosterId, f.id, Math.floor(ms / DAY));
    return n;
  });
  return made;
}
