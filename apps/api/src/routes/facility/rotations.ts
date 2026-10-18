// Shift rotation order (spec Part 4, 2A.1): the order shifts follow one
// another, for example Night, Afternoon, Morning. The roster engine prefers
// to bring people back in that order after a rest; it is a weak preference
// beside fairness unless the facility sets it to Block.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400, requiredText } from "../../lib/validate.js";
import { allowRoles, caller, ADMIN_ROLES, READ_ROLES } from "../../middleware/facilityAccess.js";

export const rotationsRouter = Router();

type Row = Awaited<ReturnType<typeof load>>[number];

function load(facilityId: string) {
  return prisma.shiftRotation.findMany({ where: { facilityId }, orderBy: [{ name: "asc" }, { id: "asc" }] });
}

const present = (r: Row) => ({
  id: r.id,
  name: r.name,
  sequenceShiftIds: r.sequenceOrder,
  applicableCadreIds: r.applicableCadreIds,
  applicableDepartmentIds: r.applicableDepartmentIds,
  enforcement: r.enforcement,
  active: r.active,
});

/** A facility with night, afternoon and morning shifts starts with that order, once. */
async function ensureSeeded(facilityId: string) {
  if ((await prisma.shiftRotation.count({ where: { facilityId } })) > 0) return;
  if (await prisma.auditLog.findFirst({ where: { facilityId, action: "rotation_deleted" }, select: { id: true } })) return;
  const shifts = await prisma.shift.findMany({ where: { facilityId, countsAsDuty: true, active: true, isOnCall: false } });
  const night = shifts.find((s) => s.isOvernight);
  const day = shifts.filter((s) => !s.isOvernight);
  const named = (w: string) => day.find((x) => x.name.toLowerCase().includes(w));
  const order = [night, named("afternoon"), named("morning")].filter((s): s is NonNullable<typeof s> => Boolean(s));
  if (order.length < 3) return;
  await prisma.shiftRotation.create({
    data: { facilityId, name: "Standard rotation", sequenceOrder: order.map((s) => s.id), sequence: { connect: order.map((s) => ({ id: s.id })) }, enforcement: "PREFER" },
  });
}

rotationsRouter.get("/", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  await ensureSeeded(facilityId);
  const [rotations, shifts, cadres, departments] = await Promise.all([
    load(facilityId),
    prisma.shift.findMany({ where: { facilityId, countsAsDuty: true, active: true, isOnCall: false }, orderBy: { sortOrder: "asc" }, select: { id: true, code: true, name: true, colour: true } }),
    prisma.cadre.findMany({ where: { facilityId, active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.department.findMany({ where: { facilityId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  res.json({ rotations: rotations.map(present), shifts, cadres, departments });
});

const input = z.object({
  name: requiredText(80, "Name"),
  sequenceShiftIds: z.array(z.string()).min(2, "Choose at least two shifts, in the order they follow one another.").max(8, "At most 8 shifts."),
  applicableCadreIds: z.array(z.string()).default([]),
  applicableDepartmentIds: z.array(z.string()).default([]),
  enforcement: z.enum(["BLOCK", "PREFER"]),
  confirmBlock: z.boolean().optional(),
});

async function validate(facilityId: string, body: unknown, res: import("express").Response, existing?: Row) {
  const parsed = parseOr400(input, body, res);
  if (!parsed) return null;
  const fields: Record<string, string> = {};
  const ids = parsed.sequenceShiftIds;
  if (new Set(ids).size !== ids.length) fields.sequenceShiftIds = "Each shift can appear once.";
  else if ((await prisma.shift.count({ where: { facilityId, id: { in: ids }, countsAsDuty: true, active: true } })) !== ids.length) fields.sequenceShiftIds = "One of the shifts is not a duty shift in your facility.";
  if (parsed.applicableCadreIds.length && (await prisma.cadre.count({ where: { facilityId, id: { in: parsed.applicableCadreIds } } })) !== new Set(parsed.applicableCadreIds).size) fields.applicableCadreIds = "One of the cadres is not in your facility.";
  if (parsed.applicableDepartmentIds.length && (await prisma.department.count({ where: { facilityId, id: { in: parsed.applicableDepartmentIds } } })) !== new Set(parsed.applicableDepartmentIds).size) fields.applicableDepartmentIds = "One of the departments is not in your facility.";
  if (parsed.enforcement === "BLOCK" && existing?.enforcement !== "BLOCK" && !parsed.confirmBlock) {
    res.status(409).json({
      error: "block_confirm_needed",
      message: "Block means nobody comes back from a rest on a shift out of this order, even if that leaves a shift uncovered. Confirm that you would rather have an uncovered shift than a break in the order.",
    });
    return null;
  }
  if (Object.keys(fields).length) {
    res.status(400).json({ error: "invalid_input", fields });
    return null;
  }
  return parsed;
}

async function codes(facilityId: string, ids: string[]) {
  const rows = await prisma.shift.findMany({ where: { facilityId, id: { in: ids } }, select: { id: true, code: true } });
  return ids.map((id) => rows.find((r) => r.id === id)?.code ?? "?").join(", then ");
}

rotationsRouter.post("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const v = await validate(who.facilityId, req.body, res);
  if (!v) return;
  const r = await prisma.shiftRotation.create({
    data: {
      facilityId: who.facilityId, name: v.name, sequenceOrder: v.sequenceShiftIds, sequence: { connect: v.sequenceShiftIds.map((id) => ({ id })) },
      applicableCadreIds: v.applicableCadreIds, applicableDepartmentIds: v.applicableDepartmentIds, enforcement: v.enforcement,
    },
  });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "rotation_created", entityType: "ShiftRotation", entityId: r.id, after: present(r),
    summary: `${who.displayName} added the shift rotation "${r.name}": ${await codes(who.facilityId, r.sequenceOrder)}, ${r.enforcement === "BLOCK" ? "enforced" : "preferred"}.`,
  });
  res.status(201).json({ rotation: present(r) });
});

rotationsRouter.patch("/:id", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const existing = (await load(who.facilityId)).find((r) => r.id === String(req.params.id));
  if (!existing) return res.status(404).json({ error: "not_found" });
  const v = await validate(who.facilityId, req.body, res, existing);
  if (!v) return;
  const r = await prisma.shiftRotation.update({
    where: { id: existing.id },
    data: {
      name: v.name, sequenceOrder: v.sequenceShiftIds, sequence: { set: v.sequenceShiftIds.map((id) => ({ id })) },
      applicableCadreIds: v.applicableCadreIds, applicableDepartmentIds: v.applicableDepartmentIds, enforcement: v.enforcement,
    },
  });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "rotation_updated", entityType: "ShiftRotation", entityId: r.id, before: present(existing), after: present(r),
    summary: `${who.displayName} changed the shift rotation "${r.name}" to ${await codes(who.facilityId, r.sequenceOrder)}, ${r.enforcement === "BLOCK" ? "enforced" : "preferred"}.`,
  });
  res.json({ rotation: present(r) });
});

rotationsRouter.patch("/:id/active", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const body = parseOr400(z.object({ active: z.boolean() }), req.body, res);
  if (!body) return;
  const existing = (await load(who.facilityId)).find((r) => r.id === String(req.params.id));
  if (!existing) return res.status(404).json({ error: "not_found" });
  const r = await prisma.shiftRotation.update({ where: { id: existing.id }, data: { active: body.active } });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: body.active ? "rotation_reactivated" : "rotation_deactivated", entityType: "ShiftRotation", entityId: r.id,
    summary: `${who.displayName} ${body.active ? "turned on" : "turned off"} the shift rotation "${r.name}".`,
  });
  res.json({ rotation: present(r) });
});

rotationsRouter.delete("/:id", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const existing = (await load(who.facilityId)).find((r) => r.id === String(req.params.id));
  if (!existing) return res.status(404).json({ error: "not_found" });
  await prisma.shiftRotation.delete({ where: { id: existing.id } });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "rotation_deleted", entityType: "ShiftRotation", entityId: existing.id,
    summary: `${who.displayName} deleted the shift rotation "${existing.name}".`,
  });
  res.json({ ok: true });
});
