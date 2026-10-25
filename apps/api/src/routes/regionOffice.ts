// What a regional office does that a district cannot: decide which districts
// report to it. Everything else a region sees (facilities, coverage, staffing)
// comes through the same read-only district screens, widened to the districts
// under it, and still only where each facility has granted access.
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { sendEmail, appUrl } from "../lib/email.js";
import { writeAuditLog } from "../lib/audit.js";
import { parseOr400 } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";

export const regionRouter = Router();
regionRouter.use(requireAuth, requireRegionalOffice);

async function requireRegionalOffice(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: "unauthenticated" });
  const p = await prisma.userProfile.findUnique({ where: { id: req.auth.sub }, select: { userEmail: true, role: true, scopeType: true, scopeId: true, active: true } });
  if (!p || !p.active) return res.status(401).json({ error: "session_ended" });
  if (p.role !== "DISTRICT_OFFICER" || p.scopeType !== "DISTRICT" || !p.scopeId) return res.status(403).json({ error: "forbidden" });
  const office = await prisma.district.findUnique({ where: { id: p.scopeId }, select: { id: true, name: true, region: true, level: true, active: true } });
  if (!office || !office.active || office.level !== "REGION") return res.status(403).json({ error: "forbidden", message: "This is for regional offices." });
  res.locals.office = office;
  res.locals.email = p.userEmail;
  next();
}

/** The districts that chose this regional office, waiting or approved, with how many of their facilities have shared data. */
regionRouter.get("/districts", async (_req, res) => {
  const office = res.locals.office as { id: string };
  const districts = await prisma.district.findMany({
    where: { regionOfficeId: office.id },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: { _count: { select: { facilities: true } } },
  });
  const grants = await prisma.districtGrant.groupBy({ by: ["districtId"], where: { districtId: { in: districts.map((d) => d.id) }, status: "ACTIVE" }, _count: { _all: true } });
  const shared = new Map(grants.map((g) => [g.districtId, g._count._all]));
  res.json({
    districts: districts.map((d) => ({
      id: d.id, name: d.name, status: d.status, registeredAt: d.registeredAt, approvedAt: d.approvedAt, declineReason: d.declineReason,
      contact: { name: d.contactName, role: d.contactRole, email: d.contactEmail, phone: d.contactPhone, officeAddress: d.officeAddress },
      facilities: d._count.facilities, sharing: shared.get(d.id) ?? 0,
    })),
  });
});

async function pending(req: Request, res: Response) {
  const office = res.locals.office as { id: string; name: string };
  const d = await prisma.district.findFirst({ where: { id: String(req.params.id), regionOfficeId: office.id } });
  if (!d) { res.status(404).json({ error: "not_found" }); return null; }
  return { office, d };
}

regionRouter.post("/districts/:id/approve", async (req, res) => {
  const hit = await pending(req, res);
  if (!hit) return;
  const { office, d } = hit;
  if (d.status === "ACTIVE") return res.status(409).json({ error: "already_active", message: "This district is already approved." });
  await prisma.$transaction([
    prisma.district.update({ where: { id: d.id }, data: { status: "ACTIVE", active: true, approvedAt: new Date(), declineReason: null } }),
    prisma.userProfile.updateMany({ where: { role: "DISTRICT_OFFICER", scopeType: "DISTRICT", scopeId: d.id }, data: { active: true } }),
  ]);
  await writeAuditLog({ facilityId: null, actorEmail: res.locals.email, action: "district_approved_by_region", entityType: "District", entityId: d.id, summary: `${office.name} approved the district ${d.name}.` });
  if (d.contactEmail) void sendEmail({ to: d.contactEmail, subject: "Your HealthFlow district is approved", text: `Dear ${d.contactName ?? "officer"},\n\n${office.name} has approved ${d.name} on HealthFlow. Sign in at ${appUrl("/district/login")} with the email and password you registered with.\n\nPS Tech, Wa, Upper West Region, Ghana` });
  res.json({ ok: true });
});

regionRouter.post("/districts/:id/decline", async (req, res) => {
  const input = parseOr400(z.object({ reason: z.string().trim().max(300).optional() }), req.body, res);
  if (!input) return;
  const hit = await pending(req, res);
  if (!hit) return;
  const { office, d } = hit;
  if (d.status === "ACTIVE") return res.status(409).json({ error: "already_active", message: "This district is already approved." });
  await prisma.$transaction([
    prisma.district.update({ where: { id: d.id }, data: { status: "DECLINED", active: false, declineReason: input.reason || null } }),
    prisma.userProfile.updateMany({ where: { role: "DISTRICT_OFFICER", scopeType: "DISTRICT", scopeId: d.id }, data: { active: false } }),
  ]);
  await writeAuditLog({ facilityId: null, actorEmail: res.locals.email, action: "district_declined_by_region", entityType: "District", entityId: d.id, summary: `${office.name} declined the district ${d.name}${input.reason ? `. Reason: ${input.reason}` : ""}.` });
  if (d.contactEmail) void sendEmail({ to: d.contactEmail, subject: "Your HealthFlow district registration", text: `Dear ${d.contactName ?? "officer"},\n\n${office.name} did not approve ${d.name} on HealthFlow${input.reason ? `. Reason: ${input.reason}` : ""}. Please contact them, or call PS Tech on 055 457 1800.\n\nPS Tech, Wa, Upper West Region, Ghana` });
  res.json({ ok: true });
});
