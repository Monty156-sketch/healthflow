// The facility's side of district oversight. The facility decides whether its
// district can see anything, and which classes of data, each separately. A
// grant can be amended or withdrawn at any time and withdrawal is immediate.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { allowRoles, caller, ADMIN_ROLES, READ_ROLES } from "../../middleware/facilityAccess.js";
import { SCOPE_WORD } from "../../lib/district.js";

export const directorateRouter = Router();

const SCOPES = ["COVERAGE", "STAFFING", "ATTENDANCE", "COMPLIANCE"] as const;
const sayScopes = (s: readonly (typeof SCOPES)[number][]) => s.map((x) => SCOPE_WORD[x]).join(", ");

directorateRouter.get("/", allowRoles(...READ_ROLES), async (req, res) => {
  const who = caller(req);
  const f = await prisma.facility.findUniqueOrThrow({ where: { id: who.facilityId }, select: { district: { select: { id: true, name: true } } } });
  const grant = f.district ? await prisma.districtGrant.findFirst({ where: { facilityId: who.facilityId, districtId: f.district.id, status: "ACTIVE" } }) : null;
  const log = await prisma.auditLog.findMany({ where: { facilityId: who.facilityId, action: "district_read" }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, createdAt: true, summary: true } });
  res.json({
    district: f.district,
    grant: grant && { scopes: grant.scopes, grantedAt: grant.grantedAt, grantedBy: grant.grantedBy },
    log,
    scopes: SCOPES.map((s) => ({ scope: s })),
  });
});

const putInput = z.object({ scopes: z.array(z.enum(SCOPES)).min(1, "Choose at least one kind of information, or withdraw access.") });

directorateRouter.put("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(putInput, req.body, res);
  if (!input) return;
  const f = await prisma.facility.findUniqueOrThrow({ where: { id: who.facilityId }, select: { district: { select: { id: true, name: true } } } });
  if (!f.district) return res.status(409).json({ error: "no_district", message: "Your facility is not placed in a district yet. Ask PS Tech to set it." });
  const scopes = [...new Set(input.scopes)];
  const active = await prisma.districtGrant.findFirst({ where: { facilityId: who.facilityId, districtId: f.district.id, status: "ACTIVE" } });
  if (active) await prisma.districtGrant.update({ where: { id: active.id }, data: { scopes } });
  else await prisma.districtGrant.create({ data: { facilityId: who.facilityId, districtId: f.district.id, scopes, grantedBy: who.email } });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: active ? "district_grant_amended" : "district_grant_given", entityType: "DistrictGrant",
    summary: `${who.displayName} ${active ? "changed" : "gave"} ${f.district.name} District's access to ${sayScopes(scopes)}${active ? ` (it was ${sayScopes(active.scopes)})` : ""}.`,
  });
  res.json({ ok: true });
});

directorateRouter.post("/withdraw", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const n = await prisma.districtGrant.updateMany({ where: { facilityId: who.facilityId, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: new Date() } });
  if (n.count === 0) return res.status(409).json({ error: "no_grant", message: "No district has access to withdraw." });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "district_grant_withdrawn", entityType: "DistrictGrant", summary: `${who.displayName} withdrew the district's access. It took effect at once.` });
  res.json({ ok: true });
});

// ------------------------------------------------------------- approved establishment

directorateRouter.get("/establishment", allowRoles(...READ_ROLES), async (req, res) => {
  const who = caller(req);
  const [cadres, posts, filled] = await Promise.all([
    prisma.cadre.findMany({ where: { facilityId: who.facilityId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.establishmentPost.findMany({ where: { facilityId: who.facilityId } }),
    prisma.staff.groupBy({ by: ["cadreId"], where: { facilityId: who.facilityId, status: "ACTIVE" }, _count: { _all: true } }),
  ]);
  res.json({
    posts: cadres.map((c) => {
      const approved = posts.find((p) => p.cadreId === c.id)?.approvedCount ?? 0;
      const have = filled.find((f) => f.cadreId === c.id)?._count._all ?? 0;
      return { cadreId: c.id, cadre: c.name, approved, filled: have, vacancies: Math.max(0, approved - have) };
    }),
  });
});

const estInput = z.object({ posts: z.array(z.object({ cadreId: z.string(), approvedCount: z.number().int().min(0).max(5000) })).max(100) });

directorateRouter.put("/establishment", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(estInput, req.body, res);
  if (!input) return;
  const cadres = await prisma.cadre.findMany({ where: { facilityId: who.facilityId }, select: { id: true, name: true } });
  const changes: string[] = [];
  for (const p of input.posts) {
    const c = cadres.find((x) => x.id === p.cadreId);
    if (!c) return res.status(400).json({ error: "invalid_input", message: "A cadre in the list is not one of yours." });
    const existing = await prisma.establishmentPost.findFirst({ where: { facilityId: who.facilityId, cadreId: c.id } });
    if (existing) {
      if (existing.approvedCount !== p.approvedCount) {
        await prisma.establishmentPost.update({ where: { id: existing.id }, data: { approvedCount: p.approvedCount } });
        changes.push(`${c.name} ${existing.approvedCount} to ${p.approvedCount}`);
      }
    } else if (p.approvedCount > 0) {
      await prisma.establishmentPost.create({ data: { facilityId: who.facilityId, cadreId: c.id, approvedCount: p.approvedCount } });
      changes.push(`${c.name} set to ${p.approvedCount}`);
    }
  }
  if (changes.length) await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "establishment_changed", entityType: "EstablishmentPost", summary: `${who.displayName} changed the approved establishment: ${changes.join("; ")}.` });
  res.json({ ok: true });
});
