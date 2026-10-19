// The access code and the people waiting to be let in. Administrators only:
// the code gets people onto the staff list, so who holds it is a decision.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400, optionalText } from "../../lib/validate.js";
import { allowRoles, caller, ADMIN_ROLES } from "../../middleware/facilityAccess.js";
import { currentCode, issueCode, codeProblem } from "../../lib/accessCode.js";
import { textStaff, smsConfigured } from "../../lib/sms.js";
import { appUrl } from "../../lib/email.js";

export const joinAdminRouter = Router();
joinAdminRouter.use(allowRoles(...ADMIN_ROLES));

async function facilityName(id: string) {
  return (await prisma.facility.findUniqueOrThrow({ where: { id }, select: { name: true } })).name;
}

const presentCode = (c: NonNullable<Awaited<ReturnType<typeof currentCode>>>) => ({
  code: c.code, active: c.active, requiresApproval: c.requiresApproval, usesCount: c.usesCount, maxUses: c.maxUses,
  expiresAt: c.expiresAt, problem: codeProblem(c), joinUrl: appUrl(`/join/${c.code}`),
});

joinAdminRouter.get("/code", async (req, res) => {
  const { facilityId, email } = caller(req);
  const c = (await currentCode(facilityId)) ?? (await issueCode(facilityId, email));
  res.json({ ...presentCode(c), phoneCheck: smsConfigured() });
});

joinAdminRouter.post("/code/regenerate", async (req, res) => {
  const { facilityId, email, displayName } = caller(req);
  const c = await issueCode(facilityId, email);
  await writeAuditLog({ facilityId, actorEmail: email, action: "access_code_regenerated", entityType: "FacilityAccessCode", entityId: c.id, summary: `${displayName} made a new staff access code. The old one no longer works.` });
  res.json({ ...presentCode(c), phoneCheck: smsConfigured() });
});

joinAdminRouter.put("/code", async (req, res) => {
  const { facilityId, email, displayName } = caller(req);
  const input = parseOr400(z.object({ requiresApproval: z.boolean(), active: z.boolean() }), req.body, res);
  if (!input) return;
  const c = (await currentCode(facilityId)) ?? (await issueCode(facilityId, email));
  const u = await prisma.facilityAccessCode.update({ where: { id: c.id }, data: input });
  await writeAuditLog({
    facilityId, actorEmail: email, action: "access_code_settings_changed", entityType: "FacilityAccessCode", entityId: c.id,
    summary: `${displayName} ${input.active ? "turned the staff access code on" : "paused the staff access code"} and set it to ${input.requiresApproval ? "wait for approval" : "let people in without approval when their phone is checked"}.`,
  });
  res.json({ ...presentCode(u), phoneCheck: smsConfigured() });
});

joinAdminRouter.get("/pending", async (req, res) => {
  const { facilityId } = caller(req);
  const rows = await prisma.staff.findMany({
    where: { facilityId, status: "PENDING", joinedVia: "CODE" }, orderBy: { createdAt: "asc" },
    select: { id: true, fullName: true, staffNo: true, phone: true, email: true, position: true, phoneVerified: true, requestedCadre: true, requestedDepartment: true, createdAt: true, cadre: { select: { id: true, name: true } }, department: { select: { id: true, name: true } } },
  });
  res.json({ pending: rows });
});

const approveInput = z.object({
  staffIds: z.array(z.string()).min(1).max(100),
  fullName: z.string().trim().min(1).max(120).optional(),
  cadreId: z.string().nullish(),
  departmentId: z.string().nullish(),
  position: optionalText(80, "Position"),
});

joinAdminRouter.post("/approve", async (req, res) => {
  const { facilityId, email, displayName } = caller(req);
  const input = parseOr400(approveInput, req.body, res);
  if (!input) return;
  const edits = input.fullName || input.cadreId !== undefined || input.departmentId !== undefined || input.position !== undefined;
  if (edits && input.staffIds.length !== 1) return res.status(400).json({ error: "invalid_input", message: "Corrections apply to one person at a time." });
  if (input.cadreId && !(await prisma.cadre.findFirst({ where: { id: input.cadreId, facilityId }, select: { id: true } }))) return res.status(400).json({ error: "invalid_input", fields: { cadreId: "Choose a cadre from the list." } });
  if (input.departmentId && !(await prisma.department.findFirst({ where: { id: input.departmentId, facilityId }, select: { id: true } }))) return res.status(400).json({ error: "invalid_input", fields: { departmentId: "Choose a department from the list." } });

  const people = await prisma.staff.findMany({ where: { id: { in: input.staffIds }, facilityId, status: "PENDING", joinedVia: "CODE" } });
  if (people.length === 0) return res.status(404).json({ error: "not_found" });
  const name = await facilityName(facilityId);
  for (const p of people) {
    await prisma.$transaction(async (tx) => {
      await tx.staff.update({
        where: { id: p.id },
        data: {
          status: "ACTIVE", requestedCadre: null, requestedDepartment: null,
          ...(input.fullName ? { fullName: input.fullName } : {}),
          ...(input.cadreId !== undefined ? { cadreId: input.cadreId || null } : {}),
          ...(input.departmentId !== undefined ? { departmentId: input.departmentId || null } : {}),
          ...(input.position !== undefined ? { position: input.position } : {}),
        },
      });
      await tx.userProfile.updateMany({ where: { staffId: p.id }, data: { active: true } });
    });
    await writeAuditLog({ facilityId, actorEmail: email, action: "staff_join_approved", entityType: "Staff", entityId: p.id, summary: `${displayName} approved ${input.fullName ?? p.fullName} to join ${name}.` });
    await textStaff(facilityId, p.id, "join_decision", `Your HealthFlow account at ${name} is approved. Sign in to see your duties: ${appUrl("/login")}`, { force: true });
  }
  res.json({ approved: people.length });
});

joinAdminRouter.post("/reject", async (req, res) => {
  const { facilityId, email, displayName } = caller(req);
  const input = parseOr400(z.object({ staffIds: z.array(z.string()).min(1).max(100), reason: z.string().trim().min(3, "Say why, in a few words.").max(200) }), req.body, res);
  if (!input) return;
  const people = await prisma.staff.findMany({ where: { id: { in: input.staffIds }, facilityId, status: "PENDING", joinedVia: "CODE" } });
  if (people.length === 0) return res.status(404).json({ error: "not_found" });
  const name = await facilityName(facilityId);
  for (const p of people) {
    await prisma.$transaction(async (tx) => {
      await tx.staff.update({ where: { id: p.id }, data: { status: "INACTIVE" } });
      await tx.userProfile.updateMany({ where: { staffId: p.id }, data: { active: false } });
    });
    await writeAuditLog({ facilityId, actorEmail: email, action: "staff_join_rejected", entityType: "Staff", entityId: p.id, summary: `${displayName} declined ${p.fullName}'s request to join ${name}. Reason: ${input.reason}` });
    await textStaff(facilityId, p.id, "join_decision", `Your request to join ${name} on HealthFlow was not approved: ${input.reason} Please see your in-charge.`, { force: true });
  }
  res.json({ rejected: people.length });
});
