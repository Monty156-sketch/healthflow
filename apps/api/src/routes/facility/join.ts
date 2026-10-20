// The access code and the people waiting to be let in. The code is the
// administrator's alone. In a hospital, a ward's in-charge also approves the
// staff who chose their ward; in-charges themselves are approved only by the
// administrator, because approval gives them that ward's rosters.
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400, optionalText } from "../../lib/validate.js";
import { allowRoles, caller, ADMIN_ROLES, READ_ROLES } from "../../middleware/facilityAccess.js";
import { isInCharge } from "../../lib/dutyPlan.js";
import { currentCode, issueCode, codeProblem } from "../../lib/accessCode.js";
import { textStaff, smsConfigured } from "../../lib/sms.js";
import { appUrl } from "../../lib/email.js";

export const joinAdminRouter = Router();
const admin = allowRoles(...ADMIN_ROLES);

/** Whose registrations this person may decide: everyone's for the administrator, their own ward's staff for a ward in-charge. */
function deciderScope(req: Request, res: Response) {
  const who = caller(req);
  if (who.role === "FACILITY_ADMIN") return { who, where: {} };
  if (!who.departmentId) {
    res.status(403).json({ error: "forbidden", message: "Only the facility administrator or a ward in-charge approves registrations." });
    return null;
  }
  return { who, where: { departmentId: who.departmentId, requestedInCharge: false } };
}

async function facilityName(id: string) {
  return (await prisma.facility.findUniqueOrThrow({ where: { id }, select: { name: true } })).name;
}

const presentCode = (c: NonNullable<Awaited<ReturnType<typeof currentCode>>>) => ({
  code: c.code, active: c.active, requiresApproval: c.requiresApproval, usesCount: c.usesCount, maxUses: c.maxUses,
  expiresAt: c.expiresAt, problem: codeProblem(c), joinUrl: appUrl(`/join/${c.code}`),
});

joinAdminRouter.get("/code", admin, async (req, res) => {
  const { facilityId, email } = caller(req);
  const c = (await currentCode(facilityId)) ?? (await issueCode(facilityId, email));
  res.json({ ...presentCode(c), phoneCheck: smsConfigured() });
});

joinAdminRouter.post("/code/regenerate", admin, async (req, res) => {
  const { facilityId, email, displayName } = caller(req);
  const c = await issueCode(facilityId, email);
  await writeAuditLog({ facilityId, actorEmail: email, action: "access_code_regenerated", entityType: "FacilityAccessCode", entityId: c.id, summary: `${displayName} made a new staff access code. The old one no longer works.` });
  res.json({ ...presentCode(c), phoneCheck: smsConfigured() });
});

joinAdminRouter.put("/code", admin, async (req, res) => {
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

joinAdminRouter.get("/pending", allowRoles(...READ_ROLES), async (req, res) => {
  const scope = deciderScope(req, res);
  if (!scope) return;
  const rows = await prisma.staff.findMany({
    where: { facilityId: scope.who.facilityId, status: "PENDING", joinedVia: "CODE", ...scope.where }, orderBy: { createdAt: "asc" },
    select: { id: true, fullName: true, requestedInCharge: true, staffNo: true, phone: true, email: true, position: true, phoneVerified: true, requestedCadre: true, requestedDepartment: true, createdAt: true, cadre: { select: { id: true, name: true } }, department: { select: { id: true, name: true } } },
  });
  res.json({ pending: rows });
});

const approveInput = z.object({
  staffIds: z.array(z.string()).min(1).max(100),
  fullName: z.string().trim().min(1).max(120).optional(),
  cadreId: z.string().nullish(),
  departmentId: z.string().nullish(),
  position: optionalText(80, "Position"),
  /** For someone who registered as an in-charge: false lets them in as ordinary staff. */
  asInCharge: z.boolean().optional(),
});

joinAdminRouter.post("/approve", allowRoles(...READ_ROLES), async (req, res) => {
  const scope = deciderScope(req, res);
  if (!scope) return;
  const { facilityId, email, displayName, departmentId: ward } = scope.who;
  const input = parseOr400(approveInput, req.body, res);
  if (!input) return;
  if (ward && input.departmentId !== undefined && input.departmentId !== ward) return res.status(403).json({ error: "forbidden", message: "Only the facility administrator can move someone to another ward." });
  const edits = input.fullName || input.cadreId !== undefined || input.departmentId !== undefined || input.position !== undefined;
  if (edits && input.staffIds.length !== 1) return res.status(400).json({ error: "invalid_input", message: "Corrections apply to one person at a time." });
  if (input.cadreId && !(await prisma.cadre.findFirst({ where: { id: input.cadreId, facilityId }, select: { id: true } }))) return res.status(400).json({ error: "invalid_input", fields: { cadreId: "Choose a cadre from the list." } });
  if (input.departmentId && !(await prisma.department.findFirst({ where: { id: input.departmentId, facilityId }, select: { id: true } }))) return res.status(400).json({ error: "invalid_input", fields: { departmentId: "Choose a department from the list." } });

  const people = await prisma.staff.findMany({ where: { id: { in: input.staffIds }, facilityId, status: "PENDING", joinedVia: "CODE", ...scope.where } });
  if (people.length === 0) return res.status(404).json({ error: "not_found" });
  const name = await facilityName(facilityId);
  for (const p of people) {
    const inCharge = p.requestedInCharge && input.asInCharge !== false;
    const wardId = input.departmentId !== undefined ? input.departmentId || null : p.departmentId;
    if (inCharge && !wardId) return res.status(400).json({ error: "invalid_input", message: `Choose the ward ${p.fullName} is in charge of.` });
    const position = input.position !== undefined ? input.position : p.position;
    await prisma.$transaction(async (tx) => {
      await tx.staff.update({
        where: { id: p.id },
        data: {
          status: "ACTIVE", requestedCadre: null, requestedDepartment: null,
          ...(input.fullName ? { fullName: input.fullName } : {}),
          ...(input.cadreId !== undefined ? { cadreId: input.cadreId || null } : {}),
          ...(input.departmentId !== undefined ? { departmentId: input.departmentId || null } : {}),
          ...(input.position !== undefined ? { position: input.position } : {}),
          // A ward in-charge works weekday mornings, like any in-charge.
          ...(inCharge ? { morningOnly: true, ...(isInCharge(position) ? {} : { position: "Ward in-charge" }) } : {}),
          requestedInCharge: false,
        },
      });
      // An approved in-charge runs their own ward's rosters and approves its staff.
      await tx.userProfile.updateMany({ where: { staffId: p.id }, data: { active: true, ...(inCharge ? { role: "ROSTER_MANAGER", departmentId: wardId } : {}) } });
    });
    await writeAuditLog({ facilityId, actorEmail: email, action: "staff_join_approved", entityType: "Staff", entityId: p.id, summary: `${displayName} approved ${input.fullName ?? p.fullName} to join ${name}${inCharge ? " as a ward in-charge" : p.requestedInCharge ? " as staff, not as an in-charge" : ""}.` });
    await textStaff(facilityId, p.id, "join_decision", `Your HealthFlow account at ${name} is approved. Sign in to see your duties: ${appUrl("/login")}`, { force: true });
  }
  res.json({ approved: people.length });
});

joinAdminRouter.post("/reject", allowRoles(...READ_ROLES), async (req, res) => {
  const scope = deciderScope(req, res);
  if (!scope) return;
  const { facilityId, email, displayName } = scope.who;
  const input = parseOr400(z.object({ staffIds: z.array(z.string()).min(1).max(100), reason: z.string().trim().min(3, "Say why, in a few words.").max(200) }), req.body, res);
  if (!input) return;
  const people = await prisma.staff.findMany({ where: { id: { in: input.staffIds }, facilityId, status: "PENDING", joinedVia: "CODE", ...scope.where } });
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
