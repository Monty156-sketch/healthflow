// Shift handover notes. The outgoing shift leaves what the incoming one needs to know, for one ward and one shift.
// No patient names: bed numbers and what needs doing. Everyone on the ward can read the notes and each reading is recorded,
// so an in-charge can see that the message arrived.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { notifyWard } from "../../lib/notify.js";
import { parseOr400 } from "../../lib/validate.js";
import { caller, ADMIN_ROLES, READ_ROLES } from "../../middleware/facilityAccess.js";
import { patientProblem } from "../../lib/patientData.js";

export const handoverRouter = Router();

const DAY = 86_400_000;
const EDIT_WINDOW_MS = 12 * 3_600_000;
const isManager = (role: string) => (READ_ROLES as readonly string[]).includes(role);
const dateOf = (d: Date) => d.toISOString().slice(0, 10);

const body = z.object({
  shiftId: z.string().min(1, "Choose the shift."),
  dutyDate: z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)), "Enter a real date."),
  ward: z.string().min(1).nullish(),
  summary: z.string().trim().min(3, "Say how the ward was.").max(2000, "Keep it under 2000 characters."),
  pending: z.string().trim().max(2000, "Keep it under 2000 characters.").nullish().transform((v) => v || null),
  concerns: z.string().trim().max(2000, "Keep it under 2000 characters.").nullish().transform((v) => v || null),
  urgent: z.boolean().default(false),
});

/**
 * Which ward a request is about. Staff are held to their own ward. A ward manager to theirs.
 * The administrator and a supervisor choose. `null` is a facility with no wards, or all of them for a reader.
 */
async function wardFor(req: Parameters<typeof caller>[0], asked: unknown): Promise<{ fixed: boolean; ward: string | null }> {
  const who = caller(req);
  if (who.departmentId) return { fixed: true, ward: who.departmentId };
  if (!isManager(who.role)) {
    const me = who.staffId ? await prisma.staff.findFirst({ where: { id: who.staffId, facilityId: who.facilityId }, select: { departmentId: true } }) : null;
    return { fixed: true, ward: me?.departmentId ?? null };
  }
  return { fixed: false, ward: typeof asked === "string" && asked ? asked : null };
}

/** Names the ward legitimately uses, so they are not mistaken for a patient's name. */
async function knownNames(facilityId: string) {
  const [f, depts, shifts, cadres, staff] = await Promise.all([
    prisma.facility.findUnique({ where: { id: facilityId }, select: { name: true } }),
    prisma.department.findMany({ where: { facilityId }, select: { name: true } }),
    prisma.shift.findMany({ where: { facilityId }, select: { name: true } }),
    prisma.cadre.findMany({ where: { facilityId }, select: { name: true } }),
    prisma.staff.findMany({ where: { facilityId, status: { in: ["ACTIVE", "ON_LEAVE"] } }, select: { fullName: true } }),
  ]);
  return [f?.name ?? "", ...depts.map((d) => d.name), ...shifts.map((s) => s.name), ...cadres.map((c) => c.name), ...staff.map((s) => s.fullName)];
}

/** Field errors for any of the three texts that seems to name a patient, or null when they are clean. */
async function patientFields(facilityId: string, texts: Record<"summary" | "pending" | "concerns", string | null | undefined>) {
  const known = await knownNames(facilityId);
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(texts)) {
    const problem = patientProblem(v, known);
    if (problem) fields[k] = problem;
  }
  return Object.keys(fields).length ? fields : null;
}

const present = (n: { id: string; departmentId: string | null; department?: { name: string } | null; shiftId: string; shift: { name: string }; dutyDate: Date; authorName: string; authorEmail: string; summary: string; pending: string | null; concerns: string | null; urgent: boolean; createdAt: Date; reads: { readerEmail: string; readerName: string; readAt: Date }[] }, me: string, manager: boolean) => ({
  id: n.id, ward: n.department?.name ?? null, departmentId: n.departmentId, shiftId: n.shiftId, shift: n.shift.name, dutyDate: dateOf(n.dutyDate),
  author: n.authorName, mine: n.authorEmail === me, summary: n.summary, pending: n.pending, concerns: n.concerns, urgent: n.urgent, createdAt: n.createdAt.toISOString(),
  read: n.authorEmail === me || n.reads.some((r) => r.readerEmail === me),
  readCount: n.reads.length,
  ...(manager ? { readers: n.reads.map((r) => ({ name: r.readerName, at: r.readAt.toISOString() })) } : {}),
});
const include = { department: { select: { name: true } }, shift: { select: { name: true } }, reads: { select: { readerEmail: true, readerName: true, readAt: true } } } as const;

/** The shifts to choose from and the wards the caller may look at. */
handoverRouter.get("/options", async (req, res) => {
  const who = caller(req);
  const { fixed, ward } = await wardFor(req, req.query.ward);
  const [shifts, wards] = await Promise.all([
    prisma.shift.findMany({ where: { facilityId: who.facilityId, active: true, countsAsDuty: true, isOnCall: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, startTime: true, endTime: true } }),
    prisma.department.findMany({ where: { facilityId: who.facilityId, active: true, kind: "WARD", ...(fixed && ward ? { id: ward } : {}) }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  res.json({ shifts, wards, fixed, ward });
});

/** How many notes in the caller's ward are waiting to be read. */
handoverRouter.get("/unread", async (req, res) => {
  const who = caller(req);
  const { ward } = await wardFor(req, req.query.ward);
  const since = new Date(Math.floor(Date.now() / DAY) * DAY - 2 * DAY);
  const count = await prisma.handoverNote.count({
    where: { facilityId: who.facilityId, archivedAt: null, dutyDate: { gte: since }, ...(ward ? { departmentId: ward } : {}), authorEmail: { not: who.email }, reads: { none: { readerEmail: who.email } } },
  });
  res.json({ unread: count });
});

/** Recent notes for a ward, newest first. */
handoverRouter.get("/", async (req, res) => {
  const who = caller(req);
  const { ward } = await wardFor(req, req.query.ward);
  const days = Math.min(Math.max(Number(req.query.days) || 3, 1), 14);
  const since = new Date(Math.floor(Date.now() / DAY) * DAY - (days - 1) * DAY);
  const notes = await prisma.handoverNote.findMany({
    where: { facilityId: who.facilityId, archivedAt: null, dutyDate: { gte: since }, ...(ward ? { departmentId: ward } : {}) },
    include,
    orderBy: [{ dutyDate: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  const manager = isManager(who.role);
  res.json({ notes: notes.map((n) => present(n, who.email, manager)) });
});

handoverRouter.post("/", async (req, res) => {
  const who = caller(req);
  const input = parseOr400(body, req.body, res);
  if (!input) return;
  const { fixed, ward } = await wardFor(req, input.ward);
  const departmentId = ward;
  const today = Math.floor(Date.now() / DAY);
  const day = Math.floor(Date.parse(input.dutyDate) / DAY);
  if (day > today || day < today - 2) return res.status(400).json({ error: "invalid_input", fields: { dutyDate: "Choose today or one of the last two days." } });
  const shift = await prisma.shift.findFirst({ where: { id: input.shiftId, facilityId: who.facilityId, active: true } });
  if (!shift) return res.status(400).json({ error: "invalid_input", fields: { shiftId: "Choose a shift from the list." } });
  if (departmentId) {
    const dept = await prisma.department.findFirst({ where: { id: departmentId, facilityId: who.facilityId, active: true } });
    if (!dept) return res.status(400).json({ error: "invalid_input", fields: { ward: "Choose a ward from the list." } });
  } else if (!fixed) {
    // A facility with wards needs the note to say which. One with none leaves it empty.
    const wards = await prisma.department.count({ where: { facilityId: who.facilityId, active: true, kind: "WARD" } });
    if (wards > 0) return res.status(400).json({ error: "invalid_input", fields: { ward: "Choose the ward." } });
  }
  const named = await patientFields(who.facilityId, { summary: input.summary, pending: input.pending, concerns: input.concerns });
  if (named) return res.status(400).json({ error: "invalid_input", fields: named });
  const note = await prisma.handoverNote.create({
    data: { facilityId: who.facilityId, departmentId, shiftId: shift.id, dutyDate: new Date(`${input.dutyDate}T00:00:00.000Z`), authorEmail: who.email, authorName: who.displayName, summary: input.summary, pending: input.pending, concerns: input.concerns, urgent: input.urgent },
    include,
  });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "handover_written", entityType: "HandoverNote", entityId: note.id, summary: `${who.displayName} left a ${shift.name} handover note${note.department ? ` for ${note.department.name}` : ""}${input.urgent ? ", marked urgent" : ""}.` });
  if (input.urgent) {
    await notifyWard(who.facilityId, departmentId, { type: "handover_urgent", title: `Urgent handover${note.department ? `, ${note.department.name}` : ""}`, body: `${who.displayName} marked the ${shift.name} handover as needing attention first.`, linkUrl: "/handover", severity: "ACTION" });
  }
  res.status(201).json({ note: present(note, who.email, isManager(who.role)) });
});

/** Loads a note the caller may see: their ward's, or any for the administrator or supervisor. */
async function visible(req: Parameters<typeof caller>[0], res: import("express").Response) {
  const who = caller(req);
  const note = await prisma.handoverNote.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId, archivedAt: null }, include });
  if (!note) { res.status(404).json({ error: "not_found" }); return null; }
  const { fixed, ward } = await wardFor(req, undefined);
  if (fixed && note.departmentId !== ward) { res.status(404).json({ error: "not_found" }); return null; }
  return { who, note };
}

handoverRouter.post("/:id/read", async (req, res) => {
  const hit = await visible(req, res);
  if (!hit) return;
  const { who, note } = hit;
  if (note.authorEmail !== who.email) {
    await prisma.handoverRead.upsert({
      where: { noteId_readerEmail: { noteId: note.id, readerEmail: who.email } },
      create: { noteId: note.id, readerEmail: who.email, readerName: who.displayName },
      update: {},
    });
  }
  res.json({ ok: true });
});

const canChange = (who: ReturnType<typeof caller>, n: { authorEmail: string; createdAt: Date }) =>
  (ADMIN_ROLES as readonly string[]).includes(who.role) || (n.authorEmail === who.email && Date.now() - n.createdAt.getTime() <= EDIT_WINDOW_MS);

handoverRouter.put("/:id", async (req, res) => {
  const hit = await visible(req, res);
  if (!hit) return;
  const { who, note } = hit;
  if (!canChange(who, note)) return res.status(403).json({ error: "forbidden", message: "A note can be changed by its writer for twelve hours, or by the administrator." });
  const input = parseOr400(body.pick({ summary: true, pending: true, concerns: true, urgent: true }), req.body, res);
  if (!input) return;
  const named = await patientFields(who.facilityId, { summary: input.summary, pending: input.pending, concerns: input.concerns });
  if (named) return res.status(400).json({ error: "invalid_input", fields: named });
  const updated = await prisma.handoverNote.update({ where: { id: note.id }, data: { summary: input.summary, pending: input.pending, concerns: input.concerns, urgent: input.urgent }, include });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "handover_changed", entityType: "HandoverNote", entityId: note.id, summary: `${who.displayName} changed a handover note by ${note.authorName}.` });
  res.json({ note: present(updated, who.email, isManager(who.role)) });
});

handoverRouter.delete("/:id", async (req, res) => {
  const hit = await visible(req, res);
  if (!hit) return;
  const { who, note } = hit;
  if (!canChange(who, note)) return res.status(403).json({ error: "forbidden", message: "A note can be removed by its writer for twelve hours, or by the administrator." });
  await prisma.handoverNote.update({ where: { id: note.id }, data: { archivedAt: new Date() } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "handover_removed", entityType: "HandoverNote", entityId: note.id, summary: `${who.displayName} removed a handover note by ${note.authorName}.` });
  res.json({ ok: true });
});
