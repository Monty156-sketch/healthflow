// Who is let in, and until when: approving or declining a new registration,
// extending a date by hand, and the list of renewals coming up. Suspend and
// reinstate live with billing. Everything is written to the platform log and to
// the facility's own audit log.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { parseOr400 } from "../lib/validate.js";
import { liveUser } from "../middleware/liveUser.js";
import { platformAudit } from "../lib/platformAudit.js";
import { accessEnds, daysUntil } from "../lib/access.js";
import { appUrl, sendEmail } from "../lib/email.js";

export const accessConsole = Router();

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

const adminOf = (facilityId: string) =>
  prisma.userProfile.findFirst({ where: { facilityId, role: "FACILITY_ADMIN" }, orderBy: { createdAt: "asc" }, select: { userEmail: true, staff: { select: { fullName: true, phone: true } } } });

// ------------------------------------------------------------- registrations

/** Facilities waiting for a decision, oldest first, and the ones turned down. */
accessConsole.get("/registrations", async (_req, res) => {
  const rows = await prisma.facility.findMany({
    where: { status: { in: ["PENDING", "DECLINED"] } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, name: true, facilityType: true, region: true, status: true, accessNote: true, createdAt: true,
      district: { select: { name: true } }, subscription: { select: { plan: { select: { name: true } } } },
      _count: { select: { departments: true, cadres: true } },
    },
  });
  const out = await Promise.all(rows.map(async (f) => {
    const a = await adminOf(f.id);
    return {
      id: f.id, name: f.name, type: f.facilityType, region: f.region, district: f.district?.name ?? null, status: f.status, note: f.accessNote, registeredAt: f.createdAt,
      plan: f.subscription?.plan.name ?? null, departments: f._count.departments, cadres: f._count.cadres,
      administrator: a ? { name: a.staff?.fullName ?? null, email: a.userEmail, phone: a.staff?.phone ?? null } : null,
    };
  }));
  res.json({ pending: out.filter((r) => r.status === "PENDING"), declined: out.filter((r) => r.status === "DECLINED").reverse() });
});

accessConsole.post("/facilities/:id/approve", async (req, res) => {
  const input = parseOr400(z.object({ trialDays: z.number().int().min(1).max(365).default(30) }), req.body ?? {}, res);
  if (!input) return;
  const f = await prisma.facility.findUnique({ where: { id: String(req.params.id) }, select: { id: true, name: true, status: true } });
  if (!f) return res.status(404).json({ error: "not_found" });
  if (f.status !== "PENDING" && f.status !== "DECLINED") return res.status(409).json({ error: "not_waiting", message: "This facility is not waiting for approval." });
  const now = new Date();
  const ends = new Date(now.getTime() + input.trialDays * DAY);
  await prisma.$transaction([
    prisma.facility.update({ where: { id: f.id }, data: { status: "TRIAL", trialEndsAt: ends, accessNote: null } }),
    prisma.subscription.updateMany({ where: { facilityId: f.id }, data: { status: "TRIAL", trialEndsAt: ends, currentPeriodStart: now, currentPeriodEnd: ends } }),
  ]);
  await platformAudit(req, "facility_approved", `${liveUser(req).displayName} approved ${f.name}. The ${input.trialDays} day trial runs to ${isoDay(ends)}.`, { facilityId: f.id, entityType: "Facility", entityId: f.id });
  const a = await adminOf(f.id);
  if (a) void sendEmail({ to: a.userEmail, subject: `${f.name} is approved on HealthFlow`, text: `Dear ${a.staff?.fullName ?? "administrator"},\n\n${f.name} is approved. Your ${input.trialDays} day trial starts today and runs to ${isoDay(ends)}. Sign in at ${appUrl("/login")}, then give your staff the access code from the Staff access page.\n\nPS Tech, Wa, Upper West Region, Ghana. 055 457 1800.` });
  res.json({ ok: true, trialEndsAt: ends });
});

accessConsole.post("/facilities/:id/decline", async (req, res) => {
  const input = parseOr400(z.object({ reason: z.string().trim().min(5, "Say why.").max(300) }), req.body, res);
  if (!input) return;
  const f = await prisma.facility.findUnique({ where: { id: String(req.params.id) }, select: { id: true, name: true, status: true } });
  if (!f) return res.status(404).json({ error: "not_found" });
  if (f.status !== "PENDING") return res.status(409).json({ error: "not_waiting", message: "Only a facility waiting for approval can be declined." });
  await prisma.facility.update({ where: { id: f.id }, data: { status: "DECLINED", accessNote: input.reason } });
  await platformAudit(req, "facility_declined", `${liveUser(req).displayName} declined the registration of ${f.name}: ${input.reason}.`, { facilityId: f.id, entityType: "Facility", entityId: f.id });
  const a = await adminOf(f.id);
  if (a) void sendEmail({ to: a.userEmail, subject: `${f.name}: registration not approved`, text: `Dear ${a.staff?.fullName ?? "administrator"},\n\nWe could not approve the registration of ${f.name}. ${input.reason}\n\nIf this is a mistake, call PS Tech on 055 457 1800.` });
  res.json({ ok: true });
});

// ------------------------------------------------------------- extend by hand

/** Moves the end date by hand: a goodwill extension, or a payment received outside the system. Opens a locked account. */
accessConsole.post("/facilities/:id/extend", async (req, res) => {
  const input = parseOr400(z.object({ until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."), reason: z.string().trim().min(5, "Say why.").max(300) }), req.body, res);
  if (!input) return;
  const f = await prisma.facility.findUnique({ where: { id: String(req.params.id) }, select: { id: true, name: true, status: true, subscription: { select: { id: true, trialEndsAt: true } } } });
  if (!f) return res.status(404).json({ error: "not_found" });
  if (f.status === "PENDING" || f.status === "DECLINED") return res.status(409).json({ error: "not_open", message: "Approve the registration first." });
  const until = new Date(`${input.until}T23:59:59Z`);
  if (until.getTime() <= Date.now()) return res.status(400).json({ error: "invalid_input", fields: { until: "Choose a date in the future." } });
  const trial = Boolean(f.subscription?.trialEndsAt) || (!f.subscription && f.status === "TRIAL");
  await prisma.$transaction([
    prisma.facility.update({ where: { id: f.id }, data: { trialEndsAt: trial ? until : null, ...(f.status === "SUSPENDED" ? {} : { status: trial ? "TRIAL" : "ACTIVE", accessNote: null }) } }),
    ...(f.subscription ? [prisma.subscription.update({ where: { id: f.subscription.id }, data: trial ? { trialEndsAt: until, currentPeriodEnd: until, ...(f.status === "SUSPENDED" ? {} : { status: "TRIAL" as const }) } : { currentPeriodEnd: until, ...(f.status === "SUSPENDED" ? {} : { status: "ACTIVE" as const }) } })] : []),
  ]);
  await platformAudit(req, "access_extended", `${liveUser(req).displayName} set ${f.name}'s access to run to ${input.until}: ${input.reason}.`, { facilityId: f.id, entityType: "Facility", entityId: f.id });
  res.json({ ok: true });
});

// ------------------------------------------------------------- renewals

/** Every facility with a date to watch: who is locked, who is close, who is suspended. Soonest first. */
accessConsole.get("/renewals", async (_req, res) => {
  const rows = await prisma.facility.findMany({
    where: { active: true, status: { in: ["TRIAL", "ACTIVE", "LAPSED", "SUSPENDED"] } },
    select: {
      id: true, name: true, status: true, trialEndsAt: true, accessNote: true,
      subscription: { select: { billingCycle: true, currentPeriodEnd: true, trialEndsAt: true, plan: { select: { name: true, monthlyPriceGhs: true } } } },
      invoices: { where: { status: { in: ["ISSUED", "OVERDUE"] } }, select: { totalGhs: true, invoiceNumber: true } },
    },
  });
  const list = rows.map((f) => {
    const end = accessEnds(f, f.subscription);
    return {
      id: f.id, name: f.name, status: f.status, plan: f.subscription?.plan.name ?? null, kind: f.subscription?.trialEndsAt ? "trial" : "subscription",
      endsOn: end ? isoDay(end) : null, daysLeft: end ? daysUntil(end) : null,
      owingGhs: f.invoices.reduce((n, i) => n + i.totalGhs, 0), note: f.accessNote,
    };
  });
  const rank = (r: (typeof list)[number]) => (r.status === "LAPSED" ? -1e6 : r.daysLeft ?? 1e6);
  list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  res.json({ renewals: list });
});
