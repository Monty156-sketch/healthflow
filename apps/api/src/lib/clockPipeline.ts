// The one place punches become attendance. Used by the file import on the Clock devices page and by the automatic ZKBio Time link,
// so the two can never disagree.
import { prisma } from "./prisma.js";
import { writeAuditLog } from "./audit.js";
import { normalisePin, pairVisits, sameName, type Punch } from "./clockImport.js";

const DAY = 86_400_000;
const MIN = 60_000;
const hhmm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

export type ImportOptions = { facilityId: string; device: { id: string; name: string }; punches: Punch[]; skipped: number; apply: boolean; audit: boolean; actor: string; actorEmail: string };

export async function runPunchImport(o: ImportOptions) {
  const { punches, skipped } = o;
  const everyone = await prisma.staff.findMany({ where: { facilityId: o.facilityId, archivedAt: null }, select: { id: true, fullName: true, clockNumber: true, officeHours: true } });
  const byPin = new Map(everyone.filter((p) => p.clockNumber).map((p) => [normalisePin(p.clockNumber!), p]));
  const nameOf = new Map(everyone.map((p) => [p.id, p.fullName]));

  // Punches from people with no number here are listed, with a suggested match by name when the file carries names.
  const unknown = new Map<string, { count: number; name?: string; dept?: string }>();
  const mine = new Map<string, Punch[]>();
  for (const p of punches) {
    const s = byPin.get(normalisePin(p.pin));
    if (!s) { const u = unknown.get(p.pin) ?? { count: 0, name: p.name, dept: p.dept }; u.count++; unknown.set(p.pin, u); continue; }
    mine.set(s.id, [...(mine.get(s.id) ?? []), p]);
  }
  const free = everyone.filter((p) => !p.clockNumber);
  const notOnStaffList = [...unknown].map(([pin, u]) => {
    const hits = u.name ? free.filter((f) => sameName(f.fullName, u.name!)) : [];
    return { pin, count: u.count, name: u.name ?? null, department: u.dept ?? null, suggestion: hits.length === 1 ? { staffId: hits[0].id, fullName: hits[0].fullName } : null };
  });

  // Each person's punches become visits (arrival, departure). The machine's own Check In / Check Out words are used when the file has them.
  type Visit = { staffId: string; arrived: Date; left: Date | null; fixedWindow?: Win };
  type Win = { d: DutyRow; s: number; e: number };
  const visits: Visit[] = [];
  const orphanOuts: { staffId: string; at: Date }[] = [];
  const stateless: { staffId: string; at: Date }[] = [];
  for (const [staffId, list] of mine) {
    const withState = list.filter((p) => p.state);
    if (withState.length) {
      const r = pairVisits(withState.map((p) => ({ at: p.at, state: p.state! })));
      visits.push(...r.visits.map((v) => ({ staffId, ...v })));
      orphanOuts.push(...r.orphanOuts.map((at) => ({ staffId, at })));
    }
    stateless.push(...list.filter((p) => !p.state).map((p) => ({ staffId, at: p.at })));
  }

  const staffIds = [...mine.keys()];
  const allTimes = [...visits.map((v) => v.arrived.getTime()), ...stateless.map((x) => x.at.getTime())];
  const duties = staffIds.length && allTimes.length
    ? await prisma.rosterAssignment.findMany({
        where: { facilityId: o.facilityId, staffId: { in: staffIds }, roster: { status: "PUBLISHED" }, shift: { countsAsDuty: true }, dutyDate: { gte: new Date((Math.floor(Math.min(...allTimes) / DAY) - 1) * DAY), lte: new Date(Math.floor(Math.max(...allTimes) / DAY) * DAY) } },
        include: { shift: { select: { startTime: true, endTime: true } } },
      })
    : [];
  type DutyRow = { id: string; staffId: string; rosterId: string | null; shiftId: string | null; dutyDate: Date; office: boolean };
  const windows: Win[] = duties.flatMap((d) => {
    if (!d.shift.startTime || !d.shift.endTime) return [];
    const base = Math.floor(d.dutyDate.getTime() / DAY) * DAY;
    const st = base + hhmm(d.shift.startTime) * MIN;
    let e = base + hhmm(d.shift.endTime) * MIN;
    if (e <= st) e += DAY;
    return [{ d: { id: d.id, staffId: d.staffId, rosterId: d.rosterId, shiftId: d.shiftId, dutyDate: d.dutyDate, office: false }, s: st, e }];
  });
  // Office staff have no roster: 08:00 to 17:00 on weekdays that are not public holidays.
  const office = staffIds.filter((id) => everyone.find((p) => p.id === id)?.officeHours);
  if (office.length && allTimes.length) {
    const first = Math.floor(Math.min(...allTimes) / DAY) - 1;
    const last = Math.floor(Math.max(...allTimes) / DAY);
    const hols = await prisma.publicHoliday.findMany({ where: { OR: [{ facilityId: o.facilityId }, { facilityId: null }], date: { gte: new Date(first * DAY), lte: new Date(last * DAY) } }, select: { date: true } });
    const off = new Set(hols.map((h) => Math.floor(h.date.getTime() / DAY)));
    for (let day = first; day <= last; day++) {
      const dow = new Date(day * DAY).getUTCDay();
      if (dow === 0 || dow === 6 || off.has(day)) continue;
      for (const staffId of office) windows.push({ d: { id: `office:${staffId}:${day}`, staffId, rosterId: null, shiftId: null, dutyDate: new Date(day * DAY), office: true }, s: day * DAY + 8 * 60 * MIN, e: day * DAY + 17 * 60 * MIN });
    }
  }
  // A punch belongs to the duty it falls in, allowing three hours before the start and four after the end.
  const winBy = new Map<string, Win[]>();
  for (const w of windows) winBy.set(w.d.staffId, [...(winBy.get(w.d.staffId) ?? []), w]);
  const windowFor = (staffId: string, t: number) => (winBy.get(staffId) ?? []).filter((x) => t >= x.s - 180 * MIN && t <= x.e + 240 * MIN).sort((a, b) => Math.abs(a.s - t) - Math.abs(b.s - t))[0];

  // Without Check In / Check Out words, the first punch in a duty is the arrival and the last (30+ minutes later) the departure.
  const loose = new Map<string, { w: Win; ats: Date[] }>();
  let noDuty = 0;
  for (const x of stateless) {
    const w = windowFor(x.staffId, x.at.getTime());
    if (!w) { noDuty++; continue; }
    const g = loose.get(w.d.id) ?? { w, ats: [] };
    g.ats.push(x.at);
    loose.set(w.d.id, g);
  }
  for (const { w, ats } of loose.values()) {
    ats.sort((a, b) => a.getTime() - b.getTime());
    const last = ats[ats.length - 1];
    visits.push({ staffId: w.d.staffId, arrived: ats[0], left: last.getTime() - ats[0].getTime() >= 30 * MIN ? last : null, fixedWindow: w });
  }

  // Pair each visit with its duty; a second visit in the same duty (a double tap) is folded into the first.
  const byDuty = new Map<string, { w: Win; v: Visit }>();
  for (const v of visits) {
    const w = v.fixedWindow ?? windowFor(v.staffId, v.arrived.getTime());
    if (!w) { noDuty++; continue; }
    const cur = byDuty.get(w.d.id);
    if (!cur) byDuty.set(w.d.id, { w, v });
    else if (v.arrived < cur.v.arrived || (v.left && (!cur.v.left || v.left > cur.v.left))) {
      cur.v = { staffId: v.staffId, arrived: v.arrived < cur.v.arrived ? v.arrived : cur.v.arrived, left: v.left && (!cur.v.left || v.left > cur.v.left) ? v.left : cur.v.left };
    }
  }

  const ids = [...byDuty.values()].filter((x) => !x.w.d.office).map((x) => x.w.d.id);
  const officeDays = [...byDuty.values()].filter((x) => x.w.d.office);
  const [existing, existingOffice, approvals] = await Promise.all([
    ids.length ? prisma.attendance.findMany({ where: { facilityId: o.facilityId, rosterAssignmentId: { in: ids } }, select: { id: true, rosterAssignmentId: true, source: true, note: true } }) : [],
    officeDays.length ? prisma.attendance.findMany({ where: { facilityId: o.facilityId, rosterAssignmentId: null, staffId: { in: [...new Set(officeDays.map((x) => x.w.d.staffId))] }, dutyDate: { in: officeDays.map((x) => x.w.d.dutyDate) } }, select: { id: true, staffId: true, dutyDate: true, source: true, note: true } }) : [],
    prisma.attendanceMonthApproval.findMany({ where: { facilityId: o.facilityId }, select: { year: true, month: true } }),
  ]);
  const have = new Map([
    ...existing.map((e) => [e.rosterAssignmentId as string, e] as const),
    ...existingOffice.map((e) => [`office:${e.staffId}:${Math.floor(e.dutyDate.getTime() / DAY)}`, e] as const),
  ]);
  const locked = new Set(approvals.map((a) => `${a.year}-${a.month}`));

  const results = [...byDuty.values()].map(({ w, v }) => {
    const diff = Math.round((v.arrived.getTime() - w.s) / MIN);
    const late = diff > 0 ? diff : 0;
    const dd = w.d.dutyDate;
    const had = have.get(w.d.id);
    // A later push can bring the check-out for a visit already recorded from the machine: the departure is added to the note.
    const adds = Boolean(had && had.source === "DEVICE" && v.left && !(had.note ?? "").includes("Left at"));
    return {
      existingId: had?.id ?? null,
      assignment: w.d, name: nameOf.get(w.d.staffId) ?? "", dutyDate: dd.toISOString().slice(0, 10), arrived: v.arrived, left: v.left,
      status: late > 15 ? ("LATE" as const) : ("PRESENT" as const), minutesLate: late > 0 ? late : null, minutesEarly: diff < 0 ? -diff : null,
      action: locked.has(`${dd.getUTCFullYear()}-${dd.getUTCMonth() + 1}`) ? ("month_locked" as const) : had ? (adds ? ("departure_added" as const) : ("already_recorded" as const)) : ("new" as const),
    };
  }).sort((a, b) => a.dutyDate.localeCompare(b.dutyDate) || a.name.localeCompare(b.name));

  const summary = {
    punchesRead: punches.length, unreadableLines: skipped, notOnStaffList, punchesWithNoDuty: noDuty, people: staffIds.length,
    attendanceNew: results.filter((r) => r.action === "new").length,
    alreadyRecorded: results.filter((r) => r.action === "already_recorded").length,
    departuresAdded: results.filter((r) => r.action === "departure_added").length,
    monthLocked: results.filter((r) => r.action === "month_locked").length,
    noCheckOut: results.filter((r) => r.action === "new" && !r.left).length,
    checkOutWithoutCheckIn: orphanOuts.length,
  };
  const rows = results.slice(0, 1500).map((r) => ({ name: r.name, dutyDate: r.dutyDate, arrived: r.arrived.toISOString().slice(11, 16), left: r.left ? r.left.toISOString().slice(11, 16) : null, status: r.status, minutesLate: r.minutesLate, minutesEarly: r.minutesEarly, action: r.action }));
  const toCheck = orphanOuts.slice(0, 300).map((x) => ({ name: nameOf.get(x.staffId) ?? "", date: x.at.toISOString().slice(0, 10), time: x.at.toISOString().slice(11, 16) }));
  if (!o.apply) return { applied: false as const, summary, rows, toCheck };

  const fresh = results.filter((r) => r.action === "new");
  await prisma.$transaction(async (tx) => {
    // Every punch is kept as the machine reported it, once.
    const kept = [...mine].flatMap(([staffId, list]) => list.map((p) => ({ facilityId: o.facilityId, deviceId: o.device.id, staffId, at: p.at })));
    for (let i = 0; i < kept.length; i += 2000) await tx.devicePunch.createMany({ data: kept.slice(i, i + 2000), skipDuplicates: true });
    await tx.attendance.createMany({
      data: fresh.map((r) => ({
        facilityId: o.facilityId, staffId: r.assignment.staffId, rosterId: r.assignment.rosterId, rosterAssignmentId: r.assignment.office ? null : r.assignment.id, dutyDate: r.assignment.dutyDate, shiftId: r.assignment.shiftId,
        status: r.status, minutesLate: r.minutesLate, minutesEarly: r.minutesEarly, clockedAt: r.arrived, source: "DEVICE", recordedBy: `Clock device: ${o.device.name}`,
        note: r.left ? `Clocked on the facility's machine. Left at ${r.left.toISOString().slice(11, 16)}.` : "Clocked on the facility's machine. No check-out was recorded.",
      })),
    });
    for (const r of results) if (r.action === "departure_added" && r.existingId) await tx.attendance.update({ where: { id: r.existingId }, data: { note: `Clocked on the facility's machine. Left at ${r.left!.toISOString().slice(11, 16)}.` } });
    await tx.clockDevice.update({ where: { id: o.device.id }, data: { lastImportAt: new Date() } });
  }, { timeout: 60_000, maxWait: 15_000 });
  if (o.audit) await writeAuditLog({ facilityId: o.facilityId, actorEmail: o.actorEmail, action: "clock_device_import", entityType: "ClockDevice", entityId: o.device.id, summary: `${o.actor} imported ${punches.length} punches from "${o.device.name}" and made ${fresh.length} attendance records.` });
  return { applied: true as const, summary, rows, toCheck };
}
