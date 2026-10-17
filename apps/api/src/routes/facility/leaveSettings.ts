// Leave settings (Part 3, 3.4 to 3.6): leave types, yearly entitlements and
// public holidays. Entitlements start unset on purpose: the figure comes from
// conditions of service and varies by grade, so the system never invents one.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { ensureHolidays } from "../../lib/holidays.js";
import { allowRoles, caller, ADMIN_ROLES, READ_ROLES } from "../../middleware/facilityAccess.js";
import { ensureLeaveTypes } from "./leave.js";
import { sayDay } from "../../engine/time.js";

export const leaveSettingsRouter = Router();
const DAY = 86_400_000;

// ------------------------------------------------------------- leave types

const typeInput = z.object({
  name: z.string().trim().min(2, "Give it a name.").max(60),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}$/, "Use 1 to 6 letters or numbers, for example L or MAT."),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a colour.").nullish().transform((v) => v ?? null),
  isPaid: z.boolean(),
  affectsAvailability: z.boolean(),
  countsAgainstEntitlement: z.boolean(),
  deductionBasis: z.enum(["CALENDAR_DAYS", "SCHEDULED_DUTY_DAYS", "WORKING_DAYS_MON_FRI"]),
  maxConsecutiveDays: z.number().int().min(1, "At least 1 day.").max(730).nullish().transform((v) => v ?? null),
  createsDutyDebt: z.boolean(),
  isShortAbsence: z.boolean(),
  maxDaysForAutoCover: z.number().int().min(0).max(30).default(3),
  returnDateSetBy: z.enum(["IN_CHARGE", "STAFF_CONFIRMS"]),
  active: z.boolean().default(true),
});

const presentType = (t: Awaited<ReturnType<typeof prisma.leaveType.findFirstOrThrow>>) => ({
  id: t.id, name: t.name, code: t.code, colour: t.colour, isPaid: t.isPaid, affectsAvailability: t.affectsAvailability,
  countsAgainstEntitlement: t.countsAgainstEntitlement, deductionBasis: t.deductionBasis, maxConsecutiveDays: t.maxConsecutiveDays,
  createsDutyDebt: t.createsDutyDebt, isShortAbsence: t.isShortAbsence, maxDaysForAutoCover: t.maxDaysForAutoCover, returnDateSetBy: t.returnDateSetBy,
  active: t.active, sortOrder: t.sortOrder,
});

leaveSettingsRouter.get("/leave-types", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  await ensureLeaveTypes(facilityId);
  const types = await prisma.leaveType.findMany({ where: { facilityId }, orderBy: [{ active: "desc" }, { sortOrder: "asc" }] });
  res.json({ types: types.map(presentType) });
});

const LABEL: Record<string, string> = {
  name: "name", code: "code", colour: "colour", isPaid: "paid", affectsAvailability: "blocks availability", countsAgainstEntitlement: "counts against entitlement",
  deductionBasis: "how days are counted", maxConsecutiveDays: "longest run", createsDutyDebt: "worked back", isShortAbsence: "short absence", maxDaysForAutoCover: "days covered automatically",
  returnDateSetBy: "who sets the return date", active: "in use",
};
const BASIS: Record<string, string> = { CALENDAR_DAYS: "calendar days", SCHEDULED_DUTY_DAYS: "scheduled duty days", WORKING_DAYS_MON_FRI: "working days, Monday to Friday" };

function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  return Object.keys(LABEL).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map((k) => {
    const say = (v: unknown) => (typeof v === "boolean" ? (v ? "yes" : "no") : k === "deductionBasis" ? BASIS[String(v)] : v === null ? "none" : String(v));
    return `${LABEL[k]} from ${say(before[k])} to ${say(after[k])}`;
  });
}

leaveSettingsRouter.post("/leave-types", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(typeInput, req.body, res);
  if (!input) return;
  await ensureLeaveTypes(who.facilityId);
  if (await prisma.leaveType.findFirst({ where: { facilityId: who.facilityId, code: input.code } })) return res.status(400).json({ error: "invalid_input", fields: { code: "Another leave type already uses this code." } });
  const max = await prisma.leaveType.aggregate({ where: { facilityId: who.facilityId }, _max: { sortOrder: true } });
  const t = await prisma.leaveType.create({ data: { ...input, facilityId: who.facilityId, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "leave_type_created", entityType: "LeaveType", entityId: t.id, summary: `${who.displayName} added the leave type ${t.name} (${t.code}).` });
  res.status(201).json({ type: presentType(t) });
});

leaveSettingsRouter.patch("/leave-types/:id", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(typeInput, req.body, res);
  if (!input) return;
  const t = await prisma.leaveType.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!t) return res.status(404).json({ error: "not_found" });
  if (input.code !== t.code && (await prisma.leaveType.findFirst({ where: { facilityId: who.facilityId, code: input.code } }))) {
    return res.status(400).json({ error: "invalid_input", fields: { code: "Another leave type already uses this code." } });
  }
  const updated = await prisma.leaveType.update({ where: { id: t.id }, data: input });
  const changes = diff(presentType(t), presentType(updated));
  if (changes.length) {
    await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "leave_type_updated", entityType: "LeaveType", entityId: t.id, before: presentType(t), after: presentType(updated), summary: `${who.displayName} changed ${t.name} leave: ${changes.join("; ")}.` });
  }
  res.json({ type: presentType(updated) });
});

// ------------------------------------------------------------- entitlements

const yearOf = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : new Date().getUTCFullYear();
};

leaveSettingsRouter.get("/entitlements", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  await ensureLeaveTypes(facilityId);
  const year = yearOf(req.query.year);
  const types = await prisma.leaveType.findMany({ where: { facilityId, active: true, countsAgainstEntitlement: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, code: true } });
  const typeId = typeof req.query.leaveTypeId === "string" && types.some((t) => t.id === req.query.leaveTypeId) ? req.query.leaveTypeId : types[0]?.id;
  if (!typeId) return res.json({ year, types, leaveTypeId: null, rows: [] });
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  const [staff, ents, taken] = await Promise.all([
    prisma.staff.findMany({ where: { facilityId, status: { in: ["ACTIVE", "ON_LEAVE"] } }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, staffNo: true, cadre: { select: { name: true } } } }),
    prisma.leaveEntitlement.findMany({ where: { facilityId, leaveTypeId: typeId, leaveYear: year } }),
    prisma.leaveRequest.groupBy({ by: ["staffId", "status"], where: { facilityId, leaveTypeId: typeId, status: { in: ["APPROVED", "SUBMITTED"] }, startDate: { gte: from, lt: to } }, _sum: { daysDeducted: true } }),
  ]);
  const entBy = new Map(ents.map((e) => [e.staffId, e]));
  const sum = (staffId: string, status: string) => taken.find((t) => t.staffId === staffId && t.status === status)?._sum.daysDeducted ?? 0;
  res.json({
    year, types, leaveTypeId: typeId,
    rows: staff.map((s) => {
      const e = entBy.get(s.id);
      const takenDays = sum(s.id, "APPROVED");
      return {
        staffId: s.id, name: s.fullName, staffNo: s.staffNo, cadre: s.cadre?.name ?? null,
        configured: Boolean(e), daysEntitled: e?.daysEntitled ?? null, daysCarriedOver: e?.daysCarriedOver ?? 0,
        taken: takenDays, pending: sum(s.id, "SUBMITTED"), remaining: e ? e.daysEntitled + e.daysCarriedOver - takenDays : null,
      };
    }),
  });
});

const entInput = z.object({
  year: z.number().int().min(2000).max(2100),
  leaveTypeId: z.string(),
  entries: z.array(z.object({
    staffId: z.string(),
    daysEntitled: z.number().min(0, "Cannot be negative.").max(366, "More than a year of days."),
    daysCarriedOver: z.number().min(0, "Cannot be negative.").max(366).default(0),
  })).min(1).max(1000),
});

leaveSettingsRouter.put("/entitlements", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(entInput, req.body, res);
  if (!input) return;
  const type = await prisma.leaveType.findFirst({ where: { id: input.leaveTypeId, facilityId: who.facilityId } });
  if (!type) return res.status(404).json({ error: "not_found" });
  const staff = await prisma.staff.findMany({ where: { facilityId: who.facilityId, id: { in: input.entries.map((e) => e.staffId) } }, select: { id: true } });
  const ok = new Set(staff.map((s) => s.id));
  const rows = input.entries.filter((e) => ok.has(e.staffId));
  await prisma.$transaction(rows.map((e) => prisma.leaveEntitlement.upsert({
    where: { staffId_leaveTypeId_leaveYear: { staffId: e.staffId, leaveTypeId: type.id, leaveYear: input.year } },
    create: { facilityId: who.facilityId, staffId: e.staffId, leaveTypeId: type.id, leaveYear: input.year, daysEntitled: e.daysEntitled, daysCarriedOver: e.daysCarriedOver },
    update: { daysEntitled: e.daysEntitled, daysCarriedOver: e.daysCarriedOver },
  })));
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "entitlements_set", entityType: "LeaveEntitlement",
    summary: `${who.displayName} set ${type.name} leave entitlements for ${rows.length} ${rows.length === 1 ? "person" : "people"} for ${input.year}.`,
  });
  res.json({ saved: rows.length });
});

const setAllInput = z.object({
  year: z.number().int().min(2000).max(2100),
  leaveTypeId: z.string(),
  daysEntitled: z.number().min(0).max(366),
  onlyUnset: z.boolean().default(true),
});

leaveSettingsRouter.post("/entitlements/set-all", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(setAllInput, req.body, res);
  if (!input) return;
  const type = await prisma.leaveType.findFirst({ where: { id: input.leaveTypeId, facilityId: who.facilityId } });
  if (!type) return res.status(404).json({ error: "not_found" });
  const staff = await prisma.staff.findMany({ where: { facilityId: who.facilityId, status: { in: ["ACTIVE", "ON_LEAVE"] } }, select: { id: true } });
  const have = new Set((await prisma.leaveEntitlement.findMany({ where: { facilityId: who.facilityId, leaveTypeId: type.id, leaveYear: input.year }, select: { staffId: true } })).map((e) => e.staffId));
  const targets = staff.filter((s) => !input.onlyUnset || !have.has(s.id));
  await prisma.$transaction(targets.map((s) => prisma.leaveEntitlement.upsert({
    where: { staffId_leaveTypeId_leaveYear: { staffId: s.id, leaveTypeId: type.id, leaveYear: input.year } },
    create: { facilityId: who.facilityId, staffId: s.id, leaveTypeId: type.id, leaveYear: input.year, daysEntitled: input.daysEntitled },
    update: { daysEntitled: input.daysEntitled },
  })));
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "entitlements_set_all", entityType: "LeaveEntitlement",
    summary: `${who.displayName} set ${type.name} leave to ${input.daysEntitled} days for ${targets.length} ${targets.length === 1 ? "person" : "people"} for ${input.year}${input.onlyUnset ? ", leaving anyone already set unchanged" : ""}.`,
  });
  res.json({ saved: targets.length });
});

// ------------------------------------------------------------- public holidays

const holidayInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  name: z.string().trim().min(2, "Give it a name.").max(80),
});

const presentHoliday = (h: { id: string; date: Date; name: string }) => ({ id: h.id, date: h.date.toISOString().slice(0, 10), name: h.name });

leaveSettingsRouter.get("/holidays", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  await ensureHolidays(facilityId);
  const year = yearOf(req.query.year);
  const rows = await prisma.publicHoliday.findMany({ where: { OR: [{ facilityId }, { facilityId: null }], year }, orderBy: { date: "asc" } });
  res.json({ year, holidays: rows.map(presentHoliday) });
});

leaveSettingsRouter.post("/holidays", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(holidayInput, req.body, res);
  if (!input) return;
  const date = new Date(`${input.date}T00:00:00Z`);
  if (await prisma.publicHoliday.findFirst({ where: { facilityId: who.facilityId, date } })) return res.status(400).json({ error: "invalid_input", fields: { date: "That date is already a holiday." } });
  const h = await prisma.publicHoliday.create({ data: { facilityId: who.facilityId, date, name: input.name, year: date.getUTCFullYear() } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "holiday_added", entityType: "PublicHoliday", entityId: h.id, summary: `${who.displayName} added ${h.name} on ${sayDay(Math.floor(date.getTime() / DAY))} as a public holiday.` });
  res.status(201).json({ holiday: presentHoliday(h) });
});

leaveSettingsRouter.patch("/holidays/:id", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(holidayInput, req.body, res);
  if (!input) return;
  const h = await prisma.publicHoliday.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!h) return res.status(404).json({ error: "not_found" });
  const date = new Date(`${input.date}T00:00:00Z`);
  if (await prisma.publicHoliday.findFirst({ where: { facilityId: who.facilityId, date, id: { not: h.id } } })) return res.status(400).json({ error: "invalid_input", fields: { date: "That date is already a holiday." } });
  const u = await prisma.publicHoliday.update({ where: { id: h.id }, data: { date, name: input.name, year: date.getUTCFullYear() } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "holiday_changed", entityType: "PublicHoliday", entityId: h.id, summary: `${who.displayName} changed the holiday ${h.name} (${sayDay(Math.floor(h.date.getTime() / DAY))}) to ${u.name} on ${sayDay(Math.floor(date.getTime() / DAY))}.` });
  res.json({ holiday: presentHoliday(u) });
});

leaveSettingsRouter.delete("/holidays/:id", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const h = await prisma.publicHoliday.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!h) return res.status(404).json({ error: "not_found" });
  await prisma.publicHoliday.delete({ where: { id: h.id } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "holiday_removed", entityType: "PublicHoliday", entityId: h.id, summary: `${who.displayName} removed ${h.name} (${sayDay(Math.floor(h.date.getTime() / DAY))}) from the public holidays.` });
  res.json({ ok: true });
});
