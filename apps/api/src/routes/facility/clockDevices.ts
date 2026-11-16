// Clock devices: a facility's own clocking machine feeds attendance.
// The administrator registers the machine, gives each person their number on it, and imports its punches file.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { allowRoles, caller, ADMIN_ROLES } from "../../middleware/facilityAccess.js";
import { normalisePin, parsePunches } from "../../lib/clockImport.js";
import { monthLocked } from "./attendance.js";

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
  const staff = await prisma.staff.findMany({ where: { facilityId, archivedAt: null }, select: { id: true, fullName: true, staffNo: true, clockNumber: true }, orderBy: { fullName: "asc" } });
  res.json({ staff });
});

const numbersInput = z.object({
  numbers: z.array(z.object({ staffId: z.string().min(1), clockNumber: z.string().trim().max(20).regex(/^[A-Za-z0-9-]*$/, "Use letters, digits or a dash only.").nullable() })).min(1).max(2000),
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

const importInput = z.object({ text: z.string().min(1, "Paste or choose the punches file.").max(90_000), apply: z.boolean() });

clockDevicesRouter.post("/:id/import", async (req, res) => {
  const who = caller(req);
  const body = parseOr400(importInput, req.body, res);
  if (!body) return;
  const device = await prisma.clockDevice.findFirst({ where: { id: req.params.id, facilityId: who.facilityId } });
  if (!device) return res.status(404).json({ error: "not_found", message: "That clock device was not found." });

  const { punches, skipped } = parsePunches(body.text);
  if (!punches.length) return res.status(400).json({ error: "no_punches", message: "No punches were found in that file. It should have one punch per line: the person's number, then the date and time." });

  const people = await prisma.staff.findMany({ where: { facilityId: who.facilityId, clockNumber: { not: null } }, select: { id: true, fullName: true, clockNumber: true } });
  const byPin = new Map(people.map((p) => [normalisePin(p.clockNumber!), p]));
  const unknown = new Map<string, number>();
  const known: { staffId: string; at: Date }[] = [];
  for (const p of punches) {
    const s = byPin.get(normalisePin(p.pin));
    if (!s) { unknown.set(p.pin, (unknown.get(p.pin) ?? 0) + 1); continue; }
    known.push({ staffId: s.id, at: p.at });
  }

  // Match each person's punches to the duty they were rostered for: arrival is the first punch, departure the last.
  const staffIds = [...new Set(known.map((k) => k.staffId))];
  const times = known.map((k) => k.at.getTime());
  const from = Math.floor(Math.min(...times, Infinity) / DAY) - 1;
  const to = Math.floor(Math.max(...times, -Infinity) / DAY);
  const duties = staffIds.length
    ? await prisma.rosterAssignment.findMany({
        where: { facilityId: who.facilityId, staffId: { in: staffIds }, roster: { status: "PUBLISHED" }, shift: { countsAsDuty: true }, dutyDate: { gte: new Date(from * DAY), lte: new Date(to * DAY) } },
        include: { shift: { select: { startTime: true, endTime: true } } },
      })
    : [];
  const windows = duties.flatMap((d) => {
    if (!d.shift.startTime || !d.shift.endTime) return [];
    const base = Math.floor(d.dutyDate.getTime() / DAY) * DAY;
    const s = base + hhmm(d.shift.startTime) * MIN;
    let e = base + hhmm(d.shift.endTime) * MIN;
    if (e <= s) e += DAY;
    return [{ d, s, e }];
  });

  type Out = { staffId: string; name: string; dutyDate: string; arrived: Date; left: Date | null; status: string; minutesLate: number | null; minutesEarly: number | null; action: "new" | "already_recorded" | "month_locked"; assignment: (typeof duties)[number] };
  const nameOf = new Map(people.map((p) => [p.id, p.fullName]));
  const groups = new Map<string, { w: (typeof windows)[number]; ats: Date[] }>();
  let noDuty = 0;
  for (const k of known) {
    const t = k.at.getTime();
    // A punch belongs to the duty it falls in, allowing three hours before the start and four after the end.
    const w = windows.filter((x) => x.d.staffId === k.staffId && t >= x.s - 180 * MIN && t <= x.e + 240 * MIN).sort((a, b) => Math.abs(a.s - t) - Math.abs(b.s - t))[0];
    if (!w) { noDuty++; continue; }
    const g = groups.get(w.d.id) ?? { w, ats: [] };
    g.ats.push(k.at);
    groups.set(w.d.id, g);
  }

  const results: Out[] = [];
  for (const { w, ats } of groups.values()) {
    ats.sort((a, b) => a.getTime() - b.getTime());
    const arrived = ats[0];
    const last = ats[ats.length - 1];
    const left = last.getTime() - arrived.getTime() >= 30 * MIN ? last : null;
    const diff = Math.round((arrived.getTime() - w.s) / MIN);
    const late = diff > 0 ? diff : 0;
    const exists = await prisma.attendance.findFirst({ where: { staffId: w.d.staffId, rosterAssignmentId: w.d.id }, select: { id: true } });
    const locked = await monthLocked(who.facilityId, w.d.dutyDate);
    results.push({
      staffId: w.d.staffId, name: nameOf.get(w.d.staffId) ?? "", dutyDate: w.d.dutyDate.toISOString().slice(0, 10), arrived, left,
      status: late > 15 ? "LATE" : "PRESENT", minutesLate: late > 0 ? late : null, minutesEarly: diff < 0 ? -diff : null,
      action: locked ? "month_locked" : exists ? "already_recorded" : "new", assignment: w.d,
    });
  }
  results.sort((a, b) => a.dutyDate.localeCompare(b.dutyDate) || a.name.localeCompare(b.name));

  const summary = {
    punchesRead: punches.length, unreadableLines: skipped, notOnStaffList: [...unknown].map(([pin, count]) => ({ pin, count })),
    punchesWithNoDuty: noDuty, people: staffIds.length,
    attendanceNew: results.filter((r) => r.action === "new").length,
    alreadyRecorded: results.filter((r) => r.action === "already_recorded").length,
    monthLocked: results.filter((r) => r.action === "month_locked").length,
  };
  const rows = results.map((r) => ({ name: r.name, dutyDate: r.dutyDate, arrived: r.arrived.toISOString().slice(11, 16), left: r.left ? r.left.toISOString().slice(11, 16) : null, status: r.status, minutesLate: r.minutesLate, minutesEarly: r.minutesEarly, action: r.action }));
  if (!body.apply) return res.json({ applied: false, summary, rows });

  let made = 0;
  await prisma.$transaction(async (tx) => {
    // Every punch is kept as the machine reported it, once.
    await tx.devicePunch.createMany({ data: known.map((k) => ({ facilityId: who.facilityId, deviceId: device.id, staffId: k.staffId, at: k.at })), skipDuplicates: true });
    for (const r of results) {
      if (r.action !== "new") continue;
      const a = r.assignment;
      await tx.attendance.create({
        data: {
          facilityId: who.facilityId, staffId: a.staffId, rosterId: a.rosterId, rosterAssignmentId: a.id, dutyDate: a.dutyDate, shiftId: a.shiftId,
          status: r.status as "PRESENT" | "LATE", minutesLate: r.minutesLate, minutesEarly: r.minutesEarly, clockedAt: r.arrived, source: "DEVICE", recordedBy: `Clock device: ${device.name}`,
          note: r.left ? `Clocked on the facility's machine. Left at ${r.left.toISOString().slice(11, 16)}.` : "Clocked on the facility's machine.",
        },
      });
      made++;
    }
    await tx.clockDevice.update({ where: { id: device.id }, data: { lastImportAt: new Date() } });
  });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "clock_device_import", entityType: "ClockDevice", entityId: device.id, summary: `${who.displayName} imported ${punches.length} punches from "${device.name}" and made ${made} attendance records.` });
  res.json({ applied: true, summary: { ...summary, attendanceNew: made }, rows });
});
