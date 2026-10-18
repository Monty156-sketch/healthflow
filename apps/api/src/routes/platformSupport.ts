// The rest of the console: support sessions, users, legal documents and their
// acknowledgements, announcements, feature flags and replies to error reports.
// There is no delete in any of it.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { parseOr400 } from "../lib/validate.js";
import { liveUser } from "../middleware/liveUser.js";
import { platformAudit } from "../lib/platformAudit.js";
import { writeAuditLog } from "../lib/audit.js";
import { makeResetToken } from "../lib/signedTokens.js";
import { appUrl, sendEmail } from "../lib/email.js";

export const supportConsole = Router();

const MIN = 60_000;
export const SUPPORT_MINUTES = 60;

// ------------------------------------------------------------- support sessions

/** Sessions that have run out are closed as expired the next time anyone looks. */
export async function closeExpiredSessions() {
  await prisma.supportSession.updateMany({ where: { endedAt: null, expiresAt: { lt: new Date() } }, data: { endedAt: new Date(), endedReason: "EXPIRED" } });
}

const startInput = z.object({
  facilityId: z.string(),
  reason: z.string().trim().min(10, "Write the reason, in a sentence. It is shown to the facility.").max(300),
  accessLevel: z.enum(["READ_ONLY", "FULL"]).default("READ_ONLY"),
});

supportConsole.post("/support-sessions", async (req, res) => {
  const input = parseOr400(startInput, req.body, res);
  if (!input) return;
  const me = liveUser(req);
  await closeExpiredSessions();
  const f = await prisma.facility.findUnique({ where: { id: input.facilityId }, select: { id: true, name: true } });
  if (!f) return res.status(404).json({ error: "not_found" });
  const open = await prisma.supportSession.findFirst({ where: { facilityId: f.id, platformUserEmail: me.email, endedAt: null } });
  if (open) return res.status(409).json({ error: "already_open", message: "You already have a session open for this facility. End it, or let it expire, before starting another." });
  const s = await prisma.supportSession.create({ data: { facilityId: f.id, platformUserEmail: me.email, reason: input.reason, accessLevel: input.accessLevel, expiresAt: new Date(Date.now() + SUPPORT_MINUTES * MIN) } });
  await platformAudit(req, "support_started", `${me.displayName} started a ${input.accessLevel === "FULL" ? "full access" : "read only"} support session at ${f.name} for ${SUPPORT_MINUTES} minutes. Reason: ${input.reason}`, { facilityId: f.id, entityType: "SupportSession", entityId: s.id });
  res.status(201).json({ session: s });
});

supportConsole.get("/support-sessions", async (_req, res) => {
  await closeExpiredSessions();
  const rows = await prisma.supportSession.findMany({ orderBy: { startedAt: "desc" }, take: 100, include: { facility: { select: { name: true } } } });
  res.json({ sessions: rows.map((s) => ({ id: s.id, facilityId: s.facilityId, facility: s.facility.name, by: s.platformUserEmail, reason: s.reason, accessLevel: s.accessLevel, startedAt: s.startedAt, expiresAt: s.expiresAt, endedAt: s.endedAt, endedReason: s.endedReason, active: !s.endedAt })) });
});

supportConsole.post("/support-sessions/:id/end", async (req, res) => {
  const s = await prisma.supportSession.findUnique({ where: { id: String(req.params.id) }, include: { facility: { select: { name: true } } } });
  if (!s) return res.status(404).json({ error: "not_found" });
  if (s.endedAt) return res.status(409).json({ error: "ended", message: "This session has already ended." });
  await prisma.supportSession.update({ where: { id: s.id }, data: { endedAt: new Date(), endedReason: "MANUAL" } });
  await platformAudit(req, "support_ended", `${liveUser(req).displayName} ended the support session at ${s.facility.name}.`, { facilityId: s.facilityId, entityType: "SupportSession", entityId: s.id });
  res.json({ ok: true });
});

/** The only way a platform user reads a facility's people: through an open, reasoned session, and what they see is limited. */
async function openSession(id: string, email: string) {
  await closeExpiredSessions();
  return prisma.supportSession.findFirst({ where: { id, platformUserEmail: email, endedAt: null } });
}

supportConsole.get("/support-sessions/:id/view/staff", async (req, res) => {
  const me = liveUser(req);
  const s = await openSession(String(req.params.id), me.email);
  if (!s) return res.status(403).json({ error: "no_session", message: "There is no open support session for this. Start one with a reason." });
  const staff = await prisma.staff.findMany({ where: { facilityId: s.facilityId }, orderBy: { fullName: "asc" }, select: { id: true, staffNo: true, fullName: true, status: true, cadre: { select: { name: true } }, department: { select: { name: true } } } });
  await writeAuditLog({ facilityId: s.facilityId, actorEmail: me.email, action: "support_read", entityType: "Staff", summary: `PS Tech (support access): ${me.displayName} viewed the staff list (names, numbers, cadres and departments only).` });
  res.json({ staff: staff.map((x) => ({ id: x.id, staffNo: x.staffNo, fullName: x.fullName, status: x.status, cadre: x.cadre?.name ?? null, department: x.department?.name ?? null })) });
});

supportConsole.get("/support-sessions/:id/view/rosters", async (req, res) => {
  const me = liveUser(req);
  const s = await openSession(String(req.params.id), me.email);
  if (!s) return res.status(403).json({ error: "no_session", message: "There is no open support session for this. Start one with a reason." });
  const rosters = await prisma.roster.findMany({ where: { facilityId: s.facilityId }, orderBy: [{ year: "desc" }, { month: "desc" }], take: 12, select: { id: true, year: true, month: true, status: true, version: true, publishedAt: true, hasUnresolvedConflicts: true } });
  await writeAuditLog({ facilityId: s.facilityId, actorEmail: me.email, action: "support_read", entityType: "Roster", summary: `PS Tech (support access): ${me.displayName} viewed the list of rosters.` });
  res.json({ rosters });
});

// ------------------------------------------------------------- users

supportConsole.get("/users", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) return res.json({ users: [] });
  const users = await prisma.userProfile.findMany({
    where: { OR: [{ userEmail: { contains: q, mode: "insensitive" } }, { staff: { fullName: { contains: q, mode: "insensitive" } } }] },
    take: 30, orderBy: { userEmail: "asc" },
    select: { id: true, userEmail: true, role: true, scopeType: true, active: true, lastSignInAt: true, mfaEnabled: true, lockedUntil: true, facility: { select: { id: true, name: true } }, staff: { select: { fullName: true } } },
  });
  res.json({ users: users.map((u) => ({ id: u.id, email: u.userEmail, name: u.staff?.fullName ?? null, role: u.role, scope: u.scopeType, facility: u.facility?.name ?? null, active: u.active, lastSignInAt: u.lastSignInAt, mfaEnabled: u.mfaEnabled, locked: Boolean(u.lockedUntil && u.lockedUntil > new Date()) })) });
});

async function target(req: Parameters<typeof liveUser>[0], id: string) {
  const u = await prisma.userProfile.findUnique({ where: { id }, select: { id: true, userEmail: true, passwordHash: true, role: true, scopeType: true, facilityId: true, active: true } });
  if (!u) return null;
  if (u.id === liveUser(req).id) return "self" as const;
  if (u.role === "PLATFORM_ADMIN") return "platform" as const;
  return u;
}

async function userAction(req: Parameters<typeof liveUser>[0], res: import("express").Response, id: string, action: string, apply: (u: NonNullable<Awaited<ReturnType<typeof target>> & object>) => Promise<{ summary: string; body?: object }>) {
  const u = await target(req, id);
  if (!u) return res.status(404).json({ error: "not_found" });
  if (u === "self" || u === "platform") return res.status(403).json({ error: "forbidden", message: "Platform accounts are changed by their owners, not from here." });
  const out = await apply(u);
  await platformAudit(req, action, `${liveUser(req).displayName} ${out.summary} for ${u.userEmail}.`, { facilityId: u.facilityId, entityType: "UserProfile", entityId: u.id });
  return res.json(out.body ?? { ok: true });
}

supportConsole.post("/users/:id/reset-link", (req, res) =>
  userAction(req, res, String(req.params.id), "user_reset_link", async (u) => {
    const { token, expiresAt } = makeResetToken(u.id, u.passwordHash);
    return { summary: "issued a password reset link", body: { url: appUrl(`/reset-password?token=${encodeURIComponent(token)}`), expiresAt } };
  }));

supportConsole.post("/users/:id/unlock", (req, res) =>
  userAction(req, res, String(req.params.id), "user_unlocked", async (u) => {
    await prisma.userProfile.update({ where: { id: u.id }, data: { failedAttempts: 0, lockedUntil: null } });
    return { summary: "unlocked the account" };
  }));

/** Only after identity is confirmed by a means outside the system. The person sets up two-step sign-in again. */
supportConsole.post("/users/:id/reset-mfa", (req, res) =>
  userAction(req, res, String(req.params.id), "user_mfa_reset", async (u) => {
    await prisma.userProfile.update({ where: { id: u.id }, data: { mfaEnabled: false, mfaSecretEncrypted: null, recoveryCodesHashed: [] } });
    return { summary: "reset two-step sign-in" };
  }));

supportConsole.post("/users/:id/deactivate", (req, res) =>
  userAction(req, res, String(req.params.id), "user_deactivated", async (u) => {
    await prisma.userProfile.update({ where: { id: u.id }, data: { active: false } });
    await prisma.refreshToken.updateMany({ where: { userProfileId: u.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "account deactivated by PS Tech" } });
    return { summary: "deactivated the account" };
  }));

supportConsole.post("/users/:id/reactivate", (req, res) =>
  userAction(req, res, String(req.params.id), "user_reactivated", async (u) => {
    await prisma.userProfile.update({ where: { id: u.id }, data: { active: true } });
    return { summary: "reactivated the account" };
  }));

supportConsole.patch("/users/:id/role", async (req, res) => {
  const input = parseOr400(z.object({ role: z.enum(["STAFF", "SUPERVISOR", "ROSTER_MANAGER", "FACILITY_ADMIN"]) }), req.body, res);
  if (!input) return;
  return userAction(req, res, String(req.params.id), "user_role_changed", async (u) => {
    await prisma.userProfile.update({ where: { id: u.id }, data: { role: input.role } });
    return { summary: `changed the role from ${u.role.toLowerCase().replace(/_/g, " ")} to ${input.role.toLowerCase().replace(/_/g, " ")}` };
  });
});

// ------------------------------------------------------------- legal documents

const legalInput = z.object({
  slug: z.enum(["terms", "privacy", "dpa", "security"]),
  title: z.string().trim().min(3).max(160),
  version: z.string().trim().min(1).max(20),
  body: z.string().trim().min(50, "The document is too short to publish."),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the effective date."),
  summaryOfChanges: z.string().trim().min(5, "Say what changed.").max(1000),
  material: z.boolean().default(false),
});

supportConsole.get("/legal", async (_req, res) => {
  const docs = await prisma.legalDocument.findMany({ orderBy: [{ slug: "asc" }, { publishedAt: "desc" }] });
  res.json({ documents: docs.map((d) => ({ id: d.id, slug: d.slug, title: d.title, version: d.version, effectiveDate: d.effectiveDate, publishedAt: d.publishedAt, publishedBy: d.publishedBy, summaryOfChanges: d.summaryOfChanges, material: d.material })) });
});

supportConsole.get("/legal/:slug/current", async (req, res) => {
  const d = await prisma.legalDocument.findFirst({ where: { slug: String(req.params.slug), publishedAt: { not: null } }, orderBy: { publishedAt: "desc" } });
  res.json({ document: d });
});

supportConsole.post("/legal", async (req, res) => {
  const input = parseOr400(legalInput, req.body, res);
  if (!input) return;
  if (await prisma.legalDocument.findUnique({ where: { slug_version: { slug: input.slug, version: input.version } }, select: { id: true } })) {
    return res.status(409).json({ error: "version_exists", message: "That version already exists. Published versions are never changed; choose a new version number." });
  }
  const d = await prisma.legalDocument.create({ data: { ...input, effectiveDate: new Date(`${input.effectiveDate}T00:00:00Z`), publishedAt: new Date(), publishedBy: liveUser(req).email } });
  await platformAudit(req, "legal_published", `${liveUser(req).displayName} published version ${d.version} of the ${d.slug} document${d.material ? ", marked material, so facility administrators must acknowledge it" : ""}.`, { entityType: "LegalDocument", entityId: d.id });
  res.status(201).json({ document: d });
});

/** For each material document, which facilities have acknowledged its latest version, and how long the others have been outstanding. */
supportConsole.get("/legal/acknowledgements", async (_req, res) => {
  const docs = await prisma.legalDocument.findMany({ where: { material: true, publishedAt: { not: null } }, orderBy: { publishedAt: "desc" } });
  const latest = new Map<string, (typeof docs)[number]>();
  for (const d of docs) if (!latest.has(d.slug)) latest.set(d.slug, d);
  const facilities = await prisma.facility.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const acc = await prisma.agreementAcceptance.findMany({ orderBy: { acceptedAt: "desc" } });
  res.json({
    documents: [...latest.values()].map((d) => ({
      slug: d.slug, title: d.title, version: d.version, publishedAt: d.publishedAt,
      facilities: facilities.map((f) => {
        const a = acc.find((x) => x.facilityId === f.id && x.documentSlug === d.slug && x.documentVersion === d.version);
        return { facilityId: f.id, facility: f.name, acknowledged: Boolean(a), acknowledgedAt: a?.acceptedAt ?? null, by: a?.acceptedByName ?? null, outstandingDays: a ? null : Math.floor((Date.now() - d.publishedAt!.getTime()) / 86_400_000) };
      }),
    })),
  });
});

// ------------------------------------------------------------- announcements

const announceInput = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(5).max(1000),
  severity: z.enum(["INFO", "IMPORTANT", "MAINTENANCE"]).default("INFO"),
  audience: z.enum(["ALL", "SELECTED"]).default("ALL"),
  facilityIds: z.array(z.string()).default([]),
  startsAt: z.string().nullish(),
  endsAt: z.string().nullish(),
});

supportConsole.get("/announcements", async (_req, res) => {
  const rows = await prisma.announcement.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const seen = await prisma.announcementSeen.groupBy({ by: ["announcementId"], _count: { _all: true } });
  res.json({ announcements: rows.map((a) => ({ ...a, seenBy: seen.find((s) => s.announcementId === a.id)?._count._all ?? 0, live: (!a.startsAt || a.startsAt <= new Date()) && (!a.endsAt || a.endsAt > new Date()) })) });
});

supportConsole.post("/announcements", async (req, res) => {
  const input = parseOr400(announceInput, req.body, res);
  if (!input) return;
  if (input.audience === "SELECTED" && input.facilityIds.length === 0) return res.status(400).json({ error: "invalid_input", message: "Choose at least one facility, or send it to all." });
  const a = await prisma.announcement.create({
    data: { title: input.title, body: input.body, severity: input.severity, audience: input.audience, facilityIds: input.audience === "SELECTED" ? input.facilityIds : [], startsAt: input.startsAt ? new Date(input.startsAt) : new Date(), endsAt: input.endsAt ? new Date(input.endsAt) : null, dismissible: input.severity !== "IMPORTANT", publishedBy: liveUser(req).email },
  });
  await platformAudit(req, "announcement_published", `${liveUser(req).displayName} published the announcement "${a.title}" to ${a.audience === "ALL" ? "all facilities" : `${a.facilityIds.length} facilities`}.`, { entityType: "Announcement", entityId: a.id });
  res.status(201).json({ announcement: a });
});

/** Announcements are ended, not deleted. */
supportConsole.post("/announcements/:id/end", async (req, res) => {
  const a = await prisma.announcement.findUnique({ where: { id: String(req.params.id) } });
  if (!a) return res.status(404).json({ error: "not_found" });
  await prisma.announcement.update({ where: { id: a.id }, data: { endsAt: new Date() } });
  await platformAudit(req, "announcement_ended", `${liveUser(req).displayName} ended the announcement "${a.title}".`, { entityType: "Announcement", entityId: a.id });
  res.json({ ok: true });
});

// ------------------------------------------------------------- feature flags

supportConsole.get("/flags", async (_req, res) => {
  res.json({ flags: await prisma.featureFlag.findMany({ orderBy: { key: "asc" } }) });
});

supportConsole.put("/flags/:key", async (req, res) => {
  const input = parseOr400(z.object({ description: z.string().trim().max(300).nullish(), enabledGlobally: z.boolean(), enabledForFacilityIds: z.array(z.string()).default([]) }), req.body, res);
  if (!input) return;
  const key = String(req.params.key);
  if (!/^[a-z][a-z0-9_.-]{1,60}$/.test(key)) return res.status(400).json({ error: "invalid_input", message: "A flag key uses lower case letters, numbers and dots, for example district.oversight." });
  const f = await prisma.featureFlag.upsert({ where: { key }, create: { key, description: input.description ?? null, enabledGlobally: input.enabledGlobally, enabledForFacilityIds: input.enabledForFacilityIds, updatedBy: liveUser(req).email }, update: { description: input.description ?? null, enabledGlobally: input.enabledGlobally, enabledForFacilityIds: input.enabledForFacilityIds, updatedBy: liveUser(req).email } });
  await platformAudit(req, "flag_set", `${liveUser(req).displayName} set the feature flag ${key}: ${f.enabledGlobally ? "on for everyone" : `on for ${f.enabledForFacilityIds.length} facilities`}.`, { entityType: "FeatureFlag", entityId: f.id });
  res.json({ flag: f });
});

// ------------------------------------------------------------- error reports

supportConsole.get("/errors", async (_req, res) => {
  const rows = await prisma.errorReport.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { facility: { select: { name: true } } } });
  res.json({ reports: rows.map((r) => ({ id: r.id, createdAt: r.createdAt, facility: r.facility?.name ?? null, reportedBy: r.reportedBy, screen: r.screen, description: r.description, status: r.status, resolutionNote: r.resolutionNote, reply: r.reply, repliedAt: r.repliedAt })) });
});

/** Answers the person who reported a problem: an in-app notice and, when email is set up, an email. */
supportConsole.post("/errors/:id/reply", async (req, res) => {
  const input = parseOr400(z.object({ message: z.string().trim().min(5, "Write the reply.").max(1000), resolve: z.boolean().default(false) }), req.body, res);
  if (!input) return;
  const r = await prisma.errorReport.findUnique({ where: { id: String(req.params.id) } });
  if (!r) return res.status(404).json({ error: "not_found" });
  await prisma.errorReport.update({ where: { id: r.id }, data: { reply: input.message, repliedAt: new Date(), repliedBy: liveUser(req).email, resolutionNote: input.resolve ? input.message : r.resolutionNote, status: input.resolve ? "RESOLVED" : r.status === "NEW" ? "INVESTIGATING" : r.status } });
  let notified = false;
  if (r.reportedBy && r.facilityId) {
    const staff = await prisma.userProfile.findUnique({ where: { userEmail: r.reportedBy }, select: { staffId: true } });
    await prisma.notification.create({ data: { facilityId: r.facilityId, recipientEmail: r.reportedBy, recipientStaffId: staff?.staffId ?? null, type: "problem_reply", title: "PS Tech replied to your report", body: input.message, severity: "INFO" } });
    notified = true;
  }
  const emailed = r.reportedBy ? await sendEmail({ to: r.reportedBy, subject: "Your problem report to HealthFlow", text: `${input.message}\n\nThis is a reply to the problem you reported.` }) : false;
  await platformAudit(req, "error_replied", `${liveUser(req).displayName} replied to a problem report${input.resolve ? " and marked it resolved" : ""}.`, { facilityId: r.facilityId, entityType: "ErrorReport", entityId: r.id });
  res.json({ ok: true, notified, emailed });
});
