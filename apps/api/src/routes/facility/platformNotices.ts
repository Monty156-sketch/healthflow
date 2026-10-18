// What PS Tech puts in front of a facility: an open support session (as a
// banner), announcements, and legal documents an administrator must
// acknowledge. Also the facility's own history of support sessions.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { allowRoles, caller, ADMIN_ROLES, READ_ROLES } from "../../middleware/facilityAccess.js";
import { closeExpiredSessions } from "../platformSupport.js";

export const noticesRouter = Router();

noticesRouter.get("/", async (req, res) => {
  const who = caller(req);
  await closeExpiredSessions();
  const now = new Date();
  const [session, announcements, seen, docs, acc] = await Promise.all([
    prisma.supportSession.findFirst({ where: { facilityId: who.facilityId, endedAt: null }, orderBy: { startedAt: "desc" } }),
    prisma.announcement.findMany({ where: { AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, { OR: [{ audience: "ALL" }, { facilityIds: { has: who.facilityId } }] }] }, orderBy: { createdAt: "desc" } }),
    prisma.announcementSeen.findMany({ where: { facilityId: who.facilityId } }),
    ADMIN_ROLES.includes(who.role) ? prisma.legalDocument.findMany({ where: { material: true, publishedAt: { not: null } }, orderBy: { publishedAt: "desc" } }) : Promise.resolve([]),
    prisma.agreementAcceptance.findMany({ where: { facilityId: who.facilityId } }),
  ]);
  const latest = new Map<string, (typeof docs)[number]>();
  for (const d of docs) if (!latest.has(d.slug)) latest.set(d.slug, d);
  const pending = [...latest.values()].filter((d) => !acc.some((a) => a.documentSlug === d.slug && a.documentVersion === d.version));
  const hidden = new Set(seen.map((s) => s.announcementId));
  res.json({
    support: session && { startedAt: session.startedAt, reason: session.reason, accessLevel: session.accessLevel, expiresAt: session.expiresAt },
    announcements: announcements.filter((a) => !(a.dismissible && hidden.has(a.id))).map((a) => ({ id: a.id, title: a.title, body: a.body, severity: a.severity, dismissible: a.dismissible })),
    legalPending: pending.map((d) => ({ slug: d.slug, title: d.title, version: d.version, summary: d.summaryOfChanges, effectiveDate: d.effectiveDate })),
  });
});

noticesRouter.post("/announcements/:id/seen", async (req, res) => {
  const who = caller(req);
  await prisma.announcementSeen.upsert({ where: { announcementId_facilityId: { announcementId: String(req.params.id), facilityId: who.facilityId } }, create: { announcementId: String(req.params.id), facilityId: who.facilityId }, update: {} });
  res.json({ ok: true });
});

/** A facility administrator accepts a material change. It is recorded with their name, role and the version. */
noticesRouter.post("/legal/acknowledge", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(z.object({ slug: z.string(), version: z.string() }), req.body, res);
  if (!input) return;
  const d = await prisma.legalDocument.findUnique({ where: { slug_version: { slug: input.slug, version: input.version } } });
  if (!d || !d.publishedAt) return res.status(404).json({ error: "not_found" });
  const done = await prisma.agreementAcceptance.findFirst({ where: { facilityId: who.facilityId, documentSlug: d.slug, documentVersion: d.version } });
  if (!done) {
    await prisma.agreementAcceptance.create({ data: { facilityId: who.facilityId, documentSlug: d.slug, documentVersion: d.version, acceptedByName: who.displayName, acceptedByRole: who.role, acceptedByEmail: who.email, ipAddress: req.ip ?? null, userAgent: req.header("user-agent")?.slice(0, 300) ?? null } });
    await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "legal_acknowledged", entityType: "LegalDocument", entityId: d.id, summary: `${who.displayName} acknowledged version ${d.version} of the ${d.slug} document.` });
  }
  res.json({ ok: true });
});

/** The facility's own record of every time PS Tech support has been inside, with the reason. */
noticesRouter.get("/support-history", allowRoles(...READ_ROLES), async (req, res) => {
  const who = caller(req);
  await closeExpiredSessions();
  const rows = await prisma.supportSession.findMany({ where: { facilityId: who.facilityId }, orderBy: { startedAt: "desc" }, take: 100 });
  res.json({ sessions: rows.map((s) => ({ id: s.id, by: s.platformUserEmail, reason: s.reason, accessLevel: s.accessLevel, startedAt: s.startedAt, endedAt: s.endedAt, endedReason: s.endedReason })) });
});
