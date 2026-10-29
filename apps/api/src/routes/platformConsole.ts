// The platform console: what needs PS Tech today. Mounted under /api/platform
// behind the platform-only guard. There is no delete anywhere in it: things
// are deactivated, suspended, archived or written off. Anything that touches a
// facility is also written to that facility's own audit log.
import { claimFacilitiesFor } from "../lib/districtLink.js";
import { AGENCY_CODES, agencyName } from "../lib/agency.js";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { adoptionFor } from "../lib/adoption.js";
import { parseOr400 } from "../lib/validate.js";
import { liveUser } from "../middleware/liveUser.js";
import { billingConsole } from "./platformBilling.js";
import { supportConsole } from "./platformSupport.js";
import { feedbackConsole } from "./platformFeedback.js";
import { accessConsole } from "./platformAccess.js";
import { platformAudit } from "../lib/platformAudit.js";
export { platformAudit };
import { seedGroups, copyConfiguration, inviteFirstAdmin, applyStandardSetup } from "../lib/facilitySetup.js";
import { hashPassword } from "../lib/password.js";
import { makeResetToken } from "../lib/signedTokens.js";
import { appUrl, sendEmail } from "../lib/email.js";

export const consoleRouter = Router();
consoleRouter.use(billingConsole);
consoleRouter.use(supportConsole);
consoleRouter.use(accessConsole);
consoleRouter.use(feedbackConsole);

const HOUR = 3_600_000;

/** What the console never reads out of a facility's audit log: people, their leave, attendance and consents. Only a logged support session shows those. */
const PRIVATE_ENTITIES = ["Staff", "LeaveRequest", "Attendance", "DutySwap", "RosterAssignment", "DutyLedgerEntry", "DataSubjectRequest", "ConsentRecord", "StaffInvitation", "UserProfile"];

// ------------------------------------------------------------- dashboard

consoleRouter.get("/dashboard", async (_req, res) => {
  const now = Date.now();
  const [overdue, errors24, facilities, subs, newest, recentErrors, adoption] = await Promise.all([
    prisma.invoice.findMany({ where: { OR: [{ status: "OVERDUE" }, { status: "ISSUED", dueAt: { lt: new Date() } }] }, select: { totalGhs: true } }),
    prisma.errorReport.count({ where: { createdAt: { gte: new Date(now - 24 * HOUR) } } }),
    prisma.facility.count({ where: { active: true, status: { in: ["ACTIVE", "TRIAL"] } } }),
    prisma.subscription.findMany({ where: { status: "ACTIVE" }, include: { plan: { select: { monthlyPriceGhs: true } } } }),
    prisma.facility.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id: true, name: true, status: true, createdAt: true, district: { select: { name: true } } } }),
    prisma.errorReport.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id: true, description: true, screen: true, status: true, createdAt: true, facility: { select: { name: true } } } }),
    adoptionFor(),
  ]);
  const byStatus = await prisma.facility.groupBy({ by: ["status"], where: { active: true, status: { in: ["PENDING", "LAPSED", "SUSPENDED"] } }, _count: { _all: true } });
  const countOf = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  const [trialing, publishedThisMonth] = await Promise.all([
    prisma.facility.findMany({ where: { active: true, status: "TRIAL" }, select: { trialEndsAt: true } }),
    prisma.roster.count({ where: { status: "PUBLISHED", year: new Date().getUTCFullYear(), month: new Date().getUTCMonth() + 1 } }),
  ]);
  const inWeek = now + 7 * 24 * HOUR;
  const atRisk = [...adoption.values()].filter((a) => a.health === "AT_RISK").length;
  res.json({
    invoices: { overdue: overdue.length, outstandingGhs: overdue.reduce((n, i) => n + i.totalGhs, 0) },
    atRisk,
    errors24h: errors24,
    activeFacilities: facilities,
    trials: {
      onTrial: trialing.length,
      endingThisWeek: trialing.filter((t) => t.trialEndsAt && t.trialEndsAt.getTime() >= now && t.trialEndsAt.getTime() <= inWeek).length,
      expired: trialing.filter((t) => t.trialEndsAt && t.trialEndsAt.getTime() < now).length,
    },
    rostersPublishedThisMonth: publishedThisMonth,
    access: { pendingApproval: countOf("PENDING"), lapsed: countOf("LAPSED"), suspended: countOf("SUSPENDED") },
    mrrGhs: subs.reduce((n, s) => n + s.plan.monthlyPriceGhs, 0),
    newestFacilities: newest.map((f) => ({ id: f.id, name: f.name, district: f.district?.name ?? null, status: f.status, createdAt: f.createdAt })),
    recentErrors: recentErrors.map((e) => ({ id: e.id, description: e.description.slice(0, 140), screen: e.screen, status: e.status, createdAt: e.createdAt, facility: e.facility?.name ?? null })),
  });
});

// ------------------------------------------------------------- trials and registrations

/** Facilities on a trial, soonest to end first, so a call can be made before one lapses. */
consoleRouter.get("/trials", async (_req, res) => {
  const now = Date.now();
  const rows = await prisma.facility.findMany({
    where: { active: true, status: "TRIAL" },
    select: { id: true, name: true, facilityType: true, createdAt: true, trialEndsAt: true, district: { select: { name: true } } },
  });
  const ids = rows.map((f) => f.id);
  const adoption = await adoptionFor(ids);
  const out = rows.map((f) => {
    const a = adoption.get(f.id);
    const daysLeft = f.trialEndsAt ? Math.ceil((f.trialEndsAt.getTime() - now) / (24 * HOUR)) : null;
    return {
      id: f.id, name: f.name, type: f.facilityType, district: f.district?.name ?? null, registeredAt: f.createdAt, trialEndsAt: f.trialEndsAt, daysLeft,
      staff: a?.staffActive ?? 0, accounts: a?.accountsActive ?? 0, lastSignInAt: a?.lastSignInAt ?? null, lastRosterPublishedAt: a?.lastRosterPublishedAt ?? null,
    };
  }).sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
  res.json({ trials: out });
});

// ------------------------------------------------------------- activity

/** The platform's own log: what PS Tech staff did, newest first. Facility logs are not read here. */
consoleRouter.get("/activity", async (req, res) => {
  const before = typeof req.query.before === "string" ? new Date(req.query.before) : null;
  const rows = await prisma.auditLog.findMany({
    where: { facilityId: null, action: { startsWith: "platform_" }, ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}) },
    orderBy: { createdAt: "desc" }, take: 51,
    select: { id: true, actorEmail: true, action: true, entityType: true, summary: true, createdAt: true },
  });
  const more = rows.length > 50;
  const page = rows.slice(0, 50);
  res.json({ entries: page, next: more ? page[page.length - 1].createdAt : null });
});

// ------------------------------------------------------------- facilities

consoleRouter.get("/facilities", async (_req, res) => {
  const facilities = await prisma.facility.findMany({
    orderBy: { name: "asc" },
    include: { district: { select: { name: true } }, subscription: { include: { plan: { select: { name: true } } } } },
  });
  const adoption = await adoptionFor(facilities.map((f) => f.id));
  res.json({
    facilities: facilities.map((f) => {
      const a = adoption.get(f.id)!;
      return {
        id: f.id, name: f.name, district: f.district?.name ?? null, status: f.status, active: f.active,
        plan: f.subscription?.plan.name ?? null, subscriptionStatus: f.subscription?.status ?? null,
        staff: a.staffActive, accounts: a.accountsActive, attendanceCompleteness: a.attendanceCompleteness, lastRosterPublishedAt: a.lastRosterPublishedAt, lastSignInAt: a.lastSignInAt, health: a.health, healthWhy: a.why,
      };
    }),
  });
});

consoleRouter.get("/facilities/:id", async (req, res) => {
  const f = await prisma.facility.findUnique({
    where: { id: String(req.params.id) },
    include: { district: true, subscription: { include: { plan: true } } },
  });
  if (!f) return res.status(404).json({ error: "not_found" });
  const [adoption, admin, rosters, invoices, shifts, cadres, rules, cycles, audit, sessions] = await Promise.all([
    adoptionFor([f.id]),
    prisma.userProfile.findFirst({ where: { facilityId: f.id, role: "FACILITY_ADMIN", active: true }, select: { userEmail: true, staff: { select: { fullName: true, phone: true } } } }),
    prisma.roster.findMany({ where: { facilityId: f.id }, orderBy: [{ year: "desc" }, { month: "desc" }], take: 12, select: { year: true, month: true, status: true, publishedAt: true, attendanceCompleteness: true, version: true } }),
    prisma.invoice.findMany({ where: { facilityId: f.id }, orderBy: { issuedAt: "desc" }, take: 24 }),
    prisma.shift.findMany({ where: { facilityId: f.id, active: true }, orderBy: { sortOrder: "asc" }, select: { name: true, code: true, startTime: true, endTime: true, minStaff: true, countsAsDuty: true } }),
    prisma.cadre.findMany({ where: { facilityId: f.id, active: true }, select: { name: true } }),
    prisma.constraintRule.findMany({ where: { facilityId: f.id }, orderBy: { code: "asc" }, select: { code: true, name: true, thresholdValue: true, unit: true, behaviour: true, enabled: true } }),
    prisma.dutyCycleRule.findMany({ where: { facilityId: f.id }, select: { name: true, consecutiveDuties: true, offDaysRequired: true, enforcement: true, active: true } }),
    prisma.auditLog.findMany({ where: { facilityId: f.id, entityType: { notIn: PRIVATE_ENTITIES } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, createdAt: true, actorEmail: true, action: true, summary: true } }),
    prisma.supportSession.findMany({ where: { facilityId: f.id }, orderBy: { startedAt: "desc" }, take: 20 }),
  ]);
  const a = adoption.get(f.id)!;
  const owing = invoices.filter((i) => i.status === "OVERDUE" || (i.status === "ISSUED" && i.dueAt && i.dueAt < new Date())).reduce((n, i) => n + i.totalGhs, 0);
  res.json({
    facility: { id: f.id, name: f.name, type: f.facilityType, region: f.region, district: f.district?.name ?? null, ghsCode: f.ghsFacilityCode, status: f.status, accessNote: f.accessNote, active: f.active, createdAt: f.createdAt, trialEndsAt: f.trialEndsAt },
    administrator: admin ? { name: admin.staff?.fullName ?? null, email: admin.userEmail, phone: admin.staff?.phone ?? null } : null,
    subscription: f.subscription && { plan: f.subscription.plan.name, status: f.subscription.status, cycle: f.subscription.billingCycle, periodEnd: f.subscription.currentPeriodEnd },
    health: { state: a.health, why: a.why },
    usage: { rosters, accountsActive: a.accountsActive, staffActive: a.staffActive, lastSignInAt: a.lastSignInAt, rostersThisMonth: a.rostersThisMonth, rostersLastMonth: a.rostersLastMonth },
    billing: { invoices: invoices.map((i) => ({ id: i.id, number: i.invoiceNumber, issuedAt: i.issuedAt, dueAt: i.dueAt, totalGhs: i.totalGhs, status: i.status, paidAt: i.paidAt })), outstandingGhs: owing },
    configuration: { shifts, cadres: cadres.map((c) => c.name), rules, cycles },
    activity: audit,
    supportSessions: sessions.map((s) => ({ id: s.id, by: s.platformUserEmail, reason: s.reason, level: s.accessLevel, startedAt: s.startedAt, endedAt: s.endedAt })),
  });
});

// ------------------------------------------------------------- districts

consoleRouter.get("/districts", async (_req, res) => {
  const districts = await prisma.district.findMany({
    orderBy: { name: "asc" },
    include: { facilities: { select: { id: true, name: true }, orderBy: { name: "asc" } } },
  });
  const officers = await prisma.userProfile.findMany({ where: { role: "DISTRICT_OFFICER", scopeType: "DISTRICT" }, select: { id: true, userEmail: true, scopeId: true, active: true, lastSignInAt: true } });
  const unassigned = await prisma.facility.findMany({ where: { districtId: null, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  res.json({
    districts: districts.map((d) => ({
      id: d.id, name: d.name, region: d.region, agency: d.agency, level: d.level, regionOfficeId: d.regionOfficeId, status: d.status, registeredAt: d.registeredAt, declineReason: d.declineReason,
      contact: { name: d.contactName, role: d.contactRole, email: d.contactEmail, phone: d.contactPhone, officeAddress: d.officeAddress },
      facilities: d.facilities, officers: officers.filter((o) => o.scopeId === d.id).map((o) => ({ id: o.id, email: o.userEmail, active: o.active, lastSignInAt: o.lastSignInAt })) })),
    unassigned,
  });
});

consoleRouter.post("/districts", async (req, res) => {
  const input = parseOr400(z.object({ name: z.string().trim().min(2).max(120), region: z.string().trim().min(2).max(120), agency: z.enum(AGENCY_CODES).default("GHS") }), req.body, res);
  if (!input) return;
  const d = await prisma.district.create({ data: input });
  await platformAudit(req, "district_created", `${liveUser(req).displayName} created the district ${d.name}.`, { entityType: "District", entityId: d.id });
  res.status(201).json({ district: d });
});

/** Approves a district that registered itself: it goes into the directory and its officer can sign in. */
consoleRouter.post("/districts/:id/approve", async (req, res) => {
  const d = await prisma.district.findUnique({ where: { id: String(req.params.id) } });
  if (!d) return res.status(404).json({ error: "not_found" });
  if (d.status === "ACTIVE") return res.status(409).json({ error: "already_active", message: "This district is already approved." });
  await prisma.$transaction(async (tx) => {
    await tx.district.update({ where: { id: d.id }, data: { status: "ACTIVE", active: true, approvedAt: new Date(), declineReason: null } });
    await tx.userProfile.updateMany({ where: { role: "DISTRICT_OFFICER", scopeType: "DISTRICT", scopeId: d.id }, data: { active: true } });
  });
  const claimed = await claimFacilitiesFor(d);
  await platformAudit(req, "district_approved", `${liveUser(req).displayName} approved the district ${d.name}. Its officer can now sign in.${claimed ? ` ${claimed} ${claimed === 1 ? "facility that had chosen" : "facilities that had chosen"} this district ${claimed === 1 ? "was" : "were"} linked to it.` : ""}`, { entityType: "District", entityId: d.id });
  if (d.contactEmail) {
    void sendEmail({ to: d.contactEmail, subject: "Your HealthFlow district is approved", text: `Dear ${d.contactName ?? "officer"},\n\n${d.name} is approved on HealthFlow. Sign in at ${appUrl("/district/login")} with the email and password you registered with.\n\nPS Tech, Wa, Upper West Region, Ghana` });
  }
  res.json({ ok: true });
});

consoleRouter.post("/districts/:id/decline", async (req, res) => {
  const input = parseOr400(z.object({ reason: z.string().trim().max(300).optional() }), req.body, res);
  if (!input) return;
  const d = await prisma.district.findUnique({ where: { id: String(req.params.id) } });
  if (!d) return res.status(404).json({ error: "not_found" });
  if (d.status === "ACTIVE") return res.status(409).json({ error: "already_active", message: "This district is already approved. Deactivate its officers instead." });
  await prisma.$transaction(async (tx) => {
    await tx.district.update({ where: { id: d.id }, data: { status: "DECLINED", active: false, declineReason: input.reason || null } });
    await tx.userProfile.updateMany({ where: { role: "DISTRICT_OFFICER", scopeType: "DISTRICT", scopeId: d.id }, data: { active: false } });
  });
  await platformAudit(req, "district_declined", `${liveUser(req).displayName} declined the district registration for ${d.name}${input.reason ? `. Reason: ${input.reason}` : ""}.`, { entityType: "District", entityId: d.id });
  res.json({ ok: true });
});

consoleRouter.put("/facilities/:id/district", async (req, res) => {
  const input = parseOr400(z.object({ districtId: z.string().nullable() }), req.body, res);
  if (!input) return;
  const f = await prisma.facility.findUnique({ where: { id: String(req.params.id) }, select: { id: true, name: true, agency: true } });
  if (!f) return res.status(404).json({ error: "not_found" });
  const target = input.districtId ? await prisma.district.findUnique({ where: { id: input.districtId }, select: { id: true, agency: true, level: true } }) : null;
  if (input.districtId && (!target || target.level !== "DISTRICT")) return res.status(404).json({ error: "not_found" });
  if (target && target.agency !== f.agency) return res.status(409).json({ error: "agency_mismatch", message: `${f.name} is a ${agencyName(f.agency)} facility and cannot be placed in a ${agencyName(target.agency)} district.` });
  // Moving a facility ends what it granted to the old district.
  await prisma.districtGrant.updateMany({ where: { facilityId: f.id, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: new Date() } });
  await prisma.facility.update({ where: { id: f.id }, data: { districtId: input.districtId } });
  await platformAudit(req, "facility_district", `${liveUser(req).displayName} ${input.districtId ? "assigned" : "removed"} the district for ${f.name}. Any earlier access grant was ended.`, { facilityId: f.id, entityType: "Facility", entityId: f.id });
  res.json({ ok: true });
});

/** Creates the login for a district officer. They set their own password from the link. */
consoleRouter.post("/districts/:id/officers", async (req, res) => {
  const input = parseOr400(z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email address.") }), req.body, res);
  if (!input) return;
  const d = await prisma.district.findUnique({ where: { id: String(req.params.id) }, select: { id: true, name: true } });
  if (!d) return res.status(404).json({ error: "not_found" });
  if (await prisma.userProfile.findUnique({ where: { userEmail: input.email }, select: { id: true } })) return res.status(409).json({ error: "email_taken", message: "That email address already has an account." });
  const { randomBytes } = await import("node:crypto");
  const hash = await hashPassword(randomBytes(24).toString("hex"));
  const u = await prisma.userProfile.create({ data: { userEmail: input.email, passwordHash: hash, role: "DISTRICT_OFFICER", scopeType: "DISTRICT", scopeId: d.id, facilityId: null } });
  const { token, expiresAt } = makeResetToken(u.id, hash);
  await platformAudit(req, "district_officer_created", `${liveUser(req).displayName} created a district officer account for ${d.name}.`, { entityType: "UserProfile", entityId: u.id });
  res.status(201).json({ url: appUrl(`/reset-password?token=${encodeURIComponent(token)}`), expiresAt });
});

// ------------------------------------------------------------- new facility wizard

const FACILITY_TYPES = ["CHPS_COMPOUND", "HEALTH_CENTRE", "CLINIC", "POLYCLINIC", "HOSPITAL", "PRIVATE_HOSPITAL", "REGIONAL_HOSPITAL", "TEACHING_HOSPITAL"] as const;

consoleRouter.get("/setup-options", async (_req, res) => {
  const [districts, facilities] = await Promise.all([
    prisma.district.findMany({ where: { active: true, status: "ACTIVE", level: "DISTRICT" }, orderBy: { name: "asc" }, select: { id: true, name: true, region: true } }),
    prisma.facility.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  res.json({ districts, facilities, types: FACILITY_TYPES });
});

/** Creates a facility directly, for one that did not arrive as an access request. */
consoleRouter.post("/facilities", async (req, res) => {
  const input = parseOr400(z.object({ name: z.string().trim().min(2).max(160), facilityType: z.enum(FACILITY_TYPES), agency: z.enum(AGENCY_CODES).optional(), districtId: z.string().nullish(), region: z.string().trim().max(120).nullish() }), req.body, res);
  if (!input) return;
  const district = input.districtId ? await prisma.district.findUnique({ where: { id: input.districtId } }) : null;
  const agency = input.agency ?? district?.agency ?? "GHS";
  if (district && district.agency !== agency) return res.status(400).json({ error: "agency_mismatch", message: "That district is under the other agency." });
  const f = await prisma.facility.create({ data: { name: input.name, facilityType: input.facilityType, agency, districtId: district?.id ?? null, region: input.region ?? district?.region ?? null, status: "TRIAL" } });
  await platformAudit(req, "facility_created", `${liveUser(req).displayName} created ${f.name}. It starts as a trial, with no staff and no administrator yet.`, { facilityId: f.id, entityType: "Facility", entityId: f.id });
  res.status(201).json({ facilityId: f.id });
});

/** Seeds departments and cadres, copies configuration if asked, and invites the facility's administrator. */
consoleRouter.post("/facilities/:id/setup", async (req, res) => {
  const input = parseOr400(z.object({
    copyFromFacilityId: z.string().nullish(),
    adminName: z.string().trim().min(2, "Enter the administrator's name.").max(120),
    adminEmail: z.string().trim().toLowerCase().email("Enter a valid email address."),
  }), req.body, res);
  if (!input) return;
  const f = await prisma.facility.findUnique({ where: { id: String(req.params.id) } });
  if (!f) return res.status(404).json({ error: "not_found" });
  if (await prisma.userProfile.findUnique({ where: { userEmail: input.adminEmail }, select: { id: true } })) return res.status(409).json({ error: "email_taken", message: "That email address already has an account." });
  if (await prisma.staff.findFirst({ where: { facilityId: f.id, email: { equals: input.adminEmail, mode: "insensitive" } }, select: { id: true } })) return res.status(409).json({ error: "already_invited", message: "That address is already on this facility's staff list." });
  const seeded = await seedGroups(f.id, f.facilityType);
  const copied = input.copyFromFacilityId && input.copyFromFacilityId !== f.id ? await copyConfiguration(input.copyFromFacilityId, f.id) : (await applyStandardSetup(f.id, f.facilityType), null);
  const invite = await inviteFirstAdmin(f.id, f.name, input.adminName, input.adminEmail);
  await platformAudit(req, "facility_setup", `${liveUser(req).displayName} set up ${f.name}: ${seeded.departments} departments and ${seeded.cadres} cadres added${copied ? `, ${copied.shifts} shifts copied` : ""}, and invited ${input.adminName} as administrator.`, { facilityId: f.id, entityType: "Facility", entityId: f.id });
  res.status(201).json({ seeded, copied, url: invite.url, expiresAt: invite.expiresAt, emailed: invite.emailed, starterNotice: invite.starterNotice });
});
