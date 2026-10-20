// Days people ask to have off, before a roster is generated, and stretches when
// someone must not be given nights. The in-charge decides requests; the engine
// keeps approved days free and avoids pending ones where the month allows.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { notifyDeciders, notifyStaff } from "../../lib/notify.js";
import { allowRoles, caller, READ_ROLES } from "../../middleware/facilityAccess.js";
import { sayDay } from "../../engine/time.js";

export const daysOffRouter = Router();
export const restrictionsRouter = Router();

const DAY = 86_400_000;
const dayOf = (d: Date) => Math.floor(d.getTime() / DAY);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const DECIDERS = READ_ROLES;
/** Most days a person may ask for in one calendar month, approved and waiting together. */
export const DAYS_OFF_PER_MONTH = 4;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");

function present(r: { id: string; staffId: string; date: Date; reason: string | null; status: string; decidedBy: string | null; decidedAt: Date | null; staff?: { fullName: string } }) {
  return { id: r.id, staffId: r.staffId, name: r.staff?.fullName ?? null, date: iso(r.date), reason: r.reason, status: r.status, decidedBy: r.decidedBy, decidedAt: r.decidedAt };
}

/** Yours, or for the in-charge, everyone's from a month on. */
daysOffRouter.get("/", async (req, res) => {
  const who = caller(req);
  const decider = DECIDERS.includes(who.role);
  const from = new Date((Math.floor(Date.now() / DAY) - 31) * DAY);
  const rows = await prisma.dayOffRequest.findMany({
    where: { facilityId: who.facilityId, date: { gte: from }, ...(decider ? {} : { staffId: who.staffId ?? "none" }) },
    include: { staff: { select: { fullName: true } } },
    orderBy: [{ status: "asc" }, { date: "asc" }],
  });
  const people = decider ? await prisma.staff.findMany({ where: { facilityId: who.facilityId, status: "ACTIVE" }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }) : [];
  res.json({ requests: rows.map(present), decider, perMonth: DAYS_OFF_PER_MONTH, myStaffId: who.staffId, people: people.map((p) => ({ id: p.id, name: p.fullName })) });
});

const askInput = z.object({ date: isoDate, reason: z.string().trim().max(200, "Keep the reason under 200 characters.").optional(), staffId: z.string().optional() });

daysOffRouter.post("/", async (req, res) => {
  const who = caller(req);
  const input = parseOr400(askInput, req.body, res);
  if (!input) return;
  const forOther = Boolean(input.staffId) && input.staffId !== who.staffId;
  if (forOther && !DECIDERS.includes(who.role)) return res.status(403).json({ error: "forbidden", message: "You can only ask for your own days off." });
  const staffId = input.staffId ?? who.staffId;
  if (!staffId) return res.status(400).json({ error: "no_staff_record", message: "Your account is not linked to a staff record. Ask your in-charge." });
  const person = await prisma.staff.findFirst({ where: { id: staffId, facilityId: who.facilityId, status: "ACTIVE" }, select: { id: true, fullName: true } });
  if (!person) return res.status(404).json({ error: "not_found" });
  const date = new Date(`${input.date}T00:00:00Z`);
  if (dayOf(date) <= Math.floor(Date.now() / DAY)) return res.status(400).json({ error: "invalid_input", fields: { date: "Choose a day after today." } });
  if (dayOf(date) > Math.floor(Date.now() / DAY) + 120) return res.status(400).json({ error: "invalid_input", fields: { date: "Choose a day within the next four months." } });
  const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  const already = await prisma.dayOffRequest.count({ where: { staffId, date: { gte: monthStart, lte: monthEnd }, status: { in: ["REQUESTED", "APPROVED"] } } });
  if (already >= DAYS_OFF_PER_MONTH) return res.status(409).json({ error: "limit", message: `${forOther ? `${person.fullName} has` : "You have"} already asked for ${DAYS_OFF_PER_MONTH} days in that month, the most allowed.` });
  const existing = await prisma.dayOffRequest.findUnique({ where: { staffId_date: { staffId, date } } });
  if (existing && ["REQUESTED", "APPROVED"].includes(existing.status)) return res.status(409).json({ error: "duplicate", message: "That day has already been asked for." });
  const onLeave = await prisma.leaveRequest.findFirst({ where: { staffId, status: { in: ["SUBMITTED", "APPROVED"] }, startDate: { lte: date }, endDate: { gte: date } }, select: { id: true } });
  if (onLeave) return res.status(409).json({ error: "on_leave", message: "That day is already inside leave." });
  // The in-charge asking on someone's behalf decides it at once.
  const decided = forOther ? { status: "APPROVED" as const, decidedBy: who.email, decidedAt: new Date() } : { status: "REQUESTED" as const, decidedBy: null, decidedAt: null };
  const row = existing
    ? await prisma.dayOffRequest.update({ where: { id: existing.id }, data: { reason: input.reason || null, ...decided }, include: { staff: { select: { fullName: true } } } })
    : await prisma.dayOffRequest.create({ data: { facilityId: who.facilityId, staffId, date, reason: input.reason || null, ...decided }, include: { staff: { select: { fullName: true } } } });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: forOther ? "day_off_set" : "day_off_requested", entityType: "DayOffRequest", entityId: row.id,
    summary: forOther ? `${who.displayName} set ${sayDay(dayOf(date))} as a day off for ${person.fullName}.` : `${who.displayName} asked for ${sayDay(dayOf(date))} off.`,
  });
  if (!forOther) {
    await notifyDeciders(who.facilityId, { type: "day_off_requested", title: `${person.fullName} asked for a day off`, body: `${sayDay(dayOf(date))}${input.reason ? `: ${input.reason}` : ""}. Decide before the roster is generated.`, linkUrl: "/days-off", severity: "ACTION" }, who.email);
  }
  res.status(201).json({ request: present(row) });
});

const decideInput = z.object({ decision: z.enum(["approve", "decline"]) });

daysOffRouter.post("/:id/decide", allowRoles(...DECIDERS), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(decideInput, req.body, res);
  if (!input) return;
  const row = await prisma.dayOffRequest.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId }, include: { staff: { select: { fullName: true } } } });
  if (!row) return res.status(404).json({ error: "not_found" });
  if (row.status !== "REQUESTED") return res.status(409).json({ error: "already_decided", message: "This request has already been decided." });
  const updated = await prisma.dayOffRequest.update({
    where: { id: row.id }, data: { status: input.decision === "approve" ? "APPROVED" : "DECLINED", decidedBy: who.email, decidedAt: new Date() }, include: { staff: { select: { fullName: true } } },
  });
  const word = input.decision === "approve" ? "approved" : "declined";
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: `day_off_${word}`, entityType: "DayOffRequest", entityId: row.id, summary: `${who.displayName} ${word} ${row.staff.fullName}'s request for ${sayDay(dayOf(row.date))} off.` });
  await notifyStaff(who.facilityId, row.staffId, { type: "day_off_decided", title: `Your day off was ${word}`, body: `${sayDay(dayOf(row.date))}.`, linkUrl: "/days-off", severity: "INFO" });
  res.json({ request: present(updated) });
});

daysOffRouter.post("/:id/withdraw", async (req, res) => {
  const who = caller(req);
  const row = await prisma.dayOffRequest.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!row) return res.status(404).json({ error: "not_found" });
  if (row.staffId !== who.staffId && !DECIDERS.includes(who.role)) return res.status(404).json({ error: "not_found" });
  if (!["REQUESTED", "APPROVED"].includes(row.status)) return res.status(409).json({ error: "closed", message: "This request is already closed." });
  const updated = await prisma.dayOffRequest.update({ where: { id: row.id }, data: { status: "WITHDRAWN" } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "day_off_withdrawn", entityType: "DayOffRequest", entityId: row.id, summary: `${who.displayName} withdrew the request for ${sayDay(dayOf(row.date))} off.` });
  res.json({ request: present(updated) });
});

// ---------------------------------------------------------------- no nights for a while

restrictionsRouter.get("/:staffId/restrictions", allowRoles(...DECIDERS), async (req, res) => {
  const who = caller(req);
  const rows = await prisma.staffRestriction.findMany({ where: { facilityId: who.facilityId, staffId: String(req.params.staffId) }, orderBy: { startDate: "desc" } });
  res.json({ restrictions: rows.map((r) => ({ id: r.id, kind: r.kind, startDate: iso(r.startDate), endDate: iso(r.endDate), note: r.note })) });
});

const restrictionInput = z
  .object({ startDate: isoDate, endDate: isoDate, note: z.string().trim().max(200).optional() })
  .refine((v) => v.endDate >= v.startDate, { path: ["endDate"], message: "The last day is before the first." });

restrictionsRouter.post("/:staffId/restrictions", allowRoles(...DECIDERS), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(restrictionInput, req.body, res);
  if (!input) return;
  const person = await prisma.staff.findFirst({ where: { id: String(req.params.staffId), facilityId: who.facilityId }, select: { id: true, fullName: true } });
  if (!person) return res.status(404).json({ error: "not_found" });
  const start = new Date(`${input.startDate}T00:00:00Z`);
  const end = new Date(`${input.endDate}T00:00:00Z`);
  if (dayOf(end) - dayOf(start) > 400) return res.status(400).json({ error: "invalid_input", fields: { endDate: "Set at most about a year; add another after it if needed." } });
  const row = await prisma.staffRestriction.create({ data: { facilityId: who.facilityId, staffId: person.id, kind: "NO_NIGHTS", startDate: start, endDate: end, note: input.note || null, createdBy: who.email } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "no_nights_set", entityType: "StaffRestriction", entityId: row.id, summary: `${who.displayName} set no night duty for ${person.fullName} from ${sayDay(dayOf(start))} to ${sayDay(dayOf(end))}.` });
  res.status(201).json({ restriction: { id: row.id, kind: row.kind, startDate: iso(row.startDate), endDate: iso(row.endDate), note: row.note } });
});

restrictionsRouter.delete("/:staffId/restrictions/:id", allowRoles(...DECIDERS), async (req, res) => {
  const who = caller(req);
  const row = await prisma.staffRestriction.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId, staffId: String(req.params.staffId) }, include: { staff: { select: { fullName: true } } } });
  if (!row) return res.status(404).json({ error: "not_found" });
  await prisma.staffRestriction.delete({ where: { id: row.id } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "no_nights_removed", entityType: "StaffRestriction", entityId: row.id, summary: `${who.displayName} removed the no-nights period for ${row.staff.fullName} (${sayDay(dayOf(row.startDate))} to ${sayDay(dayOf(row.endDate))}).` });
  res.json({ ok: true });
});
