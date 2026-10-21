// Departments. Never deleted (standing instruction): deactivated instead,
// which keeps every past roster and report that names them intact.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { defaultKind, defaultRunsNights } from "../../lib/dutyPlan.js";
import { ensureSupportUnits } from "../../lib/supportUnits.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400, requiredText, optionalText } from "../../lib/validate.js";
import { allowRoles, caller, ADMIN_ROLES, READ_ROLES } from "../../middleware/facilityAccess.js";

export const departmentsRouter = Router();

const CURRENT_STAFF = ["ACTIVE", "ON_LEAVE", "PENDING"] as const;

const departmentInput = z.object({
  name: requiredText(80, "Name"),
  code: optionalText(12, "Code"),
  runsNights: z.boolean().optional(),
  kind: z.enum(["WARD", "SUPPORT", "OFFICE"]).optional(),
});

async function nameTaken(facilityId: string, name: string, exceptId?: string) {
  const clash = await prisma.department.findFirst({
    where: {
      facilityId,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(clash);
}

departmentsRouter.get("/", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  await ensureSupportUnits(facilityId);
  const departments = await prisma.department.findMany({
    where: { facilityId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: {
      _count: { select: { staff: { where: { status: { in: [...CURRENT_STAFF] } } } } },
    },
  });
  res.json({
    departments: departments.map((d) => ({
      id: d.id,
      name: d.name,
      code: d.code,
      runsNights: d.runsNights,
      kind: d.kind,
      active: d.active,
      staffCount: d._count.staff,
    })),
  });
});

departmentsRouter.post("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(departmentInput, req.body, res);
  if (!input) return;
  if (await nameTaken(who.facilityId, input.name)) {
    return res.status(409).json({ error: "name_taken", fields: { name: "A department with this name already exists." } });
  }
  const dept = await prisma.department.create({
    data: { facilityId: who.facilityId, name: input.name, code: input.code, runsNights: input.runsNights ?? defaultRunsNights(input.name), kind: input.kind ?? defaultKind(input.name) },
  });
  await writeAuditLog({
    facilityId: who.facilityId,
    actorEmail: who.email,
    action: "department_created",
    entityType: "Department",
    entityId: dept.id,
    after: { name: dept.name, code: dept.code },
    summary: `${who.displayName} added the ${dept.name} department.`,
  });
  res.status(201).json({ department: { ...dept, staffCount: 0 } });
});

departmentsRouter.patch("/:id", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(departmentInput, req.body, res);
  if (!input) return;
  const existing = await prisma.department.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!existing) return res.status(404).json({ error: "not_found" });
  if (await nameTaken(who.facilityId, input.name, existing.id)) {
    return res.status(409).json({ error: "name_taken", fields: { name: "A department with this name already exists." } });
  }
  const dept = await prisma.department.update({
    where: { id: existing.id },
    data: { name: input.name, code: input.code, ...(input.runsNights !== undefined ? { runsNights: input.runsNights } : {}), ...(input.kind ? { kind: input.kind } : {}) },
  });
  const changes: string[] = [];
  if (existing.name !== dept.name) changes.push(`renamed it from ${existing.name} to ${dept.name}`);
  if (existing.code !== dept.code) changes.push(`changed its code to ${dept.code ?? "none"}`);
  if (existing.runsNights !== dept.runsNights) changes.push(dept.runsNights ? "set it to run nights" : "set it to close at night");
  if (existing.kind !== dept.kind) changes.push(dept.kind === "WARD" ? "made it a ward run by its in-charge" : dept.kind === "SUPPORT" ? "made it a support unit rostered by the administrator" : "made it an office with no roster");
  if (changes.length) {
    await writeAuditLog({
      facilityId: who.facilityId,
      actorEmail: who.email,
      action: "department_updated",
      entityType: "Department",
      entityId: dept.id,
      before: { name: existing.name, code: existing.code },
      after: { name: dept.name, code: dept.code },
      summary: `${who.displayName} updated the ${existing.name} department: ${changes.join("; ")}.`,
    });
  }
  res.json({ department: dept });
});

departmentsRouter.patch("/:id/active", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(z.object({ active: z.boolean() }), req.body, res);
  if (!input) return;
  const existing = await prisma.department.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!existing) return res.status(404).json({ error: "not_found" });
  if (existing.active === input.active) return res.json({ department: existing });

  if (!input.active) {
    const inUse = await prisma.staff.count({
      where: { departmentId: existing.id, status: { in: [...CURRENT_STAFF] } },
    });
    if (inUse > 0) {
      return res.status(409).json({
        error: "in_use",
        message: `${inUse} current staff ${inUse === 1 ? "member is" : "members are"} in ${existing.name}. Move them to another department first.`,
      });
    }
  }

  const dept = await prisma.department.update({
    where: { id: existing.id },
    data: { active: input.active, archivedAt: input.active ? null : new Date() },
  });
  await writeAuditLog({
    facilityId: who.facilityId,
    actorEmail: who.email,
    action: input.active ? "department_reactivated" : "department_deactivated",
    entityType: "Department",
    entityId: dept.id,
    summary: `${who.displayName} ${input.active ? "reactivated" : "deactivated"} the ${dept.name} department.`,
  });
  res.json({ department: dept });
});
