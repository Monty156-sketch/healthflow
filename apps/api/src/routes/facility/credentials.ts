// Licences and certificates. The administrator keeps them for everyone and checks the originals. An in-charge sees their own
// ward's people. A member of staff sees and adds their own, which then wait for someone to check them.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { allowRoles, caller, ADMIN_ROLES, READ_ROLES } from "../../middleware/facilityAccess.js";
import { CREDENTIAL_KINDS, stateOf } from "../../lib/credentials.js";

export const credentialsRouter = Router();

const isoDate = z.string().trim().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) === v, "Enter a real date.");
const body = z.object({
  staffId: z.string().min(1).optional(),
  kind: z.string().trim().min(2, "Say what it is.").max(120),
  number: z.string().trim().max(60).nullish().transform((v) => v || null),
  issuer: z.string().trim().max(120).nullish().transform((v) => v || null),
  issuedOn: isoDate.nullish().transform((v) => v || null),
  expiresOn: isoDate.nullish().transform((v) => v || null),
  noExpiry: z.boolean().default(false),
}).superRefine((v, ctx) => {
  if (!v.noExpiry && !v.expiresOn) ctx.addIssue({ code: "custom", path: ["expiresOn"], message: "Enter the date it lapses, or say it does not lapse." });
  if (v.issuedOn && v.expiresOn && v.expiresOn < v.issuedOn) ctx.addIssue({ code: "custom", path: ["expiresOn"], message: "It cannot lapse before it was issued." });
});

const present = (c: { id: string; staffId: string; kind: string; number: string | null; issuer: string | null; issuedOn: Date | null; expiresOn: Date | null; noExpiry: boolean; verifiedBy: string | null; verifiedAt: Date | null; staff?: { fullName: string; staffNo: string; cadre: { name: string } | null; department: { name: string } | null } }) => ({
  id: c.id, staffId: c.staffId, kind: c.kind, number: c.number, issuer: c.issuer,
  issuedOn: c.issuedOn?.toISOString().slice(0, 10) ?? null, expiresOn: c.expiresOn?.toISOString().slice(0, 10) ?? null, noExpiry: c.noExpiry,
  verified: Boolean(c.verifiedAt), verifiedBy: c.verifiedBy,
  ...stateOf(c),
  ...(c.staff ? { name: c.staff.fullName, staffNo: c.staff.staffNo, cadre: c.staff.cadre?.name ?? null, department: c.staff.department?.name ?? null } : {}),
});
const include = { staff: { select: { fullName: true, staffNo: true, cadre: { select: { name: true } }, department: { select: { name: true } } } } } as const;

credentialsRouter.get("/kinds", (_req, res) => res.json({ kinds: CREDENTIAL_KINDS }));

/** Everyone's credentials, for the people who manage staff. `filter` narrows to those needing attention. */
credentialsRouter.get("/", allowRoles(...READ_ROLES), async (req, res) => {
  const who = caller(req);
  const filter = String(req.query.filter ?? "attention");
  const rows = await prisma.staffCredential.findMany({
    where: { facilityId: who.facilityId, archivedAt: null, staff: { status: "ACTIVE", ...(who.departmentId ? { departmentId: who.departmentId } : {}) } },
    include,
    orderBy: [{ expiresOn: "asc" }],
  });
  const all = rows.map(present);
  const list = filter === "all" ? all : filter === "unverified" ? all.filter((c) => !c.verified) : all.filter((c) => c.state === "EXPIRED" || c.state === "EXPIRING");
  res.json({ credentials: list, total: all.length });
});

/** The counts for the top of the page, and who is missing something their cadre must hold. */
credentialsRouter.get("/summary", allowRoles(...READ_ROLES), async (req, res) => {
  const who = caller(req);
  const staff = await prisma.staff.findMany({
    where: { facilityId: who.facilityId, status: "ACTIVE", ...(who.departmentId ? { departmentId: who.departmentId } : {}) },
    select: { id: true, fullName: true, staffNo: true, cadre: { select: { name: true, requiredCredentials: true } }, credentials: { where: { archivedAt: null }, select: { kind: true, expiresOn: true, noExpiry: true, verifiedAt: true } } },
  });
  let expired = 0, expiring = 0, unverified = 0;
  const missing: { staffId: string; name: string; staffNo: string; cadre: string; kind: string }[] = [];
  for (const s of staff) {
    for (const c of s.credentials) {
      const st = stateOf(c).state;
      if (st === "EXPIRED") expired++;
      if (st === "EXPIRING") expiring++;
      if (!c.verifiedAt) unverified++;
    }
    for (const kind of s.cadre?.requiredCredentials ?? []) {
      const have = s.credentials.some((c) => c.kind.toLowerCase() === kind.toLowerCase() && stateOf(c).state !== "EXPIRED");
      if (!have) missing.push({ staffId: s.id, name: s.fullName, staffNo: s.staffNo, cadre: s.cadre!.name, kind });
    }
  }
  res.json({ expired, expiring, unverified, missingCount: missing.length, missing: missing.slice(0, 200) });
});

/** The signed-in person's own credentials. */
credentialsRouter.get("/mine", async (req, res) => {
  const who = caller(req);
  if (!who.staffId) return res.json({ credentials: [] });
  const rows = await prisma.staffCredential.findMany({ where: { facilityId: who.facilityId, staffId: who.staffId, archivedAt: null }, orderBy: { expiresOn: "asc" } });
  res.json({ credentials: rows.map(present) });
});

/** One person's credentials, for their record. */
credentialsRouter.get("/staff/:staffId", allowRoles(...READ_ROLES), async (req, res) => {
  const who = caller(req);
  const rows = await prisma.staffCredential.findMany({
    where: { facilityId: who.facilityId, staffId: String(req.params.staffId), archivedAt: null, ...(who.departmentId ? { staff: { departmentId: who.departmentId } } : {}) },
    orderBy: { expiresOn: "asc" },
  });
  res.json({ credentials: rows.map(present) });
});

credentialsRouter.post("/", async (req, res) => {
  const who = caller(req);
  const input = parseOr400(body, req.body, res);
  if (!input) return;
  const admin = ADMIN_ROLES.includes(who.role);
  // A member of staff adds to their own record only; it waits to be checked.
  const staffId = admin ? input.staffId : who.staffId;
  if (!staffId) return res.status(admin ? 400 : 403).json({ error: admin ? "invalid_input" : "forbidden", fields: admin ? { staffId: "Choose the person." } : undefined, message: admin ? "Choose the person." : "Your account is not linked to a staff record." });
  const person = await prisma.staff.findFirst({ where: { id: staffId, facilityId: who.facilityId, status: "ACTIVE" }, select: { id: true, fullName: true } });
  if (!person) return res.status(404).json({ error: "not_found", message: "That person was not found." });
  const created = await prisma.staffCredential.create({
    data: {
      facilityId: who.facilityId, staffId: person.id, kind: input.kind, number: input.number, issuer: input.issuer,
      issuedOn: input.issuedOn ? new Date(`${input.issuedOn}T00:00:00.000Z`) : null, expiresOn: !input.noExpiry && input.expiresOn ? new Date(`${input.expiresOn}T00:00:00.000Z`) : null, noExpiry: input.noExpiry,
      addedBy: who.email, ...(admin ? { verifiedBy: who.displayName, verifiedAt: new Date() } : {}),
    },
    include,
  });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "credential_added", entityType: "StaffCredential", entityId: created.id, summary: `${who.displayName} recorded ${person.fullName}'s ${input.kind}${admin ? "" : ", waiting to be checked"}.` });
  res.status(201).json({ credential: present(created) });
});

/** Loads one credential the caller may change: the administrator any, a member of staff their own. */
async function changeable(req: Parameters<typeof caller>[0], res: import("express").Response) {
  const who = caller(req);
  const c = await prisma.staffCredential.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId, archivedAt: null }, include: { staff: { select: { fullName: true } } } });
  if (!c) { res.status(404).json({ error: "not_found" }); return null; }
  if (!ADMIN_ROLES.includes(who.role) && c.staffId !== who.staffId) { res.status(404).json({ error: "not_found" }); return null; }
  return { who, c };
}

credentialsRouter.put("/:id", async (req, res) => {
  const hit = await changeable(req, res);
  if (!hit) return;
  const input = parseOr400(body, req.body, res);
  if (!input) return;
  const { who, c } = hit;
  const admin = ADMIN_ROLES.includes(who.role);
  const expiry = !input.noExpiry && input.expiresOn ? new Date(`${input.expiresOn}T00:00:00.000Z`) : null;
  const dateChanged = (expiry?.getTime() ?? null) !== (c.expiresOn?.getTime() ?? null) || input.noExpiry !== c.noExpiry;
  const updated = await prisma.staffCredential.update({
    where: { id: c.id },
    data: {
      kind: input.kind, number: input.number, issuer: input.issuer, issuedOn: input.issuedOn ? new Date(`${input.issuedOn}T00:00:00.000Z`) : null, expiresOn: expiry, noExpiry: input.noExpiry,
      ...(dateChanged ? { remindedStage: 0 } : {}),
      // A member of staff's change has to be checked again. The administrator's own change stands checked.
      ...(admin ? { verifiedBy: who.displayName, verifiedAt: new Date() } : { verifiedBy: null, verifiedAt: null }),
    },
    include,
  });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "credential_changed", entityType: "StaffCredential", entityId: c.id, summary: `${who.displayName} changed ${c.staff.fullName}'s ${c.kind}.` });
  res.json({ credential: present(updated) });
});

credentialsRouter.post("/:id/verify", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const hit = await changeable(req, res);
  if (!hit) return;
  const { who, c } = hit;
  const updated = await prisma.staffCredential.update({ where: { id: c.id }, data: { verifiedBy: who.displayName, verifiedAt: new Date() }, include });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "credential_verified", entityType: "StaffCredential", entityId: c.id, summary: `${who.displayName} checked the original of ${c.staff.fullName}'s ${c.kind}.` });
  res.json({ credential: present(updated) });
});

credentialsRouter.delete("/:id", async (req, res) => {
  const hit = await changeable(req, res);
  if (!hit) return;
  const { who, c } = hit;
  await prisma.staffCredential.update({ where: { id: c.id }, data: { archivedAt: new Date() } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "credential_removed", entityType: "StaffCredential", entityId: c.id, summary: `${who.displayName} removed ${c.staff.fullName}'s ${c.kind} from the record.` });
  res.json({ ok: true });
});

// ------------------------------------------------------------- what each cadre must hold

credentialsRouter.get("/requirements", allowRoles(...READ_ROLES), async (req, res) => {
  const cadres = await prisma.cadre.findMany({ where: { facilityId: caller(req).facilityId, active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, requiredCredentials: true } });
  res.json({ cadres });
});

credentialsRouter.put("/requirements/:cadreId", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(z.object({ kinds: z.array(z.string().trim().min(2).max(120)).max(12) }), req.body, res);
  if (!input) return;
  const cadre = await prisma.cadre.findFirst({ where: { id: String(req.params.cadreId), facilityId: who.facilityId } });
  if (!cadre) return res.status(404).json({ error: "not_found" });
  const kinds = [...new Map(input.kinds.map((k) => [k.toLowerCase(), k])).values()];
  await prisma.cadre.update({ where: { id: cadre.id }, data: { requiredCredentials: kinds } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "credential_requirements_set", entityType: "Cadre", entityId: cadre.id, summary: `${who.displayName} set what ${cadre.name} staff must hold: ${kinds.join(", ") || "nothing"}.` });
  res.json({ ok: true, kinds });
});

