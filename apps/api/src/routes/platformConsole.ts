// The platform console: what needs PS Tech today. Mounted under /api/platform
// behind the platform-only guard. There is no delete anywhere in it: things
// are deactivated, suspended, archived or written off. Anything that touches a
// facility is also written to that facility's own audit log.
import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@healthflow/db";
import { prisma } from "../lib/prisma.js";
import { adoptionFor } from "../lib/adoption.js";
import { parseOr400 } from "../lib/validate.js";
import { liveUser } from "../middleware/liveUser.js";
import { billingConsole } from "./platformBilling.js";
import { supportConsole } from "./platformSupport.js";
import { platformAudit } from "../lib/platformAudit.js";
export { platformAudit };
import { RESPONSE_HOURS } from "./public.js";
import { seedGroups, copyConfiguration, inviteFirstAdmin } from "../lib/facilitySetup.js";
import { ensureRules } from "./facility/rules.js";
import { hashPassword } from "../lib/password.js";
import { makeResetToken } from "../lib/signedTokens.js";
import { appUrl } from "../lib/email.js";

export const consoleRouter = Router();
consoleRouter.use(billingConsole);
consoleRouter.use(supportConsole);

const HOUR = 3_600_000;

/** What the console never reads out of a facility's audit log: people, their leave, attendance and consents. Only a logged support session shows those. */
const PRIVATE_ENTITIES = ["Staff", "LeaveRequest", "Attendance", "DutySwap", "RosterAssignment", "DutyLedgerEntry", "DataSubjectRequest", "ConsentRecord", "StaffInvitation", "UserProfile"];

// ------------------------------------------------------------- dashboard

consoleRouter.get("/dashboard", async (_req, res) => {
  const now = Date.now();
  const [waiting, overdue, errors24, facilities, subs, recentRequests, recentErrors, adoption] = await Promise.all([
    prisma.accessRequest.findMany({ where: { status: "NEW" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.invoice.findMany({ where: { OR: [{ status: "OVERDUE" }, { status: "ISSUED", dueAt: { lt: new Date() } }] }, select: { totalGhs: true } }),
    prisma.errorReport.count({ where: { createdAt: { gte: new Date(now - 24 * HOUR) } } }),
    prisma.facility.count({ where: { active: true, status: { in: ["ACTIVE", "TRIAL"] } } }),
    prisma.subscription.findMany({ where: { status: "ACTIVE" }, include: { plan: { select: { monthlyPriceGhs: true } } } }),
    prisma.accessRequest.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id: true, facilityName: true, district: true, status: true, createdAt: true } }),
    prisma.errorReport.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id: true, description: true, screen: true, status: true, createdAt: true, facility: { select: { name: true } } } }),
    adoptionFor(),
  ]);
  const oldestHours = waiting[0] ? Math.floor((now - waiting[0].createdAt.getTime()) / HOUR) : null;
  const atRisk = [...adoption.values()].filter((a) => a.health === "AT_RISK").length;
  res.json({
    requests: { waiting: waiting.length, oldestHours, publishedHours: RESPONSE_HOURS, late: oldestHours !== null && oldestHours > RESPONSE_HOURS },
    invoices: { overdue: overdue.length, outstandingGhs: overdue.reduce((n, i) => n + i.totalGhs, 0) },
    atRisk,
    errors24h: errors24,
    activeFacilities: facilities,
    mrrGhs: subs.reduce((n, s) => n + s.plan.monthlyPriceGhs, 0),
    recentRequests,
    recentErrors: recentErrors.map((e) => ({ id: e.id, description: e.description.slice(0, 140), screen: e.screen, status: e.status, createdAt: e.createdAt, facility: e.facility?.name ?? null })),
  });
});

// ------------------------------------------------------------- access requests

consoleRouter.get("/requests", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const all = status === "ALL";
  const rows = await prisma.accessRequest.findMany({
    where: all ? {} : status ? { status: status as never } : { status: { in: ["NEW", "CONTACTED"] } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  const [total, responded, provisioned, answered] = await Promise.all([
    prisma.accessRequest.count(),
    prisma.accessRequest.count({ where: { firstResponseAt: { not: null } } }),
    prisma.accessRequest.count({ where: { status: "PROVISIONED" } }),
    prisma.accessRequest.findMany({ where: { firstResponseAt: { not: null } }, select: { createdAt: true, firstResponseAt: true } }),
  ]);
  const waits = answered.map((a) => (a.firstResponseAt!.getTime() - a.createdAt.getTime()) / HOUR).sort((a, b) => a - b);
  const median = waits.length ? (waits.length % 2 ? waits[(waits.length - 1) / 2] : (waits[waits.length / 2 - 1] + waits[waits.length / 2]) / 2) : null;
  res.json({
    requests: rows.map((r) => ({ id: r.id, facilityName: r.facilityName, district: r.district, contactName: r.contactName, contactEmail: r.contactEmail, createdAt: r.createdAt, ageHours: Math.floor((Date.now() - r.createdAt.getTime()) / HOUR), status: r.status, assignedTo: r.assignedTo })),
    conversion: { received: total, responded, provisioned, medianHoursToFirstResponse: median === null ? null : Math.round(median * 10) / 10 },
    publishedHours: RESPONSE_HOURS,
  });
});

consoleRouter.get("/requests/:id", async (req, res) => {
  const r = await prisma.accessRequest.findUnique({ where: { id: String(req.params.id) }, include: { threadNotes: { orderBy: { createdAt: "asc" } } } });
  if (!r) return res.status(404).json({ error: "not_found" });
  const facility = r.provisionedFacilityId ? await prisma.facility.findUnique({ where: { id: r.provisionedFacilityId }, select: { id: true, name: true } }) : null;
  res.json({ request: { ...r, threadNotes: undefined }, notes: r.threadNotes, facility, publishedHours: RESPONSE_HOURS });
});

const STATUSES = ["NEW", "CONTACTED", "DEMO_SCHEDULED", "AGREEMENT_SENT", "PROVISIONED", "DECLINED", "DORMANT"] as const;
const patchInput = z.object({
  status: z.enum(STATUSES).optional(),
  assignedTo: z.string().trim().max(120).nullable().optional(),
  reason: z.string().trim().max(300).optional(),
});

const SAY: Record<string, string> = { CONTACTED: "responded to", DEMO_SCHEDULED: "scheduled a demonstration for", AGREEMENT_SENT: "sent the agreement for", DECLINED: "declined", DORMANT: "marked dormant" };

consoleRouter.patch("/requests/:id", async (req, res) => {
  const input = parseOr400(patchInput, req.body, res);
  if (!input) return;
  const r = await prisma.accessRequest.findUnique({ where: { id: String(req.params.id) } });
  if (!r) return res.status(404).json({ error: "not_found" });
  if (input.status === "PROVISIONED") return res.status(400).json({ error: "invalid_input", fields: { status: "Use Provision facility. It creates the facility and links it." } });
  if ((input.status === "DECLINED" || input.status === "DORMANT") && !input.reason) return res.status(400).json({ error: "invalid_input", fields: { reason: "Say why, so the record is clear later." } });
  const data: Prisma.AccessRequestUpdateInput = {};
  if (input.assignedTo !== undefined) data.assignedTo = input.assignedTo || null;
  if (input.status) {
    data.status = input.status;
    // The first move past New is the first response, whatever it was.
    if (!r.firstResponseAt && input.status !== "NEW") data.firstResponseAt = new Date();
    if (input.status === "DECLINED" || input.status === "DORMANT") data.declineReason = input.reason;
  }
  const row = await prisma.accessRequest.update({ where: { id: r.id }, data });
  if (input.status && input.status !== r.status) {
    await platformAudit(req, "request_status", `${liveUser(req).displayName} ${SAY[input.status] ?? "updated"} the access request from ${r.facilityName}${input.reason ? `. Reason: ${input.reason}` : ""}.`, { entityType: "AccessRequest", entityId: r.id });
  }
  res.json({ request: row });
});

consoleRouter.post("/requests/:id/notes", async (req, res) => {
  const input = parseOr400(z.object({ body: z.string().trim().min(1, "Write the note.").max(2000) }), req.body, res);
  if (!input) return;
  const r = await prisma.accessRequest.findUnique({ where: { id: String(req.params.id) }, select: { id: true } });
  if (!r) return res.status(404).json({ error: "not_found" });
  const note = await prisma.accessRequestNote.create({ data: { requestId: r.id, author: liveUser(req).email, body: input.body } });
  res.status(201).json({ note });
});

/** Creates the facility from the request and links the two. It never invites anyone or stores a staff record. */
consoleRouter.post("/requests/:id/provision", async (req, res) => {
  const r = await prisma.accessRequest.findUnique({ where: { id: String(req.params.id) } });
  if (!r) return res.status(404).json({ error: "not_found" });
  if (r.provisionedFacilityId) return res.status(409).json({ error: "already_provisioned", message: "This request already became a facility." });
  if (r.status === "DECLINED") return res.status(409).json({ error: "declined", message: "This request was declined. Change its status first." });
  const district = r.district ? await prisma.district.findFirst({ where: { name: { equals: r.district, mode: "insensitive" } } }) : null;
  const facility = await prisma.facility.create({
    data: { name: r.facilityName, facilityType: r.facilityType ?? "HEALTH_CENTRE", region: r.region ?? district?.region ?? null, districtId: district?.id ?? null, status: "TRIAL" },
  });
  await prisma.accessRequest.update({ where: { id: r.id }, data: { status: "PROVISIONED", provisionedFacilityId: facility.id, firstResponseAt: r.firstResponseAt ?? new Date() } });
  await prisma.accessRequestNote.create({ data: { requestId: r.id, author: liveUser(req).email, body: `Facility created from this request.` } });
  await platformAudit(req, "facility_provisioned", `${liveUser(req).displayName} created ${facility.name} from an access request. It starts as a trial, with no staff and no administrator yet.`, { facilityId: facility.id, entityType: "Facility", entityId: facility.id });
  res.status(201).json({ facilityId: facility.id });
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
        staff: a.staffActive, lastRosterPublishedAt: a.lastRosterPublishedAt, lastSignInAt: a.lastSignInAt, health: a.health, healthWhy: a.why,
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
    facility: { id: f.id, name: f.name, type: f.facilityType, region: f.region, district: f.district?.name ?? null, ghsCode: f.ghsFacilityCode, status: f.status, active: f.active, createdAt: f.createdAt, trialEndsAt: f.trialEndsAt },
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
    districts: districts.map((d) => ({ id: d.id, name: d.name, region: d.region, facilities: d.facilities, officers: officers.filter((o) => o.scopeId === d.id).map((o) => ({ id: o.id, email: o.userEmail, active: o.active, lastSignInAt: o.lastSignInAt })) })),
    unassigned,
  });
});

consoleRouter.post("/districts", async (req, res) => {
  const input = parseOr400(z.object({ name: z.string().trim().min(2).max(120), region: z.string().trim().min(2).max(120) }), req.body, res);
  if (!input) return;
  const d = await prisma.district.create({ data: input });
  await platformAudit(req, "district_created", `${liveUser(req).displayName} created the district ${d.name}.`, { entityType: "District", entityId: d.id });
  res.status(201).json({ district: d });
});

consoleRouter.put("/facilities/:id/district", async (req, res) => {
  const input = parseOr400(z.object({ districtId: z.string().nullable() }), req.body, res);
  if (!input) return;
  const f = await prisma.facility.findUnique({ where: { id: String(req.params.id) }, select: { id: true, name: true } });
  if (!f) return res.status(404).json({ error: "not_found" });
  if (input.districtId && !(await prisma.district.findUnique({ where: { id: input.districtId }, select: { id: true } }))) return res.status(404).json({ error: "not_found" });
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

const FACILITY_TYPES = ["CHPS_COMPOUND", "HEALTH_CENTRE", "CLINIC", "POLYCLINIC", "HOSPITAL", "PRIVATE_HOSPITAL"] as const;

consoleRouter.get("/setup-options", async (_req, res) => {
  const [districts, facilities] = await Promise.all([
    prisma.district.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, region: true } }),
    prisma.facility.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  res.json({ districts, facilities, types: FACILITY_TYPES });
});

/** Creates a facility directly, for one that did not arrive as an access request. */
consoleRouter.post("/facilities", async (req, res) => {
  const input = parseOr400(z.object({ name: z.string().trim().min(2).max(160), facilityType: z.enum(FACILITY_TYPES), districtId: z.string().nullish(), region: z.string().trim().max(120).nullish() }), req.body, res);
  if (!input) return;
  const district = input.districtId ? await prisma.district.findUnique({ where: { id: input.districtId } }) : null;
  const f = await prisma.facility.create({ data: { name: input.name, facilityType: input.facilityType, districtId: district?.id ?? null, region: input.region ?? district?.region ?? null, status: "TRIAL" } });
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
  const copied = input.copyFromFacilityId && input.copyFromFacilityId !== f.id ? await copyConfiguration(input.copyFromFacilityId, f.id) : (await ensureRules(f.id), null);
  const invite = await inviteFirstAdmin(f.id, f.name, input.adminName, input.adminEmail);
  await platformAudit(req, "facility_setup", `${liveUser(req).displayName} set up ${f.name}: ${seeded.departments} departments and ${seeded.cadres} cadres added${copied ? `, ${copied.shifts} shifts copied` : ""}, and invited ${input.adminName} as administrator.`, { facilityId: f.id, entityType: "Facility", entityId: f.id });
  res.status(201).json({ seeded, copied, url: invite.url, expiresAt: invite.expiresAt, emailed: invite.emailed, starterNotice: invite.starterNotice });
});
