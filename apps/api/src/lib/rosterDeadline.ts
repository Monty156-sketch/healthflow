// The date by which each month's roster must be published, and the reminders that go to whoever owes it.
// A facility sets one day of the month before (for example the 25th). A roster for November is due by 25 October.
import { prisma } from "./prisma.js";
import { asSystem, inFacilityRun } from "./tenant.js";
import { notifyAdmins, notifyWard } from "./notify.js";
import { rostersByUnit } from "./unitDemand.js";
import { WARD_FACILITY_TYPES } from "../routes/facility/rosters.js";

const DAY = 86_400_000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The last moment the roster for a month may be published: the end of the chosen day in the month before. */
export const deadlineOf = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 2, day, 23, 59, 59, 999));

/** Days from today to the deadline day. Negative once it has passed. */
export const daysToDeadline = (year: number, month: number, day: number, now = new Date()) =>
  Math.floor(deadlineOf(year, month, day).getTime() / DAY) - Math.floor(now.getTime() / DAY);

/** 7, 3 or 1 days ahead, -1 once past, 0 when it is not yet time to say anything. */
export const stageFor = (daysLeft: number) => (daysLeft < 0 ? -1 : daysLeft <= 1 ? 1 : daysLeft <= 3 ? 3 : daysLeft <= 7 ? 7 : 0);

export const isLate = (publishedAt: Date, year: number, month: number, day: number | null) => day !== null && publishedAt > deadlineOf(year, month, day);

/** The current and the coming month, which are the ones a deadline can still matter for. */
export function targets(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  return [{ year: y, month: m }, m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 }];
}

export interface Unit { key: string; departmentId: string | null; name: string }

/** The rosters a facility keeps: one per ward or unit in a hospital, one for the whole facility otherwise. */
export async function unitsOf(facilityId: string, facilityType: string): Promise<Unit[]> {
  if (!(await rostersByUnit(facilityId, facilityType, WARD_FACILITY_TYPES))) return [{ key: "ALL", departmentId: null, name: "Facility" }];
  const depts = await prisma.department.findMany({ where: { facilityId, active: true, kind: { in: ["WARD", "SUPPORT"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return depts.map((d) => ({ key: d.id, departmentId: d.id, name: d.name }));
}

const STATE_WORD: Record<string, string> = { DRAFT: "in draft", GENERATED: "drafted, not yet reviewed", UNDER_REVIEW: "waiting for approval", APPROVED: "approved, not yet published", ARCHIVED: "archived" };

/** Where one unit's roster for one month stands against the deadline. */
export async function standing(facilityId: string, unit: Unit, year: number, month: number, day: number, now = new Date()) {
  const roster = await prisma.roster.findFirst({ where: { facilityId, year, month, departmentId: unit.departmentId }, select: { status: true, publishedAt: true, publishedLate: true } });
  const daysLeft = daysToDeadline(year, month, day, now);
  const published = roster?.status === "PUBLISHED";
  return {
    unit: unit.name, departmentId: unit.departmentId, year, month, label: `${MONTHS[month - 1]} ${year}`,
    deadline: deadlineOf(year, month, day).toISOString().slice(0, 10), daysLeft,
    state: published ? (roster!.publishedLate ? "PUBLISHED_LATE" : "PUBLISHED") : daysLeft < 0 ? "OVERDUE" : "OPEN",
    status: published ? "published" : roster ? (STATE_WORD[roster.status] ?? "in progress") : "not started",
  };
}

/** Reminds each unit's owner as the deadline nears and once when it passes. Returns how many reminders went out. */
export async function runRosterDeadlineReminders(now = new Date()): Promise<number> {
  const facilities = await asSystem(() => prisma.facility.findMany({ where: { rosterDeadlineDay: { not: null }, status: { in: ["TRIAL", "ACTIVE"] } }, select: { id: true, facilityType: true, rosterDeadlineDay: true } }));
  let sent = 0;
  for (const f of facilities) sent += await inFacilityRun(f.id, async () => {
    let n = 0;
    const units = await unitsOf(f.id, f.facilityType);
    for (const t of targets(now)) {
      const stage = stageFor(daysToDeadline(t.year, t.month, f.rosterDeadlineDay!, now));
      if (stage === 0) continue;
      for (const u of units) {
        const s = await standing(f.id, u, t.year, t.month, f.rosterDeadlineDay!, now);
        if (s.state !== "OPEN" && s.state !== "OVERDUE") continue;
        // A month already under way is chased only if its roster was started; otherwise turning the deadline on would nag about the past.
        if (t.month === now.getUTCMonth() + 1 && t.year === now.getUTCFullYear() && s.status === "not started") continue;
        const fresh = await prisma.rosterDeadlineReminder.createMany({ data: [{ facilityId: f.id, unitKey: u.key, year: t.year, month: t.month, stage }], skipDuplicates: true });
        if (fresh.count === 0) continue;
        const where = u.departmentId ? `${u.name} roster` : "Roster";
        const note = stage === -1
          ? { title: `${where} for ${s.label} is overdue`, body: `It was due by ${s.deadline} and is ${s.status}. Staff are waiting to know their duties.`, severity: "URGENT" as const }
          : { title: `${where} for ${s.label} is due ${stage === 1 ? "tomorrow or sooner" : `in ${stage} days or fewer`}`, body: `Publish by ${s.deadline}. It is ${s.status}.`, severity: stage === 1 ? ("ACTION" as const) : ("INFO" as const) };
        await notifyWard(f.id, u.departmentId, { type: "roster_deadline", ...note, linkUrl: "/roster" });
        if (stage === -1) await notifyAdmins(f.id, { type: "roster_deadline", ...note, linkUrl: "/roster" });
        n++;
      }
    }
    return n;
  });
  return sent;
}
