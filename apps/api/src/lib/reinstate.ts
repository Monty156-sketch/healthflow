// Putting someone back on the roster after they return. The roster for the rest
// of the month was built without them, so they come back with nothing and
// everyone else carries the extra. This proposes, in order: shifts that are
// short, then duties from colleagues furthest above their cadre's average, then
// duties from colleagues who are owed one. It stops at the person's pro-rata
// share. Nothing moves until a supervisor accepts it, and each item is checked
// again against the roster as it is at that moment.
import { prisma } from "./prisma.js";
import { writeAuditLog } from "./audit.js";
import { notifyStaff } from "./notify.js";
import { openBalances, settleOne } from "./ledger.js";
import { refreshFindings, type ActingUser } from "./cover.js";
import { sayDay, daysInMonth } from "../engine/time.js";
import { evaluateSwap } from "../routes/facility/swaps.js";
import { checkOf, findingKey, loadEngineData, monthName, saveVersion } from "../routes/facility/rosters.js";

const DAY = 86_400_000;

export class ReinstateError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type ItemKind = "FILL" | "RELIEVE" | "CREDIT";

export interface Item {
  kind: ItemKind;
  day: number;
  date: string;
  shiftId: string;
  shift: string;
  assignmentId: string | null; // the duty being taken over, for RELIEVE and CREDIT
  fromStaffId: string | null;
  fromName: string | null;
  sentence: string;
  warnings: string[];
}

export interface Plan {
  staff: { id: string; name: string };
  roster: { id: string; label: string } | null;
  target: number;
  have: number;
  items: Item[];
  note: string;
}

async function context(facilityId: string, leaveRequestId: string) {
  const r = await prisma.leaveRequest.findFirst({ where: { id: leaveRequestId, facilityId }, include: { staff: { select: { id: true, fullName: true, cadreId: true, departmentId: true, status: true } } } });
  if (!r) throw new ReinstateError(404, "That leave was not found.");
  if (!r.actualReturnDate) throw new ReinstateError(409, "The return has not been confirmed yet, so there is nothing to put back on the roster.");
  if (r.staff.status !== "ACTIVE") throw new ReinstateError(409, `${r.staff.fullName} is not an active member of staff.`);
  const back = Math.floor(r.actualReturnDate.getTime() / DAY);
  const from = Math.max(back, Math.floor(Date.now() / DAY));
  const d = new Date(from * DAY);
  const roster = await prisma.roster.findFirst({ where: { facilityId, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, status: "PUBLISHED", OR: [{ departmentId: r.staff.departmentId }, { departmentId: null }] }, orderBy: { departmentId: "asc" } });
  return { r, from, roster };
}

/** The proposal: what would put the person back at their fair share, and no more. */
export async function reinstatementPlan(facilityId: string, leaveRequestId: string): Promise<Plan> {
  const { r, from, roster } = await context(facilityId, leaveRequestId);
  const staff = { id: r.staff.id, name: r.staff.fullName };
  if (!roster) return { staff, roster: null, target: 0, have: 0, items: [], note: "There is no published roster for the month they return in. They will be included when the next roster is built." };
  const data = await loadEngineData(facilityId, roster.id, roster.year, roster.month);
  const me = data.staff.find((s) => s.id === staff.id);
  if (!me) return { staff, roster: { id: roster.id, label: monthName(roster) }, target: 0, have: 0, items: [], note: "They are not on the staff list for this roster." };
  const end = data.period.endDay;
  const remaining = end - from + 1;
  if (remaining < 1) return { staff, roster: { id: roster.id, label: monthName(roster) }, target: 0, have: 0, items: [], note: "The month has ended, so there is nothing left to share out." };

  const duty = new Set(data.shifts.filter((s) => s.countsAsDuty && !s.isOnCall).map((s) => s.id));
  const shiftOf = new Map(data.shifts.map((s) => [s.id, s]));
  const inMonth = (id: string) => data.current.filter((a) => a.staffId === id && duty.has(a.shiftId)).length;
  const peers = data.staff.filter((s) => s.id !== me.id && s.cadreId === me.cadreId);
  const avg = peers.length ? peers.reduce((n, p) => n + inMonth(p.id), 0) / peers.length : 0;
  const target = Math.round((avg * remaining) / daysInMonth(roster.year, roster.month));
  const have = data.current.filter((a) => a.staffId === me.id && duty.has(a.shiftId) && a.day >= from).length;
  const items: Item[] = [];
  const base = { roster: { id: roster.id, label: monthName(roster) }, staff, target, have };
  if (target - have <= 0) return { ...base, items, note: `They already have their share of the ${monthName(roster)} roster, so nothing needs to move.` };
  let need = target - have;

  let cur = [...data.current];
  const known = new Set(checkOf(data, cur).map(findingKey));
  const newBlocks = (next: typeof cur) => checkOf(data, next).filter((f) => f.severity === "BLOCK" && f.staffId === me.id && !known.has(findingKey(f)));

  // 1. Shifts that are short, where they could lawfully work.
  for (const f of checkOf(data, cur)) {
    if (need <= 0) break;
    if (f.ruleCode !== "C11" || f.day === null || f.day < from) continue;
    const shiftId = (f.detail?.shiftId as string | undefined) ?? null;
    const cadreId = (f.detail?.cadreId as string | undefined) ?? null;
    if (!shiftId || (cadreId && cadreId !== me.cadreId)) continue;
    if (cur.some((a) => a.staffId === me.id && a.day === f.day && duty.has(a.shiftId))) continue;
    const next = [...cur, { staffId: me.id, shiftId, day: f.day, locked: true }];
    if (newBlocks(next).length) continue;
    cur = next;
    const s = shiftOf.get(shiftId)!;
    items.push({ kind: "FILL", day: f.day, date: new Date(f.day * DAY).toISOString().slice(0, 10), shiftId, shift: s.name, assignmentId: null, fromStaffId: null, fromName: null, sentence: `${s.name} on ${sayDay(f.day)} is short of staff. ${staff.name} can take it.`, warnings: [] });
    need--;
  }

  // 2 and 3. Duties from colleagues above their share, then from those who are owed one.
  const balances = await openBalances(facilityId);
  const mine = await prisma.rosterAssignment.findMany({ where: { rosterId: roster.id, staffId: { in: peers.map((p) => p.id) }, locked: false, shift: { countsAsDuty: true, isOnCall: false } }, include: { shift: true }, orderBy: { dutyDate: "asc" } });
  const taken = new Set<string>();
  const give = async (kind: "RELIEVE" | "CREDIT", holders: typeof peers, headroom: (id: string) => number) => {
    for (const h of holders) {
      let spare = headroom(h.id);
      for (const a of mine.filter((m) => m.staffId === h.id)) {
        if (need <= 0 || spare <= 0) break;
        const day = Math.floor(a.dutyDate.getTime() / DAY);
        if (day < from || taken.has(a.id)) continue;
        const o = await evaluateSwap(facilityId, { rosterId: roster.id, requesterStaffId: h.id, requesterAssignmentId: a.id, targetStaffId: me.id, targetAssignmentId: null }, { enforceCutoff: true });
        if (!o.ok) continue;
        taken.add(a.id);
        spare--;
        need--;
        items.push({
          kind, day, date: a.dutyDate.toISOString().slice(0, 10), shiftId: a.shiftId, shift: a.shift.name, assignmentId: a.id, fromStaffId: h.id, fromName: h.name,
          sentence: kind === "RELIEVE" ? `${a.shift.name} on ${sayDay(day)} moves from ${h.name}, who is above the average for ${me.cadreId ? "their cadre" : "staff"} this month.` : `${a.shift.name} on ${sayDay(day)} moves from ${h.name}, who is owed a duty. That settles one duty of their credit.`,
          warnings: o.warnings,
        });
      }
    }
  };
  const above = peers.filter((p) => inMonth(p.id) - avg >= 1).sort((a, b) => inMonth(b.id) - inMonth(a.id));
  await give("RELIEVE", above, (id) => Math.floor(inMonth(id) - avg));
  const owed = peers.filter((p) => (balances.get(p.id)?.owed ?? 0) > 0 && !above.includes(p));
  await give("CREDIT", owed, (id) => balances.get(id)?.owed ?? 0);

  return {
    ...base,
    items,
    note: items.length === 0
      ? `${staff.name} is owed ${need} ${need === 1 ? "duty" : "duties"} to reach their share, but none can be moved lawfully right now.`
      : need > 0 ? `This gets ${staff.name} to ${target - need} of ${target} duties. ${need} more could not be found lawfully.` : `This gives ${staff.name} their share of ${target} ${target === 1 ? "duty" : "duties"} for the rest of ${monthName(roster)}.`,
  };
}

export interface Pick {
  kind: ItemKind;
  day?: number;
  shiftId?: string;
  assignmentId?: string;
}

/** Applies the items the supervisor accepted, each checked again first. */
export async function reinstate(facilityId: string, leaveRequestId: string, picks: Pick[], who: ActingUser) {
  const { r, roster } = await context(facilityId, leaveRequestId);
  if (!roster) throw new ReinstateError(409, "There is no published roster for the month they return in.");
  const me = r.staff;
  const done: string[] = [];
  const skipped: { what: string; why: string }[] = [];
  let started = false;
  for (const p of picks) {
    const fresh = await prisma.roster.findUniqueOrThrow({ where: { id: roster.id } });
    const begin = async () => {
      if (started) return;
      started = true;
      await prisma.$transaction(async (tx) => {
        await saveVersion(tx, roster.id, fresh.version + 1, who.email, `Before ${me.fullName} was put back on the roster`);
        await tx.roster.update({ where: { id: roster.id }, data: { version: fresh.version + 1 } });
      });
    };
    if (p.kind === "FILL") {
      if (p.day === undefined || !p.shiftId) { skipped.push({ what: "An item", why: "It was incomplete." }); continue; }
      const data = await loadEngineData(facilityId, roster.id, roster.year, roster.month);
      const s = data.shifts.find((x) => x.id === p.shiftId);
      const what = `${s?.name ?? "A shift"} on ${sayDay(p.day)}`;
      if (!s) { skipped.push({ what, why: "That shift no longer exists." }); continue; }
      if (data.current.some((a) => a.staffId === me.id && a.day === p.day && data.shifts.find((x) => x.id === a.shiftId)?.countsAsDuty)) { skipped.push({ what, why: `${me.fullName} already has a duty that day.` }); continue; }
      const before = checkOf(data, data.current);
      const stillShort = before.some((f) => f.ruleCode === "C11" && f.day === p.day && f.detail?.shiftId === p.shiftId);
      if (!stillShort) { skipped.push({ what, why: "It has been filled since." }); continue; }
      const known = new Set(before.map(findingKey));
      const bad = checkOf(data, [...data.current, { staffId: me.id, shiftId: p.shiftId, day: p.day, locked: true }]).find((f) => f.severity === "BLOCK" && f.staffId === me.id && !known.has(findingKey(f)));
      if (bad) { skipped.push({ what, why: bad.message }); continue; }
      await begin();
      await prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId, staffId: me.id, shiftId: p.shiftId, dutyDate: new Date(p.day * DAY), source: "MANUAL", locked: true, notifiedAt: new Date(), acknowledgementState: "AWAITING" } });
      done.push(what);
      continue;
    }
    if (!p.assignmentId) { skipped.push({ what: "An item", why: "It was incomplete." }); continue; }
    const a = await prisma.rosterAssignment.findFirst({ where: { id: p.assignmentId, rosterId: roster.id }, include: { shift: true } });
    if (!a) { skipped.push({ what: "A duty", why: "It is no longer on the roster." }); continue; }
    const day = Math.floor(a.dutyDate.getTime() / DAY);
    const what = `${a.shift.name} on ${sayDay(day)}`;
    const from = a.staffId;
    const o = await evaluateSwap(facilityId, { rosterId: roster.id, requesterStaffId: from, requesterAssignmentId: a.id, targetStaffId: me.id, targetAssignmentId: null }, { enforceCutoff: true });
    if (!o.ok) { skipped.push({ what, why: o.hard[0] ?? "It is no longer possible." }); continue; }
    await begin();
    await prisma.attendance.updateMany({ where: { rosterAssignmentId: a.id }, data: { rosterAssignmentId: null } });
    await prisma.rosterAssignment.deleteMany({ where: { rosterId: roster.id, staffId: me.id, dutyDate: a.dutyDate, id: { not: a.id } } });
    await prisma.rosterAssignment.update({ where: { id: a.id }, data: { staffId: me.id, source: "MANUAL", locked: true, isCover: false, coverForStaffId: null, notifiedAt: new Date(), acknowledgedAt: null, acknowledgementState: "AWAITING", needsReview: false } });
    if (p.kind === "CREDIT") await settleOne(facilityId, from, "CREDIT");
    await notifyStaff(facilityId, from, { type: "duty_moved", title: `Your ${what} has moved`, body: `${me.fullName} is back from leave and takes it. ${p.kind === "CREDIT" ? "This settles a duty you were owed." : "You were above the average this month."}`, linkUrl: "/my-duties", severity: "INFO" });
    done.push(what);
  }
  if (done.length) {
    await refreshFindings(facilityId, slim(roster));
    await notifyStaff(facilityId, me.id, { type: "reinstated", title: "You are back on the roster", body: `${done.length} ${done.length === 1 ? "duty has" : "duties have"} been added to your ${monthName(roster)} roster. Open My duties to confirm them.`, linkUrl: "/my-duties", severity: "ACTION" });
    await writeAuditLog({ facilityId, actorEmail: who.email, action: "staff_reinstated", entityType: "LeaveRequest", entityId: leaveRequestId, summary: `${who.displayName} put ${me.fullName} back on the ${monthName(roster)} roster after leave: ${done.join("; ")}.` });
  }
  return { done, skipped };
}

const slim = (r: { id: string; year: number; month: number }) => ({ id: r.id, year: r.year, month: r.month });
