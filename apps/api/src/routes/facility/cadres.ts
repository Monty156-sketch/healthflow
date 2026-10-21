// Cadres (Nurse, Midwife, CHN, ...). Never deleted: deactivated instead.
// sortOrder sets the order cadres appear in on the roster grid.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400, requiredText, optionalText } from "../../lib/validate.js";
import { cadreDefaults } from "../../lib/dutyPlan.js";
import { allowRoles, caller, ADMIN_ROLES, READ_ROLES } from "../../middleware/facilityAccess.js";

export const cadresRouter = Router();

const CURRENT_STAFF = ["ACTIVE", "ON_LEAVE", "PENDING"] as const;

const cadreInput = z.object({
  name: requiredText(80, "Name"),
  code: optionalText(12, "Code"),
  sortOrder: z.number({ invalid_type_error: "Order must be a number." }).int().min(0).max(999).optional(),
  takesNights: z.boolean().optional(),
  onRoster: z.boolean().optional(),
  /** Office hours: weekday day shift only, outside the duty cycles. */
  weekdaysOnly: z.boolean().optional(),
});

async function nameTaken(facilityId: string, name: string, exceptId?: string) {
  const clash = await prisma.cadre.findFirst({
    where: {
      facilityId,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(clash);
}

cadresRouter.get("/", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  const cadres = await prisma.cadre.findMany({
    where: { facilityId },
    orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { staff: { where: { status: { in: [...CURRENT_STAFF] } } } } },
    },
  });
  res.json({
    cadres: cadres.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      sortOrder: c.sortOrder,
      takesNights: c.takesNights,
      onRoster: c.onRoster,
      weekdaysOnly: c.weekdaysOnly,
      active: c.active,
      staffCount: c._count.staff,
    })),
  });
});

cadresRouter.post("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(cadreInput, req.body, res);
  if (!input) return;
  if (await nameTaken(who.facilityId, input.name)) {
    return res.status(409).json({ error: "name_taken", fields: { name: "A cadre with this name already exists." } });
  }
  const last = await prisma.cadre.aggregate({ where: { facilityId: who.facilityId }, _max: { sortOrder: true } });
  const cadre = await prisma.cadre.create({
    data: {
      facilityId: who.facilityId,
      name: input.name,
      code: input.code,
      sortOrder: input.sortOrder ?? (last._max.sortOrder ?? 0) + 1,
      // Starts from how Ghana Health Service facilities usually work this cadre, unless the form said otherwise.
      takesNights: input.takesNights ?? cadreDefaults(input.name).takesNights,
      onRoster: input.onRoster ?? cadreDefaults(input.name).onRoster,
      weekdaysOnly: input.weekdaysOnly ?? cadreDefaults(input.name).weekdaysOnly,
    },
  });
  await writeAuditLog({
    facilityId: who.facilityId,
    actorEmail: who.email,
    action: "cadre_created",
    entityType: "Cadre",
    entityId: cadre.id,
    after: { name: cadre.name, code: cadre.code },
    summary: `${who.displayName} added the ${cadre.name} cadre.`,
  });
  res.status(201).json({ cadre: { ...cadre, staffCount: 0 } });
});

cadresRouter.patch("/:id", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(cadreInput, req.body, res);
  if (!input) return;
  const existing = await prisma.cadre.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!existing) return res.status(404).json({ error: "not_found" });
  if (await nameTaken(who.facilityId, input.name, existing.id)) {
    return res.status(409).json({ error: "name_taken", fields: { name: "A cadre with this name already exists." } });
  }
  const cadre = await prisma.cadre.update({
    where: { id: existing.id },
    data: {
      name: input.name,
      code: input.code,
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.takesNights !== undefined ? { takesNights: input.takesNights } : {}),
      ...(input.onRoster !== undefined ? { onRoster: input.onRoster } : {}),
      ...(input.weekdaysOnly !== undefined ? { weekdaysOnly: input.weekdaysOnly } : {}),
    },
  });
  const changes: string[] = [];
  if (existing.name !== cadre.name) changes.push(`renamed it from ${existing.name} to ${cadre.name}`);
  if (existing.code !== cadre.code) changes.push(`changed its code to ${cadre.code ?? "none"}`);
  if (existing.sortOrder !== cadre.sortOrder) changes.push(`moved it to position ${cadre.sortOrder}`);
  if (existing.takesNights !== cadre.takesNights) changes.push(cadre.takesNights ? "put it on night duty" : "took it off night duty");
  if (existing.onRoster !== cadre.onRoster) changes.push(cadre.onRoster ? "put it on the duty roster" : "took it off the duty roster");
  if (existing.weekdaysOnly !== cadre.weekdaysOnly) changes.push(cadre.weekdaysOnly ? "set it to weekday office hours" : "returned it to shifts");
  if (changes.length) {
    await writeAuditLog({
      facilityId: who.facilityId,
      actorEmail: who.email,
      action: "cadre_updated",
      entityType: "Cadre",
      entityId: cadre.id,
      before: { name: existing.name, code: existing.code, sortOrder: existing.sortOrder },
      after: { name: cadre.name, code: cadre.code, sortOrder: cadre.sortOrder },
      summary: `${who.displayName} updated the ${existing.name} cadre: ${changes.join("; ")}.`,
    });
  }
  res.json({ cadre });
});

cadresRouter.patch("/:id/active", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(z.object({ active: z.boolean() }), req.body, res);
  if (!input) return;
  const existing = await prisma.cadre.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!existing) return res.status(404).json({ error: "not_found" });
  if (existing.active === input.active) return res.json({ cadre: existing });

  if (!input.active) {
    const inUse = await prisma.staff.count({
      where: { cadreId: existing.id, status: { in: [...CURRENT_STAFF] } },
    });
    if (inUse > 0) {
      return res.status(409).json({
        error: "in_use",
        message: `${inUse} current staff ${inUse === 1 ? "member is" : "members are"} in the ${existing.name} cadre. Move them to another cadre first.`,
      });
    }
  }

  const cadre = await prisma.cadre.update({
    where: { id: existing.id },
    data: { active: input.active, archivedAt: input.active ? null : new Date() },
  });
  await writeAuditLog({
    facilityId: who.facilityId,
    actorEmail: who.email,
    action: input.active ? "cadre_reactivated" : "cadre_deactivated",
    entityType: "Cadre",
    entityId: cadre.id,
    summary: `${who.displayName} ${input.active ? "reactivated" : "deactivated"} the ${cadre.name} cadre.`,
  });
  res.json({ cadre });
});
