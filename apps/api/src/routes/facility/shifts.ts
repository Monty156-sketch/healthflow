// Shift configuration (Part 3, 1.2). Shifts are never deleted: deactivated,
// so every past roster that used them still reads correctly.
import { Router } from "express";
import { z } from "zod";
import { SHIFT_COLOURS } from "@healthflow/shared";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400, requiredText } from "../../lib/validate.js";
import { allowRoles, caller, ADMIN_ROLES, READ_ROLES } from "../../middleware/facilityAccess.js";

export const shiftsRouter = Router();

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/** Hours between two clock times. Overnight shifts end the next morning. */
export function shiftHours(start: string, end: string, overnight: boolean): number {
  const diff = minutes(end) - minutes(start);
  return (overnight ? diff + 24 * 60 : diff) / 60;
}

const colours = SHIFT_COLOURS.map((c) => c.value) as [string, ...string[]];

const shiftInput = z.object({
  name: requiredText(60, "Name"),
  code: requiredText(5, "Code").transform((c) => c.toUpperCase()),
  startTime: z.string().regex(HHMM, "Enter a time such as 08:00.").nullish(),
  endTime: z.string().regex(HHMM, "Enter a time such as 20:00.").nullish(),
  isOvernight: z.boolean().default(false),
  isOnCall: z.boolean().default(false),
  onCallHoursFactor: z.number().min(0, "Use a number from 0 to 1.").max(1, "Use a number from 0 to 1.").default(0),
  onCallAdviceNote: z.string().trim().max(300).nullish(),
  minStaff: z.number({ invalid_type_error: "Enter a whole number." }).int("Enter a whole number.").min(0, "Cannot be negative.").max(60, "At most 60."),
  minByCadre: z.record(z.string(), z.number().int("Whole numbers only.").min(1, "At least 1.").max(60)).default({}),
  /** Blank means the same as weekdays. */
  weekendMinStaff: z.number({ invalid_type_error: "Enter a whole number." }).int("Enter a whole number.").min(0, "Cannot be negative.").max(60, "At most 60.").nullish(),
  /** Blank means the weekend number, or the weekday number when there is none. */
  holidayMinStaff: z.number({ invalid_type_error: "Enter a whole number." }).int("Enter a whole number.").min(0, "Cannot be negative.").max(60, "At most 60.").nullish(),
  /** When there are not enough people: 1 keep this shift full first, 0 normal, -1 may run short first. */
  keepFull: z.number().int().min(-1).max(1).default(0),
  eligibleCadreIds: z.array(z.string()).default([]),
  colour: z.enum(colours, { errorMap: () => ({ message: "Choose one of the colours." }) }),
});

async function lookups(facilityId: string) {
  const cadres = await prisma.cadre.findMany({ where: { facilityId }, select: { id: true, name: true } });
  return { cadres, cadreIds: new Set(cadres.map((c) => c.id)) };
}

type ShiftRow = Awaited<ReturnType<typeof prisma.shift.findFirstOrThrow>>;

function present(s: ShiftRow) {
  return {
    id: s.id,
    name: s.name,
    code: s.code,
    startTime: s.startTime,
    endTime: s.endTime,
    durationHours: s.durationHours,
    isOvernight: s.isOvernight,
    isOnCall: s.isOnCall,
    onCallHoursFactor: s.onCallHoursFactor,
    onCallAdviceNote: s.onCallAdviceNote,
    minStaff: s.minStaff,
    minByCadre: s.minByCadre as Record<string, number>,
    weekendMinStaff: s.weekendMinStaff,
    holidayMinStaff: s.holidayMinStaff,
    keepFull: s.keepFull,
    eligibleCadreIds: s.eligibleCadreIds,
    colour: s.colour,
    countsAsDuty: s.countsAsDuty,
    active: s.active,
    sortOrder: s.sortOrder,
  };
}

/** Every facility has exactly one Off Duty shift; the roster fills blanks with it. */
export async function ensureOffDuty(facilityId: string) {
  const exists = await prisma.shift.findFirst({ where: { facilityId, countsAsDuty: false }, select: { id: true } });
  if (exists) return;
  await prisma.shift.create({
    data: { facilityId, name: "Off Duty", code: "D/O", countsAsDuty: false, durationHours: 0, colour: "#77878a", sortOrder: 99, minStaff: 0 },
  });
}

shiftsRouter.get("/", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  await ensureOffDuty(facilityId);
  const [shifts, { cadres }] = await Promise.all([
    prisma.shift.findMany({ where: { facilityId }, orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { code: "asc" }] }),
    lookups(facilityId),
  ]);
  res.json({ shifts: shifts.map(present), cadres });
});

function words(s: { name: string; code: string }) {
  return `${s.name} (${s.code})`;
}

/** Turns the form into row data, or answers 400/409 and returns null. */
async function build(facilityId: string, body: unknown, res: import("express").Response, existing?: ShiftRow) {
  const input = parseOr400(shiftInput, body, res);
  if (!input) return null;
  const fields: Record<string, string> = {};
  const isOff = existing ? !existing.countsAsDuty : false;

  const { cadreIds } = await lookups(facilityId);
  for (const id of [...input.eligibleCadreIds, ...Object.keys(input.minByCadre)]) {
    if (!cadreIds.has(id)) fields.eligibleCadreIds = "One of the cadres is not in your facility.";
  }
  for (const [, n] of Object.entries(input.minByCadre)) {
    if (n > input.minStaff) fields.minByCadre = "A cadre's minimum cannot be more than the shift's total minimum.";
  }
  if (input.eligibleCadreIds.length) {
    for (const id of Object.keys(input.minByCadre)) {
      if (!input.eligibleCadreIds.includes(id)) fields.minByCadre = "A cadre with a minimum must also be allowed on the shift.";
    }
  }

  const clash = await prisma.shift.findFirst({
    where: { facilityId, code: { equals: input.code, mode: "insensitive" }, ...(existing ? { id: { not: existing.id } } : {}) },
    select: { id: true },
  });
  if (clash) fields.code = "Another shift already uses this code.";

  let durationHours = 0;
  if (!isOff) {
    if (!input.startTime) fields.startTime = "Enter the start time.";
    if (!input.endTime) fields.endTime = "Enter the end time.";
    if (input.startTime && input.endTime) {
      const asEntered = minutes(input.endTime) - minutes(input.startTime);
      if (input.isOvernight && asEntered >= 0) {
        fields.endTime = "An overnight shift ends the next morning, so its end time must be earlier than its start time. Untick overnight if this shift ends the same day.";
      } else if (!input.isOvernight && asEntered <= 0) {
        fields.endTime = "The end time is not after the start time. If this shift runs past midnight, tick overnight.";
      } else {
        durationHours = shiftHours(input.startTime, input.endTime, input.isOvernight);
        if (durationHours > 24) fields.endTime = "A shift cannot be longer than 24 hours.";
      }
    }
    if (input.isOnCall === false && input.onCallHoursFactor !== 0) {
      fields.onCallHoursFactor = "The on-call factor only applies to on-call shifts.";
    }
    if (input.isOnCall && input.onCallHoursFactor !== 0 && !input.onCallAdviceNote) {
      fields.onCallAdviceNote = "Record the advice this factor is based on.";
    }
  }
  if (Object.keys(fields).length) {
    res.status(400).json({ error: "invalid_input", fields });
    return null;
  }
  return {
    input,
    data: isOff
      ? { name: input.name, colour: input.colour }
      : {
          name: input.name,
          code: input.code,
          startTime: input.startTime ?? null,
          endTime: input.endTime ?? null,
          durationHours,
          isOvernight: input.isOvernight,
          isOnCall: input.isOnCall,
          onCallHoursFactor: input.isOnCall ? input.onCallHoursFactor : 0,
          onCallAdviceNote: input.isOnCall && input.onCallHoursFactor !== 0 ? (input.onCallAdviceNote?.trim() || null) : null,
          minStaff: input.minStaff,
          minByCadre: input.minByCadre,
          weekendMinStaff: input.weekendMinStaff ?? null,
          holidayMinStaff: input.holidayMinStaff ?? null,
          keepFull: input.keepFull,
          eligibleCadreIds: input.eligibleCadreIds,
          colour: input.colour,
        },
  };
}

shiftsRouter.post("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const built = await build(who.facilityId, req.body, res);
  if (!built) return;
  const last = await prisma.shift.aggregate({ where: { facilityId: who.facilityId, countsAsDuty: true }, _max: { sortOrder: true } });
  const shift = await prisma.shift.create({
    data: {
      facilityId: who.facilityId,
      sortOrder: (last._max.sortOrder ?? 0) + 1,
      ...(built.data as object),
    } as Parameters<typeof prisma.shift.create>[0]["data"],
  });
  await writeAuditLog({
    facilityId: who.facilityId,
    actorEmail: who.email,
    action: "shift_created",
    entityType: "Shift",
    entityId: shift.id,
    after: present(shift),
    summary: `${who.displayName} added the ${words(shift)} shift, ${shift.startTime} to ${shift.endTime}, ${shift.durationHours} hours${shift.isOvernight ? ", overnight" : ""}.`,
  });
  res.status(201).json({ shift: present(shift) });
});

/** Morning, Afternoon and Night as an editable starting point. */
shiftsRouter.post("/starter", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const have = await prisma.shift.count({ where: { facilityId: who.facilityId, countsAsDuty: true } });
  if (have > 0) return res.status(409).json({ error: "already_has_shifts", message: "This facility already has shifts." });
  const starters = [
    { name: "Morning", code: "A", startTime: "08:00", endTime: "14:00", durationHours: 6, isOvernight: false, minStaff: 4, colour: "#b56b12", sortOrder: 1 },
    { name: "Afternoon", code: "M", startTime: "14:00", endTime: "20:00", durationHours: 6, isOvernight: false, minStaff: 3, colour: "#25619f", sortOrder: 2 },
    { name: "Night", code: "N", startTime: "20:00", endTime: "08:00", durationHours: 12, isOvernight: true, minStaff: 3, colour: "#463a85", sortOrder: 3 },
  ];
  await prisma.shift.createMany({ data: starters.map((s) => ({ ...s, facilityId: who.facilityId })) });
  await writeAuditLog({
    facilityId: who.facilityId,
    actorEmail: who.email,
    action: "shifts_started",
    entityType: "Shift",
    summary: `${who.displayName} added the Morning (A), Afternoon (M) and Night (N) shifts as a starting point.`,
  });
  res.status(201).json({ ok: true });
});

shiftsRouter.patch("/:id", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const existing = await prisma.shift.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!existing) return res.status(404).json({ error: "not_found" });
  const built = await build(who.facilityId, req.body, res, existing);
  if (!built) return;
  const shift = await prisma.shift.update({ where: { id: existing.id }, data: built.data });

  const before = present(existing);
  const after = present(shift);
  const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (changed.length) {
    const LABEL: Record<string, string> = {
      name: "name", code: "code", startTime: "start time", endTime: "end time", durationHours: "duration", isOvernight: "overnight setting",
      isOnCall: "on-call setting", onCallHoursFactor: "on-call factor", minStaff: "minimum staff", minByCadre: "minimum by cadre", weekendMinStaff: "weekend minimum", holidayMinStaff: "public holiday minimum", keepFull: "which shift runs short first",
      eligibleCadreIds: "eligible cadres", colour: "colour", onCallAdviceNote: "on-call advice note",
    };
    const parts = changed.filter((k) => LABEL[k]).map((k) => LABEL[k]);
    await writeAuditLog({
      facilityId: who.facilityId,
      actorEmail: who.email,
      action: "shift_updated",
      entityType: "Shift",
      entityId: shift.id,
      before,
      after,
      summary: `${who.displayName} changed the ${words(existing)} shift: ${parts.join(", ")}${
        shift.onCallHoursFactor !== existing.onCallHoursFactor && built.input.onCallAdviceNote ? `. On-call advice recorded: ${built.input.onCallAdviceNote}` : ""
      }.`,
    });
  }
  res.json({ shift: after });
});

shiftsRouter.patch("/:id/active", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(z.object({ active: z.boolean() }), req.body, res);
  if (!input) return;
  const existing = await prisma.shift.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!existing) return res.status(404).json({ error: "not_found" });
  if (!existing.countsAsDuty) {
    return res.status(409).json({ error: "off_duty_required", message: "Off Duty is used to fill every blank on the roster, so it cannot be turned off." });
  }
  const shift = await prisma.shift.update({
    where: { id: existing.id },
    data: { active: input.active, archivedAt: input.active ? null : new Date() },
  });
  await writeAuditLog({
    facilityId: who.facilityId,
    actorEmail: who.email,
    action: input.active ? "shift_reactivated" : "shift_deactivated",
    entityType: "Shift",
    entityId: shift.id,
    summary: `${who.displayName} ${input.active ? "turned on" : "turned off"} the ${words(shift)} shift.`,
  });
  res.json({ shift: present(shift) });
});
