// Clock devices: a facility's own clocking machine feeds attendance.
// The administrator registers the machine, gives each person their number on it, and imports its punches file.
import express, { Router } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { allowRoles, caller, ADMIN_ROLES } from "../../middleware/facilityAccess.js";
import { normalisePin, parsePunches } from "../../lib/clockImport.js";
import { runPunchImport } from "../../lib/clockPipeline.js";
import { hashKey } from "../../lib/clockLink.js";
import { asSystem } from "../../lib/tenant.js";

export const clockDevicesRouter = Router();
clockDevicesRouter.use(allowRoles(...ADMIN_ROLES));

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

/** A machine is found by its serial number, so the same number cannot be registered twice, even by another facility. */
async function serialTaken(serial: string | null, exceptId?: string) {
  if (!serial) return false;
  const n = await asSystem(() => prisma.clockDevice.count({ where: { serialNumber: { equals: serial, mode: "insensitive" }, ...(exceptId ? { NOT: { id: exceptId } } : {}) } }));
  return n > 0;
}
const SERIAL_TAKEN = { error: "serial_taken", message: "That serial number is already registered. Check it on the machine itself: Menu, System Info, Device Info." };

clockDevicesRouter.get("/", async (req, res) => {
  const { facilityId } = caller(req);
  const [devices, numbered, total] = await Promise.all([
    prisma.clockDevice.findMany({ where: { facilityId }, orderBy: { createdAt: "asc" } }),
    prisma.staff.count({ where: { facilityId, archivedAt: null, clockNumber: { not: null } } }),
    prisma.staff.count({ where: { facilityId, archivedAt: null } }),
  ]);
  // machineAddress: the web name the machines are told to send to (set once, when it exists); empty until then.
  res.json({ devices: devices.map(({ apiKeyHash, ...d }) => ({ ...d, linked: Boolean(apiKeyHash) })), numbered, total, machineAddress: process.env.CLOCK_HOST?.trim() || null });
});

clockDevicesRouter.post("/", async (req, res) => {
  const who = caller(req);
  const body = parseOr400(deviceInput, req.body, res);
  if (!body) return;
  if (await serialTaken(clean(body.serialNumber))) return res.status(409).json(SERIAL_TAKEN);
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
  if (await serialTaken(clean(body.serialNumber), found.id)) return res.status(409).json(SERIAL_TAKEN);
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

// ---------------------------------------------------------------- the automatic link from ZKBio Time

/** A new key for the small program on the hospital PC. Shown once; only a fingerprint of it is kept. */
clockDevicesRouter.post("/:id/link-key", async (req, res) => {
  const who = caller(req);
  const found = await prisma.clockDevice.findFirst({ where: { id: req.params.id, facilityId: who.facilityId } });
  if (!found) return res.status(404).json({ error: "not_found", message: "That clock device was not found." });
  const key = `hfk_${randomBytes(32).toString("base64url")}`;
  await prisma.clockDevice.update({ where: { id: found.id }, data: { apiKeyHash: hashKey(key), apiKeyCreatedAt: new Date() } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "clock_link_key_made", entityType: "ClockDevice", entityId: found.id, summary: `${who.displayName} made a new link key for "${found.name}". Any older key stopped working.` });
  res.status(201).json({ key });
});

clockDevicesRouter.delete("/:id/link-key", async (req, res) => {
  const who = caller(req);
  const found = await prisma.clockDevice.findFirst({ where: { id: req.params.id, facilityId: who.facilityId } });
  if (!found) return res.status(404).json({ error: "not_found", message: "That clock device was not found." });
  await prisma.clockDevice.update({ where: { id: found.id }, data: { apiKeyHash: null, apiKeyCreatedAt: null } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "clock_link_off", entityType: "ClockDevice", entityId: found.id, summary: `${who.displayName} turned off the automatic link for "${found.name}".` });
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

  res.json(await runPunchImport({ facilityId: who.facilityId, device, punches, skipped, apply: body.apply, audit: true, actor: who.displayName, actorEmail: who.email }));
});
