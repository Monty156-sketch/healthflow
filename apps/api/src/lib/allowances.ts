// The duty-day and allowance sheet. Counts and hours only: nights, weekends,
// public holidays and each shift worked, set against attendance, so the
// accounts office can price them. No rate or amount is held here. Every figure
// comes from the roster and the attendance record and nothing is typed in.
import { prisma } from "./prisma.js";
import { rostersForMonth } from "./reportStats.js";

export interface AllowanceRow {
  staffId: string;
  staffNo: string;
  name: string;
  cadre: string | null;
  ward: string | null;
  duties: number;
  byShift: Record<string, number>;
  nights: number;
  weekends: number;
  holidays: number;
  hours: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  onLeave: number;
  official: number;
  /** Rostered duties with no attendance record at all. */
  unrecorded: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const RANK = ["DRAFT", "GENERATED", "UNDER_REVIEW", "APPROVED", "PUBLISHED"];

export async function allowanceSheet(facilityId: string, year: number, month: number, departmentId: string | null) {
  const rosters = await rostersForMonth(facilityId, year, month, departmentId);
  if (!rosters.length) return null;
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  const rosterIds = rosters.map((r) => r.id);
  const wardOfRoster = new Map(rosters.map((r) => [r.id, r.department?.name ?? null]));
  const [assignments, attendance, holidays, shifts] = await Promise.all([
    prisma.rosterAssignment.findMany({
      where: { rosterId: { in: rosterIds }, shift: { countsAsDuty: true } },
      select: { rosterId: true, staffId: true, shiftId: true, dutyDate: true, staff: { select: { staffNo: true, fullName: true, cadre: { select: { name: true } } } } },
    }),
    prisma.attendance.findMany({ where: { facilityId, rosterId: { in: rosterIds }, dutyDate: { gte: from, lte: to } }, select: { staffId: true, dutyDate: true, status: true } }),
    prisma.publicHoliday.findMany({ where: { OR: [{ facilityId }, { facilityId: null }], date: { gte: from, lte: to } }, select: { date: true } }),
    prisma.shift.findMany({ where: { facilityId, countsAsDuty: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const shiftBy = new Map(shifts.map((s) => [s.id, s]));
  const holidaySet = new Set(holidays.map((h) => h.date.getTime()));
  const rows = new Map<string, AllowanceRow>();
  for (const a of assignments) {
    const s = shiftBy.get(a.shiftId);
    if (!s) continue;
    let r = rows.get(a.staffId);
    if (!r) {
      r = { staffId: a.staffId, staffNo: a.staff.staffNo, name: a.staff.fullName, cadre: a.staff.cadre?.name ?? null, ward: wardOfRoster.get(a.rosterId) ?? null, duties: 0, byShift: {}, nights: 0, weekends: 0, holidays: 0, hours: 0, present: 0, late: 0, absent: 0, excused: 0, onLeave: 0, official: 0, unrecorded: 0 };
      rows.set(a.staffId, r);
    }
    const wd = a.dutyDate.getUTCDay();
    r.duties++;
    r.byShift[a.shiftId] = (r.byShift[a.shiftId] ?? 0) + 1;
    r.hours += s.durationHours * (s.isOnCall ? s.onCallHoursFactor ?? 1 : 1);
    if (s.isOvernight || s.name.toLowerCase().includes("night")) r.nights++;
    if (wd === 0 || wd === 6) r.weekends++;
    if (holidaySet.has(a.dutyDate.getTime())) r.holidays++;
  }
  const recorded = new Set<string>();
  for (const a of attendance) {
    const r = rows.get(a.staffId);
    if (!r) continue;
    recorded.add(`${a.staffId}:${a.dutyDate.getTime()}`);
    if (a.status === "PRESENT") r.present++;
    else if (a.status === "LATE") r.late++;
    else if (a.status === "ABSENT") r.absent++;
    else if (a.status === "EXCUSED") r.excused++;
    else if (a.status === "ON_LEAVE") r.onLeave++;
    else if (a.status === "OFFICIAL_ASSIGNMENT") r.official++;
  }
  for (const a of assignments) {
    const r = rows.get(a.staffId);
    if (r && !recorded.has(`${a.staffId}:${a.dutyDate.getTime()}`)) r.unrecorded++;
  }
  const list = [...rows.values()].map((r) => ({ ...r, hours: round1(r.hours) }));
  list.sort((a, b) => (a.ward ?? "").localeCompare(b.ward ?? "") || (a.cadre ?? "~").localeCompare(b.cadre ?? "~") || a.staffNo.localeCompare(b.staffNo, undefined, { numeric: true }));
  const used = shifts.filter((s) => list.some((r) => r.byShift[s.id]));
  const sum = (k: "duties" | "nights" | "weekends" | "holidays" | "hours" | "present" | "late" | "absent" | "excused" | "onLeave" | "official" | "unrecorded") => round1(list.reduce((n, r) => n + r[k], 0));
  const furthest = [...rosters].sort((a, b) => RANK.indexOf(a.status) - RANK.indexOf(b.status))[0];
  return {
    year, month,
    rosterStatus: furthest.status,
    /** Every roster is published or approved: only then is the sheet final. */
    final: rosters.every((r) => r.status === "PUBLISHED" || r.status === "APPROVED"),
    ward: departmentId ? rosters[0].department?.name ?? null : null,
    hasWards: rosters.some((r) => r.department),
    shifts: used.map((s) => ({ id: s.id, name: s.name })),
    rows: list,
    totals: { duties: sum("duties"), nights: sum("nights"), weekends: sum("weekends"), holidays: sum("holidays"), hours: sum("hours"), present: sum("present"), late: sum("late"), absent: sum("absent"), excused: sum("excused"), onLeave: sum("onLeave"), official: sum("official"), unrecorded: sum("unrecorded"), byShift: Object.fromEntries(used.map((s) => [s.id, list.reduce((n, r) => n + (r.byShift[s.id] ?? 0), 0)])) },
  };
}

export type AllowanceSheet = NonNullable<Awaited<ReturnType<typeof allowanceSheet>>>;
