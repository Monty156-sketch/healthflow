// When leave is approved, the roster mends itself. The leaver's duties from the
// first day of leave are taken off, and the engine refills only those slots with
// the best-fitting colleagues. Everyone else's duties stay exactly where they
// are, so a published roster does not shuffle under people's feet. A snapshot
// is kept first, replacements are told, and anything that cannot be covered
// lawfully is reported to the roster managers instead of being hidden.
import { prisma } from "./prisma.js";
import { writeAuditLog } from "./audit.js";
import { notifyDeciders, notifyStaff } from "./notify.js";
import { detachAttendance, relinkAttendance } from "./attendanceReview.js";
import { settlementFor } from "./ledger.js";
import { generate } from "../engine/generate.js";
import { sayDay } from "../engine/time.js";
import { loadEngineData, monthName, saveVersion, storeFindings } from "../routes/facility/rosters.js";

const DAY = 86_400_000;
const dayOf = (d: Date) => Math.floor(d.getTime() / DAY);
const dateOf = (n: number) => new Date(n * DAY);

export interface RosterMend {
  rosterId: string;
  month: string;
  status: string;
  removed: number;
  filled: { name: string; date: string; shift: string }[];
  unfilled: { date: string; shift: string }[];
}

/** Rosters that carry duties, in these statuses, are mended. A draft with nothing in it is left to be generated. */
const MENDABLE = ["GENERATED", "UNDER_REVIEW", "APPROVED", "PUBLISHED"] as const;

export async function mendRostersForLeave(facilityId: string, leaveRequestId: string, by: { email: string; displayName: string }): Promise<RosterMend[]> {
  const leave = await prisma.leaveRequest.findFirst({ where: { id: leaveRequestId, facilityId }, include: { staff: { select: { id: true, fullName: true } }, leaveType: { select: { name: true } } } });
  if (!leave || leave.status !== "APPROVED") return [];
  const today = Math.floor(Date.now() / DAY);
  const from = Math.max(dayOf(leave.startDate), today);
  const to = leave.isOpenEnded ? from + 60 : dayOf(leave.endDate);
  if (to < from) return [];

  const rosters = await prisma.roster.findMany({
    where: { facilityId, status: { in: [...MENDABLE] } },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });
  const out: RosterMend[] = [];
  const settlement = await settlementFor(facilityId);
  for (const roster of rosters) {
    const first = Date.UTC(roster.year, roster.month - 1, 1) / DAY;
    const last = Date.UTC(roster.year, roster.month, 0) / DAY;
    if (last < from || first > to) continue;
    const data = await loadEngineData(facilityId, roster.id, roster.year, roster.month);
    const person = data.staff.find((s) => s.id === leave.staffId);
    if (!person) continue;
    const dutyShifts = new Set(data.shifts.filter((s) => s.countsAsDuty && !s.isOnCall).map((s) => s.id));
    const lo = Math.max(from, first);
    const hi = Math.min(to, last);
    const gone = data.current.filter((a) => a.staffId === leave.staffId && a.day >= lo && a.day <= hi && dutyShifts.has(a.shiftId));
    if (gone.length === 0) continue;

    const goneKeys = new Set(gone.map((a) => `${a.staffId}:${a.day}`));
    const offId = data.offShiftId;
    const run = (free: Set<string>) => {
      // Duties stay put, except those in `free`. Plain off days are free to be used, unless someone deliberately kept them.
      const keep = data.current.filter((a) => !goneKeys.has(`${a.staffId}:${a.day}`) && !free.has(`${a.staffId}:${a.day}`) && (dutyShifts.has(a.shiftId) || a.locked));
      const r = generate({
        partial: true,
        staff: data.staff, shifts: data.shifts, offShiftId: data.offShiftId, rules: data.rules, cycles: data.cycles, rotations: data.rotations,
        leave: data.leave, holidays: data.holidays, period: data.period, weekStartsOn: data.weekStartsOn, referenceWeeks: data.referenceWeeks,
        history: data.history, locked: keep, cadreNames: data.cadreNames, settlement, holidayWorked: data.holidayWorked, daysOff: data.daysOff,
      });
      return { r, keep };
    };
    // First try: nobody else's duty moves. If gaps remain, let nearby unlocked duties of colleagues move, from the leave onwards only.
    let { r: result, keep } = run(new Set());
    const gapsOf = (r: typeof result) => r.unfilled.filter((u) => u.day >= lo && u.day <= hi);
    const blocks = (r: typeof result) => r.findings.filter((f) => f.severity === "BLOCK").length;
    let moved = false;
    if (result.feasible && gapsOf(result).length) {
      const gapDays = gapsOf(result).map((g) => g.day);
      const free = new Set(
        data.current
          .filter((a) => a.staffId !== leave.staffId && !a.locked && dutyShifts.has(a.shiftId) && a.day >= lo && a.day <= hi && gapDays.some((g) => Math.abs(g - a.day) <= 6))
          .map((a) => `${a.staffId}:${a.day}`)
      );
      const second = run(free);
      if (second.r.feasible && gapsOf(second.r).length < gapsOf(result).length && blocks(second.r) <= blocks(result)) {
        result = second.r;
        keep = second.keep;
        moved = true;
      }
    }
    if (!result.feasible) continue;

    // What the roster looks like from the leave onwards, compared with what it was.
    const now = new Map<string, string>(); // staff:day -> shift, duties only
    for (const a of keep) if (dutyShifts.has(a.shiftId) && a.day >= lo && a.day <= hi) now.set(`${a.staffId}:${a.day}`, a.shiftId);
    for (const c of result.cells) if (c.shiftId !== offId && c.day >= lo && c.day <= hi) now.set(`${c.staffId}:${c.day}`, c.shiftId);
    const was = new Map<string, string>();
    for (const a of data.current) if (dutyShifts.has(a.shiftId) && a.day >= lo && a.day <= hi) was.set(`${a.staffId}:${a.day}`, a.shiftId);
    const added: { staffId: string; day: number; shiftId: string }[] = [];
    const dropped: { staffId: string; day: number; shiftId: string }[] = [];
    for (const [k, sh] of now) if (was.get(k) !== sh) { const [sid, d] = k.split(":"); added.push({ staffId: sid, day: Number(d), shiftId: sh }); }
    for (const [k, sh] of was) if (now.get(k) !== sh) { const [sid, d] = k.split(":"); dropped.push({ staffId: sid, day: Number(d), shiftId: sh }); }
    const leaverOff = result.cells.filter((c) => c.staffId === leave.staffId && c.day >= lo && c.day <= hi && c.shiftId === offId);
    const gaps = gapsOf(result);
    const nameOf = new Map(data.staff.map((x) => [x.id, x.name]));
    const mend: RosterMend = {
      rosterId: roster.id, month: monthName(roster), status: roster.status, removed: gone.length,
      filled: added.map((c) => ({ name: nameOf.get(c.staffId) ?? "Someone", date: dateOf(c.day).toISOString().slice(0, 10), shift: data.shiftName.get(c.shiftId) ?? "a shift" })),
      unfilled: gaps.map((g) => ({ date: dateOf(g.day).toISOString().slice(0, 10), shift: (g.shiftId && data.shiftName.get(g.shiftId)) || "a shift" })),
    };
    let loose: { name: string; date: Date }[] = [];
    await prisma.$transaction(
      async (tx) => {
        await saveVersion(tx, roster.id, roster.version + 1, by.email, `Before refilling ${leave.staff.fullName}'s duties for leave`);
        for (const d of dropped) {
          await detachAttendance(tx, { rosterId: roster.id, staffId: d.staffId, dutyDate: dateOf(d.day) });
          await tx.rosterAssignment.deleteMany({ where: { rosterId: roster.id, staffId: d.staffId, dutyDate: dateOf(d.day) } });
        }
        for (const c of added) {
          await tx.rosterAssignment.deleteMany({ where: { rosterId: roster.id, staffId: c.staffId, dutyDate: dateOf(c.day), locked: false } });
        }
        await tx.rosterAssignment.createMany({
          data: [
            ...added.map((c) => ({ rosterId: roster.id, facilityId, staffId: c.staffId, shiftId: c.shiftId, dutyDate: dateOf(c.day), source: "COVER" as const })),
            ...leaverOff.map((c) => ({ rosterId: roster.id, facilityId, staffId: c.staffId, shiftId: c.shiftId, dutyDate: dateOf(c.day), source: "GENERATED" as const })),
          ],
        });
        loose = await relinkAttendance(tx, roster.id);
        await storeFindings(tx, roster.id, facilityId, result.findings);
        await tx.roster.update({
          where: { id: roster.id },
          data: { version: roster.version + 1, hasUnresolvedConflicts: result.findings.some((f) => f.severity === "BLOCK") },
        });
      },
      { timeout: 30_000, maxWait: 10_000 }
    );
    out.push(mend);

    // Tell each replacement what changed for them, once.
    const byPerson = new Map<string, string[]>();
    for (const c of added) byPerson.set(c.staffId, [...(byPerson.get(c.staffId) ?? []), `${data.shiftName.get(c.shiftId) ?? "duty"} on ${sayDay(c.day)}`]);
    for (const [sid, list] of byPerson) {
      await notifyStaff(facilityId, sid, {
        type: "duty_changed", title: `You were added to the ${monthName(roster)} roster`,
        body: `${leave.staff.fullName} is on leave, so you cover: ${list.slice(0, 4).join(", ")}${list.length > 4 ? ` and ${list.length - 4} more` : ""}.`,
        linkUrl: `/roster/${roster.id}`, severity: "ACTION",
      });
    }
    const movedAway = new Map<string, string[]>();
    for (const d of dropped) if (d.staffId !== leave.staffId) movedAway.set(d.staffId, [...(movedAway.get(d.staffId) ?? []), `${data.shiftName.get(d.shiftId) ?? "duty"} on ${sayDay(d.day)}`]);
    for (const [sid, list] of movedAway) {
      await notifyStaff(facilityId, sid, {
        type: "duty_changed", title: `Your duties changed in the ${monthName(roster)} roster`,
        body: `To cover ${leave.staff.fullName}'s leave, these were moved off you: ${list.slice(0, 4).join(", ")}${list.length > 4 ? ` and ${list.length - 4} more` : ""}.`,
        linkUrl: `/roster/${roster.id}`, severity: "ACTION",
      });
    }
    await writeAuditLog({
      facilityId, actorEmail: by.email, action: "roster_mended_for_leave", entityType: "Roster", entityId: roster.id,
      summary: `Approving ${leave.staff.fullName}'s ${leave.leaveType.name.toLowerCase()} leave removed ${gone.length} ${gone.length === 1 ? "duty" : "duties"} from the ${monthName(roster)} roster. ${gone.length - gaps.length < 0 ? 0 : gone.length - gaps.length} refilled by colleagues${moved ? `, moving ${movedAway.size} other ${movedAway.size === 1 ? "person's" : "people's"} nearby duties` : ""}${gaps.length ? `; ${gaps.length} could not be covered lawfully` : ""}. The roster before the change is saved as version ${roster.version}.`,
    });
    if (gaps.length || loose.length) {
      await notifyDeciders(facilityId, {
        type: "roster_short", title: `${gaps.length ? `${gaps.length} ${gaps.length === 1 ? "duty" : "duties"} left uncovered` : "Attendance needs a look"} in ${monthName(roster)}`,
        body: gaps.length
          ? `${leave.staff.fullName}'s leave could not be fully covered without breaking a rule. First gap: ${mend.unfilled[0].shift} on ${sayDay(dayOf(new Date(mend.unfilled[0].date)))}.`
          : `A duty changed after attendance was recorded.`,
        linkUrl: `/roster/${roster.id}`, severity: "ACTION",
      }, by.email);
    }
  }
  if (out.length) await prisma.leaveRequest.update({ where: { id: leave.id }, data: { conflictsPublishedRoster: false } });
  return out;
}
