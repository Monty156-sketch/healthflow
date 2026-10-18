// Figures for the reports, computed from the roster and nothing else. None is
// typed in by hand, so a report can be checked against the roster grid.
import { prisma } from "./prisma.js";
import { hoursOf, interval, weekdayOf } from "../engine/time.js";
import type { EShift } from "../engine/types.js";
import { loadEngineData } from "../routes/facility/rosters.js";

const NORMAL_WEEK = 40;

export const isNight = (s: EShift) => s.isOvernight || s.name.toLowerCase().includes("night");

/** The roster to report on for a month: published first, then approved, then the latest. */
export async function rosterForMonth(facilityId: string, year: number, month: number) {
  const rows = await prisma.roster.findMany({ where: { facilityId, year, month }, orderBy: { version: "desc" } });
  const rank = (s: string) => (s === "PUBLISHED" ? 0 : s === "APPROVED" ? 1 : 2);
  // A whole-facility roster first; a hospital's reports are read one ward at a time, starting with the first ward.
  return rows.sort((a, b) => Number(a.departmentId !== null) - Number(b.departmentId !== null) || rank(a.status) - rank(b.status) || b.version - a.version)[0] ?? null;
}

export interface StaffFigures {
  staffId: string;
  staffNo: string;
  name: string;
  cadre: string | null;
  hours: number;
  dutyDays: number;
  nights: number;
  highestWeekHours: number;
  hoursAboveNormal: number;
  longestRestHours: number | null;
  restBreaches: number;
}

export async function complianceFigures(facilityId: string, rosterId: string, year: number, month: number) {
  const data = await loadEngineData(facilityId, rosterId, year, month);
  const [cadres, findings] = await Promise.all([
    prisma.cadre.findMany({ where: { facilityId }, select: { id: true, name: true } }),
    prisma.complianceFinding.findMany({ where: { rosterId }, include: { staff: { select: { fullName: true, staffNo: true } } } }),
  ]);
  const cadreName = new Map(cadres.map((c) => [c.id, c.name]));
  const shiftBy = new Map(data.shifts.map((s) => [s.id, s]));
  const { startDay, endDay } = data.period;
  const duties = [...data.history, ...data.current].filter((a) => shiftBy.get(a.shiftId)?.countsAsDuty);
  const weekStart = (d: number) => d - ((weekdayOf(d) - data.weekStartsOn + 7) % 7);

  const rows: StaffFigures[] = data.staff.map((s) => {
    const mine = duties.filter((a) => a.staffId === s.id);
    const inMonth = mine.filter((a) => a.day >= startDay && a.day <= endDay);
    const weeks = new Map<number, number>();
    for (const a of mine) {
      const w = weekStart(a.day);
      if (w + 6 < startDay || w > endDay) continue;
      weeks.set(w, (weeks.get(w) ?? 0) + hoursOf(shiftBy.get(a.shiftId)!));
    }
    const timeline = inMonth.map((a) => interval(a.day, shiftBy.get(a.shiftId)!)).sort((x, y) => x.start - y.start);
    let longest: number | null = null;
    for (let i = 1; i < timeline.length; i++) longest = Math.max(longest ?? 0, (timeline[i].start - timeline[i - 1].end) / 60);
    const mineFindings = findings.filter((f) => f.staffId === s.id && ["C3", "C5", "C6"].includes(f.ruleCode) && f.status !== "RESOLVED");
    return {
      staffId: s.id, staffNo: s.staffNo, name: s.name, cadre: s.cadreId ? (cadreName.get(s.cadreId) ?? null) : null,
      hours: round1(inMonth.reduce((n, a) => n + hoursOf(shiftBy.get(a.shiftId)!), 0)),
      dutyDays: new Set(inMonth.map((a) => a.day)).size,
      nights: inMonth.filter((a) => isNight(shiftBy.get(a.shiftId)!)).length,
      highestWeekHours: round1(Math.max(0, ...weeks.values())),
      hoursAboveNormal: round1([...weeks.values()].reduce((n, h) => n + Math.max(0, h - NORMAL_WEEK), 0)),
      longestRestHours: longest === null ? null : round1(longest),
      restBreaches: mineFindings.length,
    };
  });
  rows.sort((a, b) => (a.cadre ?? "~").localeCompare(b.cadre ?? "~") || a.staffNo.localeCompare(b.staffNo, undefined, { numeric: true }));

  const overrides = findings
    .filter((f) => f.status === "OVERRIDDEN")
    .map((f) => ({ rule: f.ruleCode, message: f.message, staff: f.staff?.fullName ?? null, reason: f.overrideReason ?? "", approver: f.overrideBy ?? "", date: f.overrideAt ? f.overrideAt.toISOString().slice(0, 10) : null }));
  const open = findings.filter((f) => f.status !== "RESOLVED" && f.status !== "OVERRIDDEN");
  return {
    rows,
    overrides,
    summary: {
      staffAboveNormalWeek: rows.filter((r) => r.highestWeekHours > NORMAL_WEEK).length,
      restBreaches: rows.reduce((n, r) => n + r.restBreaches, 0),
      overridesGranted: overrides.length,
      unfilledShifts: open.filter((f) => f.ruleCode === "C11").length,
    },
    normalWeek: NORMAL_WEEK,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ------------------------------------------------------------- fairness

export interface FairRow {
  staffId: string;
  name: string;
  nights: number;
  weekends: number;
  holidays: number;
  duties: number;
  hours: number;
}

const plural = (w: string) => (/fe$/i.test(w) ? w.replace(/fe$/i, "ves") : /(s|x|ch|sh)$/i.test(w) ? `${w}es` : /[^aeiou]y$/i.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`);

/** Three months ending at the given one, per cadre, against the cadre mean. */
export async function fairnessFigures(facilityId: string, endYear: number, endMonth: number) {
  const months: { year: number; month: number }[] = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(Date.UTC(endYear, endMonth - 1 - i, 1));
    months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }
  const rosters = (await Promise.all(months.map((m) => rosterForMonth(facilityId, m.year, m.month)))).filter((r): r is NonNullable<typeof r> => Boolean(r) && ["PUBLISHED", "APPROVED"].includes(r!.status));
  const from = new Date(Date.UTC(months[0].year, months[0].month - 1, 1));
  const to = new Date(Date.UTC(endYear, endMonth, 0));
  const [staff, shifts, assignments, holidays, cadres] = await Promise.all([
    prisma.staff.findMany({ where: { facilityId, status: "ACTIVE" }, select: { id: true, fullName: true, cadreId: true, staffNo: true } }),
    prisma.shift.findMany({ where: { facilityId } }),
    prisma.rosterAssignment.findMany({ where: { rosterId: { in: rosters.map((r) => r.id) }, shift: { countsAsDuty: true } }, select: { staffId: true, shiftId: true, dutyDate: true } }),
    prisma.publicHoliday.findMany({ where: { OR: [{ facilityId }, { facilityId: null }], date: { gte: from, lte: to } }, select: { date: true } }),
    prisma.cadre.findMany({ where: { facilityId }, select: { id: true, name: true, sortOrder: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const shiftBy = new Map(shifts.map((s) => [s.id, s]));
  const holidaySet = new Set(holidays.map((h) => h.date.getTime()));
  const figures = new Map<string, FairRow>(staff.map((s) => [s.id, { staffId: s.id, name: s.fullName, nights: 0, weekends: 0, holidays: 0, duties: 0, hours: 0 }]));
  for (const a of assignments) {
    const f = figures.get(a.staffId);
    const s = shiftBy.get(a.shiftId);
    if (!f || !s) continue;
    const wd = a.dutyDate.getUTCDay();
    f.duties++;
    f.hours += (s.durationHours ?? 0) * (s.isOnCall ? (s.onCallHoursFactor ?? 1) : 1);
    if (s.isOvernight || s.name.toLowerCase().includes("night")) f.nights++;
    if (wd === 0 || wd === 6) f.weekends++;
    if (holidaySet.has(a.dutyDate.getTime())) f.holidays++;
  }
  const groups = [...cadres.map((c) => ({ id: c.id as string | null, name: c.name })), { id: null as string | null, name: "No cadre set" }];
  const byCadre = groups
    .map((g) => {
      const members = staff.filter((s) => s.cadreId === g.id).map((s) => figures.get(s.id)!);
      members.forEach((m) => (m.hours = round1(m.hours)));
      const mean = (k: keyof FairRow) => round1(members.reduce((n, m) => n + (m[k] as number), 0) / Math.max(1, members.length));
      const means = { nights: mean("nights"), weekends: mean("weekends"), holidays: mean("holidays"), duties: mean("duties"), hours: mean("hours") };
      const nights = members.map((m) => m.nights);
      const sentence =
        members.length < 2
          ? null
          : `Night duties among ${plural(g.name.toLowerCase())} range from ${Math.min(...nights)} to ${Math.max(...nights)} over these three months, against an average of ${means.nights}.`;
      return { cadre: g.name, cadreId: g.id, means, sentence, people: members.sort((a, b) => b.duties - a.duties || a.name.localeCompare(b.name)) };
    })
    .filter((g) => g.people.length > 0);
  return {
    period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    monthsCovered: rosters.length,
    monthsAsked: months.length,
    byCadre,
    cadreOf: new Map(staff.map((s) => [s.id, s.cadreId])),
  };
}

