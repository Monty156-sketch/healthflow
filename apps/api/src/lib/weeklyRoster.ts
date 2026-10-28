// Weekly rosters. Some units, public health above all, plan a week at a time. A week
// is drawn into the unit's monthly roster, so attendance, swaps, leave and the
// printed roster all keep working from one place. The roster engine is not
// touched: it is asked for a seven day period, which it already accepts, and
// only those seven days are written. The days outside the week stay as they were.
import { prisma } from "./prisma.js";
import { writeAuditLog } from "./audit.js";
import { notifyStaff } from "./notify.js";
import { detachAttendance, relinkAttendance } from "./attendanceReview.js";
import { settlementFor } from "./ledger.js";
import { isPublicHealthUnit } from "./dutyPlan.js";
import { seedUnitDemand } from "./unitDemand.js";
import { generate } from "../engine/generate.js";
import { sayDay } from "../engine/time.js";
import { checkOf, loadEngineData, monthName, saveVersion, storeFindings } from "../routes/facility/rosters.js";

const DAY = 86_400_000;
const dateOf = (n: number) => new Date(n * DAY);
const isoOf = (n: number) => dateOf(n).toISOString().slice(0, 10);
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export class WeekProblem extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export interface WeekView {
  from: string;
  to: string;
  department: string | null;
  days: { date: string; weekday: string; shifts: { shift: string; people: string[] }[] }[];
  unfilled: { date: string; shift: string }[];
  rosterIds: string[];
  duties: number;
}

/** Who is on what, for the seven days from `from`, read from the unit's monthly rosters. */
export async function weekView(facilityId: string, departmentId: string | null, from: number): Promise<WeekView> {
  const to = from + 6;
  const [dept, rows, shifts] = await Promise.all([
    departmentId ? prisma.department.findFirst({ where: { id: departmentId, facilityId }, select: { name: true } }) : null,
    prisma.rosterAssignment.findMany({
      where: { facilityId, roster: { departmentId }, dutyDate: { gte: dateOf(from), lte: dateOf(to) }, shift: { countsAsDuty: true, isOnCall: false } },
      select: { rosterId: true, dutyDate: true, shiftId: true, staff: { select: { fullName: true } } },
    }),
    prisma.shift.findMany({ where: { facilityId, active: true, countsAsDuty: true, isOnCall: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);
  const days = [];
  for (let d = from; d <= to; d++) {
    const mine = rows.filter((r) => Math.floor(r.dutyDate.getTime() / DAY) === d);
    days.push({
      date: isoOf(d), weekday: WEEKDAY[dateOf(d).getUTCDay()],
      shifts: shifts.map((s) => ({ shift: s.name, people: mine.filter((r) => r.shiftId === s.id).map((r) => r.staff.fullName).sort() })).filter((s) => s.people.length > 0),
    });
  }
  return { from: isoOf(from), to: isoOf(to), department: dept?.name ?? null, days, unfilled: [], rosterIds: [...new Set(rows.map((r) => r.rosterId))], duties: rows.length };
}

/**
 * Draws one week for a unit. Creates the month's roster if there is not one yet,
 * replaces the unit's unlocked duties in the week with a new plan that follows the
 * facility's rules, and tells each person their duties. Returns what the week looks like.
 */
export async function drawWeek(facilityId: string, departmentId: string | null, from: number, by: { email: string; displayName: string }, variation?: number): Promise<WeekView> {
  const to = from + 6;
  const dept = departmentId ? await prisma.department.findFirst({ where: { id: departmentId, facilityId }, select: { id: true, name: true } }) : null;
  const months = [...new Map([from, to].map((d) => { const x = dateOf(d); return [`${x.getUTCFullYear()}-${x.getUTCMonth() + 1}`, { year: x.getUTCFullYear(), month: x.getUTCMonth() + 1 }]; })).values()];

  // Look before changing anything: a month that is already in review or published is not redrawn from here.
  const found = await Promise.all(months.map((m) => prisma.roster.findFirst({ where: { facilityId, year: m.year, month: m.month, departmentId: dept?.id ?? null } })));
  for (const r of found) {
    if (r && !["DRAFT", "GENERATED"].includes(r.status)) {
      throw new WeekProblem(409, "roster_locked", `The ${monthName(r)} roster${dept ? ` for ${dept.name}` : ""} is already ${r.status === "PUBLISHED" ? "published" : "in review"}, so a week cannot be drawn into it. Use leave or an emergency deployment to change a published roster.`);
    }
  }

  const unfilled: { date: string; shift: string }[] = [];
  const rosterIds: string[] = [];
  let duties = 0;
  for (let i = 0; i < months.length; i++) {
    const m = months[i];
    const roster = found[i] ?? (await prisma.roster.create({ data: { facilityId, year: m.year, month: m.month, departmentId: dept?.id ?? null, preparedBy: by.email } }));
    if (!found[i] && dept && isPublicHealthUnit(dept.name)) await seedUnitDemand(facilityId, dept);
    const first = Date.UTC(m.year, m.month - 1, 1) / DAY;
    const last = Date.UTC(m.year, m.month, 0) / DAY;
    const lo = Math.max(from, first);
    const hi = Math.min(to, last);

    const data = await loadEngineData(facilityId, roster.id, m.year, m.month);
    if (!data.staff.length) throw new WeekProblem(409, "no_staff", `${dept ? `${dept.name} has` : "There are"} no active staff to roster. Add staff first.`);
    if (!data.shifts.some((s) => s.countsAsDuty && !s.isOnCall && (s.minStaff > 0 || (s.weekendMinStaff ?? 0) > 0))) {
      throw new WeekProblem(409, "no_demand", `No shift asks for anyone${dept ? ` in ${dept.name}` : ""} yet. Set how many people each shift needs on the roster page, then draw the week.`);
    }
    const locked = data.current.filter((a) => a.locked && a.day >= lo && a.day <= hi);
    const lockedKey = new Set(locked.map((a) => `${a.staffId}:${a.day}`));
    const result = generate({
      variation: variation ?? 0, partial: true,
      staff: data.staff, shifts: data.shifts, offShiftId: data.offShiftId, rules: data.rules, cycles: data.cycles, rotations: data.rotations, leave: data.leave, holidays: data.holidays,
      period: { startDay: lo, endDay: hi }, weekStartsOn: data.weekStartsOn, referenceWeeks: data.referenceWeeks,
      // The unit's own earlier days this month count as history, so rest rules carry into the week.
      history: [...data.history, ...data.current.filter((a) => a.day < lo)],
      locked, cadreNames: data.cadreNames, settlement: await settlementFor(facilityId), holidayWorked: data.holidayWorked, daysOff: data.daysOff,
    });
    if (!result.feasible) {
      throw new WeekProblem(409, "not_feasible", `A lawful week cannot be drawn from ${sayDay(lo)} with the staff and shifts as they are. Nothing was changed. Check how many people each shift needs.`);
    }

    const hadDuties = await prisma.rosterAssignment.count({ where: { rosterId: roster.id } });
    const fresh = result.cells.filter((c) => c.day >= lo && c.day <= hi && !lockedKey.has(`${c.staffId}:${c.day}`));
    await prisma.$transaction(async (tx) => {
      if (hadDuties) await saveVersion(tx, roster.id, roster.version + 1, by.email, `Before the week from ${sayDay(lo)} was drawn`);
      const inWeek = { rosterId: roster.id, locked: false, dutyDate: { gte: dateOf(lo), lte: dateOf(hi) } };
      await detachAttendance(tx, inWeek);
      await tx.rosterAssignment.deleteMany({ where: inWeek });
      await tx.rosterAssignment.createMany({ data: fresh.map((c) => ({ rosterId: roster.id, facilityId, staffId: c.staffId, shiftId: c.shiftId, dutyDate: dateOf(c.day), source: c.source })) });
      await relinkAttendance(tx, roster.id);
      await tx.roster.update({ where: { id: roster.id }, data: { status: "GENERATED", generatedAt: roster.generatedAt ?? new Date(), preparedBy: by.email, ...(hadDuties ? { version: roster.version + 1 } : {}) } });
    }, { timeout: 30_000, maxWait: 10_000 });

    // Check the whole month again, so a week drawn next to the others cannot hide a broken rule.
    const after = await loadEngineData(facilityId, roster.id, m.year, m.month);
    const findings = checkOf(after, after.current);
    await prisma.$transaction(async (tx) => {
      await storeFindings(tx, roster.id, facilityId, findings);
      await tx.roster.update({ where: { id: roster.id }, data: { hasUnresolvedConflicts: findings.some((f) => f.severity === "BLOCK") } });
    });

    const shiftName = data.shiftName;
    for (const u of result.unfilled.filter((x) => x.day >= lo && x.day <= hi)) unfilled.push({ date: isoOf(u.day), shift: (u.shiftId && shiftName.get(u.shiftId)) || "a shift" });
    const dutyShift = new Set(data.shifts.filter((s) => s.countsAsDuty && !s.isOnCall).map((s) => s.id));
    const mine = new Map<string, string[]>();
    for (const c of fresh) if (dutyShift.has(c.shiftId)) mine.set(c.staffId, [...(mine.get(c.staffId) ?? []), `${shiftName.get(c.shiftId) ?? "duty"} on ${sayDay(c.day)}`]);
    duties += [...mine.values()].reduce((n, l) => n + l.length, 0);
    for (const [sid, list] of mine) {
      await notifyStaff(facilityId, sid, {
        type: "duty_changed", title: `Your duties for the week from ${sayDay(lo)}`,
        body: `${list.slice(0, 5).join(", ")}${list.length > 5 ? ` and ${list.length - 5} more` : ""}.`,
        linkUrl: `/roster/${roster.id}`, severity: "INFO",
      });
    }
    rosterIds.push(roster.id);
    await writeAuditLog({
      facilityId, actorEmail: by.email, action: "week_drawn", entityType: "Roster", entityId: roster.id,
      summary: `${by.displayName} drew the week from ${sayDay(lo)} to ${sayDay(hi)}${dept ? ` for ${dept.name}` : ""}: ${[...mine.values()].reduce((n, l) => n + l.length, 0)} duties, ${result.unfilled.filter((x) => x.day >= lo && x.day <= hi).length} unfilled. The earlier roster is saved as version ${roster.version}.`,
    });
  }
  const view = await weekView(facilityId, dept?.id ?? null, from);
  return { ...view, unfilled, rosterIds, duties };
}
