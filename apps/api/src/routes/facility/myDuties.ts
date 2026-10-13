// A staff member's own duties and what was recorded for them. Only their own:
// the staff id comes from their account, never from the request.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { caller } from "../../middleware/facilityAccess.js";
import { notifyDeciders } from "../../lib/notify.js";
import { sayDay } from "../../engine/time.js";

export const myDutiesRouter = Router();

const DAY = 86_400_000;

myDutiesRouter.get("/", async (req, res) => {
  const who = caller(req);
  const q = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "invalid_input", message: "Choose a month." });
  if (!who.staffId) return res.json({ linked: false, month: q.data.month, duties: [] });
  const [y, m] = q.data.month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));
  const [duties, records] = await Promise.all([
    prisma.rosterAssignment.findMany({
      where: { staffId: who.staffId, facilityId: who.facilityId, dutyDate: { gte: from, lte: to }, roster: { status: "PUBLISHED" } },
      include: { shift: true }, orderBy: { dutyDate: "asc" },
    }),
    prisma.attendance.findMany({ where: { staffId: who.staffId, facilityId: who.facilityId, dutyDate: { gte: from, lte: to } } }),
  ]);
  const rec = new Map(records.map((r) => [`${r.dutyDate.getTime()}|${r.shiftId}`, r]));
  res.json({
    linked: true,
    month: q.data.month,
    duties: duties.map((d) => {
      const r = rec.get(`${d.dutyDate.getTime()}|${d.shiftId}`);
      return {
        assignmentId: d.id,
        date: d.dutyDate.toISOString().slice(0, 10),
        shift: { name: d.shift.name, code: d.shift.code, startTime: d.shift.startTime, endTime: d.shift.endTime, colour: d.shift.colour },
        past: d.dutyDate.getTime() <= Math.floor(Date.now() / DAY) * DAY,
        attendance: r ? { status: r.status, minutesLate: r.minutesLate, corrected: Boolean(r.correctedAt) } : null,
      };
    }),
  });
});

const correction = z.object({ note: z.string().trim().min(10, "Say what is wrong, in a sentence.").max(300) });

/** "This is wrong": goes to the people who record attendance. It changes nothing by itself. */
myDutiesRouter.post("/:assignmentId/correction", async (req, res) => {
  const who = caller(req);
  const input = parseOr400(correction, req.body, res);
  if (!input) return;
  if (!who.staffId) return res.status(403).json({ error: "forbidden" });
  const duty = await prisma.rosterAssignment.findFirst({ where: { id: String(req.params.assignmentId), staffId: who.staffId, facilityId: who.facilityId }, include: { shift: true } });
  if (!duty) return res.status(404).json({ error: "not_found" });
  const day = Math.floor(duty.dutyDate.getTime() / DAY);
  await notifyDeciders(who.facilityId, {
    type: "attendance_correction_asked",
    title: `${who.displayName} asks for an attendance correction`,
    body: `${duty.shift.name} on ${sayDay(day)}: ${input.note}`,
    linkUrl: `/attendance?date=${duty.dutyDate.toISOString().slice(0, 10)}`,
    severity: "ACTION",
  });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "attendance_correction_asked", entityType: "RosterAssignment", entityId: duty.id,
    summary: `${who.displayName} asked for a correction to their attendance for ${duty.shift.name} on ${sayDay(day)}: ${input.note}`,
  });
  res.status(201).json({ ok: true });
});
