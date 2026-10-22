// The in-charge list. The facility administrator names each in-charge with their rank and ward;
// when that person signs up with the same name, the ward and rank are filled in from here.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { allowRoles, caller, ADMIN_ROLES } from "../../middleware/facilityAccess.js";
import { parseOr400, requiredText } from "../../lib/validate.js";
import { nameKey } from "../../lib/inCharges.js";

export const inChargesRouter = Router();

const present = (r: { id: string; fullName: string; rank: string; departmentId: string | null; department: { name: string } | null; claimedStaffId: string | null }) => ({
  id: r.id, fullName: r.fullName, rank: r.rank, departmentId: r.departmentId, ward: r.department?.name ?? null, signedUp: r.claimedStaffId !== null,
});

inChargesRouter.get("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const rows = await prisma.wardInCharge.findMany({ where: { facilityId: who.facilityId }, include: { department: { select: { name: true } } }, orderBy: [{ fullName: "asc" }] });
  res.json({ inCharges: rows.map(present) });
});

const input = z.object({
  fullName: requiredText(120, "Full name"),
  rank: requiredText(80, "Rank"),
  departmentId: z.string().trim().nullish().transform((v) => v || null),
});

async function checked(facilityId: string, body: z.infer<typeof input>, exceptId?: string): Promise<Record<string, string>> {
  const fields: Record<string, string> = {};
  if (body.departmentId && !(await prisma.department.findFirst({ where: { id: body.departmentId, facilityId, active: true, kind: "WARD" }, select: { id: true } }))) fields.departmentId = "Choose a ward from the list.";
  const clash = await prisma.wardInCharge.findFirst({ where: { facilityId, nameKey: nameKey(body.fullName), ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  if (clash) fields.fullName = "That name is already on the list.";
  return fields;
}

inChargesRouter.post("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const body = parseOr400(input, req.body, res);
  if (!body) return;
  const fields = await checked(who.facilityId, body);
  if (Object.keys(fields).length) return res.status(400).json({ error: "invalid_input", fields });
  const row = await prisma.wardInCharge.create({ data: { facilityId: who.facilityId, fullName: body.fullName, nameKey: nameKey(body.fullName), rank: body.rank, departmentId: body.departmentId }, include: { department: { select: { name: true } } } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "in_charge_listed", entityType: "WardInCharge", entityId: row.id, summary: `${who.displayName} added ${row.fullName} (${row.rank}${row.department ? `, ${row.department.name}` : ""}) to the in-charge list.` });
  res.status(201).json({ inCharge: present(row) });
});

inChargesRouter.patch("/:id", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const body = parseOr400(input, req.body, res);
  if (!body) return;
  const row = await prisma.wardInCharge.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!row) return res.status(404).json({ error: "not_found" });
  if (row.claimedStaffId && nameKey(body.fullName) !== row.nameKey) return res.status(409).json({ error: "signed_up", message: "This person has already signed up, so their name cannot be changed here." });
  const fields = await checked(who.facilityId, body, row.id);
  if (Object.keys(fields).length) return res.status(400).json({ error: "invalid_input", fields });
  const updated = await prisma.wardInCharge.update({ where: { id: row.id }, data: { fullName: body.fullName, nameKey: nameKey(body.fullName), rank: body.rank, departmentId: body.departmentId }, include: { department: { select: { name: true } } } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "in_charge_changed", entityType: "WardInCharge", entityId: row.id, summary: `${who.displayName} changed the in-charge list entry for ${updated.fullName} to ${updated.rank}${updated.department ? `, ${updated.department.name}` : ""}.` });
  res.json({ inCharge: present(updated) });
});

inChargesRouter.delete("/:id", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const row = await prisma.wardInCharge.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!row) return res.status(404).json({ error: "not_found" });
  await prisma.wardInCharge.delete({ where: { id: row.id } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "in_charge_removed", entityType: "WardInCharge", entityId: row.id, summary: `${who.displayName} removed ${row.fullName} from the in-charge list.${row.claimedStaffId ? " They had already signed up; their account is unchanged." : ""}` });
  res.json({ removed: true });
});
