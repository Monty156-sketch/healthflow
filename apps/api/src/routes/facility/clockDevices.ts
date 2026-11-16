// Clock devices: a facility's own clocking machine feeds attendance.
// The administrator registers the machine, gives each person their number on it, and imports its punches file.
import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { allowRoles, caller, ADMIN_ROLES } from "../../middleware/facilityAccess.js";
import { normalisePin, pairVisits, parsePunches, sameName, type Punch } from "../../lib/clockImport.js";

export const clockDevicesRouter = Router();
clockDevicesRouter.use(allowRoles(...ADMIN_ROLES));

const DAY = 86_400_000;
const MIN = 60_000;
const hhmm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const clean = (v?: string | null) => (v && v.trim() ? v.trim() : null);

const deviceInput = z.object({
  name: z.string().trim().min(2, "Give the machine a name, such as Main gate clock.").max(80),
  brand: z.string().trim().max(60).nullish(),
  model: z.string().trim().max(60).nullish(),
  serialNumber: z.string().trim().max(80).nullish(),
  ipAddress: z.string().trim().max(60).nullish(),
  notes: z.string().trim().max(500).nullish(),
  active: z.boolean().optional(),
});
const data = (b: z.infer<typeof deviceInput>) => ({
  name: b.name, brand: clean(b.brand), model: clean(b.model), serialNumber: clean(b.serialNumber), ipAddress: clean(b.ipAddress), notes: clean(b.notes),
  ...(b.active === undefined ? {} : { active: b.active }),
});

clockDevicesRouter.get("/", async (req, res) => {
  const { facilityId } = caller(req);
  const [devices, numbered, total] = await Promise.all([
    prisma.clockDevice.findMany({ where: { facilityId }, orderBy: { createdAt: "asc" } }),
    prisma.staff.count({ where: { facilityId, archivedAt: null, clockNumber: { not: null } } }),
    prisma.staff.count({ where: { facilityId, archivedAt: null } }),
  ]);
  res.json({ devices, numbered, total });
});

clockDevicesRouter.post("/", async (req, res) => {
  const who = caller(req);
  const body = parseOr400(deviceInput, req.body, res);
  if (!body) return;
  const d = await prisma.clockDevice.create({ data: { facilityId: who.facilityId, ...data(body) } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "clock_device_added", entityType: "ClockDevice", entityId: d.id, summary: `${who.displayName} added the clock device "${d.name}".` });
  res.status(201).json(d);
});

// ---------------------------------------------------------------- each person's number on the machine

clockDevicesRouter.get("/people", async (req, res) => {
  const { facilityId } = caller(req);
  const staff = await prisma.staff.findMany({ where: { facilityId, archivedAt: null }, select: { id: true, fullName: true, staffNo: true, clockNumber: true, officeHours: true }, orderBy: { fullName: "asc" } });
  res.json({ staff });
});

const numbersInput = z.object({
  numbers: z.array(z.object({ staffId: z.string().min(1), clockNumber: z.string().trim().max(20).regex(/^[A-Za-z0-9-]*$/, "Use letters, digits or a dash only.").nullable(), officeHours: z.boolean().optional() })).min(1).max(2000),
});
clockDevicesRouter.put("/people", async (req, res) => {
  const who = caller(req);
  const body = parseOr400(numbersInput, req.body, res);
  if (!body) return;
  const wanted = body.numbers.map((n) => ({ staffId: n.staffId, no: n.clockNumber ? n.clockNumber : null }));
  // Two people cannot share a number: "7" and "007" count as the same.
  const seen = new Map<string, string>();
  for (const w of wanted) {
    if (!w.no) continue;
    const k = normalisePin(w.no);
    if (seen.has(k) && seen.get(k) !== w.staffId) return res.status(409).json({ error: "duplicate_number", message: `The number ${w.no} is given to more than one person.` });
    seen.set(k, w.staffId);
  }
  const mine = await prisma.staff.findMany({ where: { facilityId: who.facilityId, id: { in: wanted.map((w) => w.staffId) } }, select: { id: true } });
  if (mine.length !== new Set(wanted.map((w) => w.staffId)).size) return res.status(404).json({ error: "not_found", message: "Someone in the list is not on your staff list." });
  // Numbers held by people not in this request must not clash either.
  const others = await prisma.staff.findMany({ where: { facilityId: who.facilityId, clockNumber: { not: null }, id: { notIn: wanted.map((w) => w.staffId) } }, select: { clockNumber: true } });
  for (const o of others) if (seen.has(normalisePin(o.clockNumber!))) return res.status(409).json({ error: "duplicate_number", message: `The number ${o.clockNumber} already belongs to someone else.` });
  await prisma.$transaction(async (tx) => {
    // Clear first so two people can swap numbers in one save.
    for (const w of wanted) await tx.staff.update({ where: { id: w.staffId }, data: { clockNumber: null } });
    for (const w of wanted) if (w.no) await tx.staff.update({ where: { id: w.staffId }, data: { clockNumber: w.no } });
    for (const n of body.numbers) if (n.officeHours !== undefined) await tx.staff.update({ where: { id: n.staffId }, data: { officeHours: n.officeHours } });
  });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "clock_numbers_set", entityType: "Staff", entityId: who.facilityId, summary: `${who.displayName} set clock numbers for ${wanted.length} staff.` });
  res.json({ saved: wanted.length });
});

clockDevicesRouter.put("/:id", async (req, res) => {
  const who = caller(req);
  const body = parseOr400(deviceInput, req.body, res);
  if (!body) return;
  const found = await prisma.clockDevice.findFirst({ where: { id: req.params.id, facilityId: who.facilityId }, select: { id: true } });
  if (!found) return res.status(404).json({ error: "not_found", message: "That clock device was not found." });
  const d = await prisma.clockDevice.update({ where: { id: found.id }, data: data(body) });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "clock_device_changed", entityType: "ClockDevice", entityId: d.id, summary: `${who.displayName} changed the clock device "${d.name}".` });
  res.json(d);
});

clockDevicesRouter.delete("/:id", async (req, res) => {
  const who = caller(req);
  const found = await prisma.clockDevice.findFirst({ where: { id: req.params.id, facilityId: who.facilityId } });
  if (!found) return res.status(404).json({ error: "not_found", message: "That clock device was not found." });
  await prisma.clockDevice.delete({ where: { id: found.id } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "clock_device_removed", entityType: "ClockDevice", entityId: found.id, summary: `${who.displayName} removed the clock device "${found.name}". Attendance already made from it is kept.` });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- importing punches

const importInput = z.object({ text: z.string().min(1, "Choose the punches file.").max(12_000_000), apply: z.boolean() });
const TEN_MB = express.json({ limit: "12mb" });

clockDevicesRouter.post("/:id/import", TEN_MB, async (req, res) => {
  const who = caller(req);
  const body = parseOr400(importInput, req.body, res);
  if (!body) return;
  const device = await prisma.clockDevice.findFirst({ where: { id: req.params.id, facilityId: who.facilityId } });
  if (!device) return res.status(404).json({ error: "not_found", message: "That clock device was not found." });

  const { punches, skipped } = parsePunches(body.text);
  if (!punches.length) return res.status(400).json({ error: "no_punches", message: "No punches were found in that file. Export the Transaction report from ZKBio Time as CSV or Excel, or use the machine's attendance file." });

  const everyone = await prisma.staff.findMany({ where: { facilityId: who.facilityId, archivedAt: null }, select: { id: true, fullName: true, clockNumber: true, officeHours: true } });
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
        where: { facilityId: who.facilityId, staffId: { in: staffIds }, roster: { status: "PUBLISHED" }, shift: { countsAsDuty: true }, dutyDate: { gte: new Date((Math.floor(Math.min(...allTimes) / DAY) - 1) * DAY), lte: new Date(Math.floor(Math.max(...allTimes) / DAY) * DAY) } },
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
    const hols = await prisma.publicHoliday.findMany({ where: { OR: [{ facilityId: who.facilityId }, { facilityId: null }], date: { gte: new Date(first * DAY), lte: new Date(last * DAY) } }, select: { date: true } });
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
    ids.length ? prisma.attendance.findMany({ where: { facilityId: who.facilityId, rosterAssignmentId: { in: ids } }, select: { rosterAssignmentId: true } }) : [],
    officeDays.length ? prisma.attendance.findMany({ where: { facilityId: who.facilityId, rosterAssignmentId: null, staffId: { in: [...new Set(officeDays.map((x) => x.w.d.staffId))] }, dutyDate: { in: officeDays.map((x) => x.w.d.dutyDate) } }, select: { staffId: true, dutyDate: true } }) : [],
    prisma.attendanceMonthApproval.findMany({ where: { facilityId: who.facilityId }, select: { year: true, month: true } }),
  ]);
  const have = new Set([...existing.map((e) => e.rosterAssignmentId as string), ...existingOffice.map((e) => `office:${e.staffId}:${Math.floor(e.dutyDate.getTime() / DAY)}`)]);
  const locked = new Set(approvals.map((a) => `${a.year}-${a.month}`));

  const results = [...byDuty.values()].map(({ w, v }) => {
    const diff = Math.round((v.arrived.getTime() - w.s) / MIN);
    const late = diff > 0 ? diff : 0;
    const dd = w.d.dutyDate;
    return {
      assignment: w.d, name: nameOf.get(w.d.staffId) ?? "", dutyDate: dd.toISOString().slice(0, 10), arrived: v.arrived, left: v.left,
      status: late > 15 ? ("LATE" as const) : ("PRESENT" as const), minutesLate: late > 0 ? late : null, minutesEarly: diff < 0 ? -diff : null,
      action: locked.has(`${dd.getUTCFullYear()}-${dd.getUTCMonth() + 1}`) ? ("month_locked" as const) : have.has(w.d.id) ? ("already_recorded" as const) : ("new" as const),
    };
  }).sort((a, b) => a.dutyDate.localeCompare(b.dutyDate) || a.name.localeCompare(b.name));

  const summary = {
    punchesRead: punches.length, unreadableLines: skipped, notOnStaffList, punchesWithNoDuty: noDuty, people: staffIds.length,
    attendanceNew: results.filter((r) => r.action === "new").length,
    alreadyRecorded: results.filter((r) => r.action === "already_recorded").length,
    monthLocked: results.filter((r) => r.action === "month_locked").length,
    noCheckOut: results.filter((r) => r.action === "new" && !r.left).length,
    checkOutWithoutCheckIn: orphanOuts.length,
  };
  const rows = results.slice(0, 1500).map((r) => ({ name: r.name, dutyDate: r.dutyDate, arrived: r.arrived.toISOString().slice(11, 16), left: r.left ? r.left.toISOString().slice(11, 16) : null, status: r.status, minutesLate: r.minutesLate, minutesEarly: r.minutesEarly, action: r.action }));
  const toCheck = orphanOuts.slice(0, 300).map((o) => ({ name: nameOf.get(o.staffId) ?? "", date: o.at.toISOString().slice(0, 10), time: o.at.toISOString().slice(11, 16) }));
  if (!body.apply) return res.json({ applied: false, summary, rows, toCheck });

  const fresh = results.filter((r) => r.action === "new");
  await prisma.$transaction(async (tx) => {
    // Every punch is kept as the machine reported it, once.
    const kept = [...mine].flatMap(([staffId, list]) => list.map((p) => ({ facilityId: who.facilityId, deviceId: device.id, staffId, at: p.at })));
    for (let i = 0; i < kept.length; i += 2000) await tx.devicePunch.createMany({ data: kept.slice(i, i + 2000), skipDuplicates: true });
    await tx.attendance.createMany({
      data: fresh.map((r) => ({
        facilityId: who.facilityId, staffId: r.assignment.staffId, rosterId: r.assignment.rosterId, rosterAssignmentId: r.assignment.office ? null : r.assignment.id, dutyDate: r.assignment.dutyDate, shiftId: r.assignment.shiftId,
        status: r.status, minutesLate: r.minutesLate, minutesEarly: r.minutesEarly, clockedAt: r.arrived, source: "DEVICE", recordedBy: `Clock device: ${device.name}`,
        note: r.left ? `Clocked on the facility's machine. Left at ${r.left.toISOString().slice(11, 16)}.` : "Clocked on the facility's machine. No check-out was recorded.",
      })),
    });
    await tx.clockDevice.update({ where: { id: device.id }, data: { lastImportAt: new Date() } });
  }, { timeout: 60_000, maxWait: 15_000 });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "clock_device_import", entityType: "ClockDevice", entityId: device.id, summary: `${who.displayName} imported ${punches.length} punches from "${device.name}" and made ${fresh.length} attendance records.` });
  res.json({ applied: true, summary, rows, toCheck });
});
