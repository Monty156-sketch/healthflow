// Plans, subscriptions, invoices and payments, for the two people who run
// PS Tech. There is no delete anywhere: plans are retired, subscriptions are
// cancelled, invoices are written off. Suspending a facility pauses changes
// and never removes reading or export.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { parseOr400 } from "../lib/validate.js";
import { liveUser } from "../middleware/liveUser.js";
import { platformAudit } from "../lib/platformAudit.js";
import { invoicePdf, paymentTermsDays, bankDetails } from "../lib/invoicePdf.js";
import { sendEmail } from "../lib/email.js";

export const billingConsole = Router();

// Anything that lists money first brings overdue invoices up to date.
billingConsole.use(["/invoices", "/subscriptions", "/revenue"], async (_req, _res, next) => {
  try { await markOverdue(); next(); } catch (e) { next(e); }
});

const DAY = 86_400_000;
const month = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month.") });
const isOverdue = (i: { status: string; dueAt: Date | null }) => i.status === "OVERDUE" || (i.status === "ISSUED" && Boolean(i.dueAt) && i.dueAt! < new Date());

// ------------------------------------------------------------- plans

const planInput = z.object({
  name: z.string().trim().min(2).max(80),
  monthlyPriceGhs: z.number().min(0).max(1_000_000),
  setupPriceGhs: z.number().min(0).max(1_000_000).nullish(),
  staffBandMin: z.number().int().min(0).nullish(),
  staffBandMax: z.number().int().min(0).nullish(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

billingConsole.get("/plans", async (_req, res) => {
  const plans = await prisma.plan.findMany({ orderBy: [{ sortOrder: "asc" }, { monthlyPriceGhs: "asc" }], include: { _count: { select: { subscriptions: true } } } });
  res.json({ plans: plans.map((p) => ({ ...p, subscribers: p._count.subscriptions, _count: undefined })), billing: { bankConfigured: !bankDetails()[0].startsWith("Bank details are given"), termsDays: paymentTermsDays() } });
});

billingConsole.post("/plans", async (req, res) => {
  const input = parseOr400(planInput, req.body, res);
  if (!input) return;
  const p = await prisma.plan.create({ data: input });
  await platformAudit(req, "plan_created", `${liveUser(req).displayName} created the plan ${p.name} at GHS ${p.monthlyPriceGhs} a month.`, { entityType: "Plan", entityId: p.id });
  res.status(201).json({ plan: p });
});

billingConsole.patch("/plans/:id", async (req, res) => {
  const input = parseOr400(planInput.partial(), req.body, res);
  if (!input) return;
  const p = await prisma.plan.findUnique({ where: { id: String(req.params.id) } });
  if (!p) return res.status(404).json({ error: "not_found" });
  const u = await prisma.plan.update({ where: { id: p.id }, data: input });
  await platformAudit(req, "plan_changed", `${liveUser(req).displayName} changed the plan ${u.name}${input.monthlyPriceGhs !== undefined && input.monthlyPriceGhs !== p.monthlyPriceGhs ? `: the monthly price went from GHS ${p.monthlyPriceGhs} to GHS ${u.monthlyPriceGhs}` : ""}${input.active === false ? ". It is retired and cannot be chosen for new subscriptions" : ""}.`, { entityType: "Plan", entityId: p.id });
  res.json({ plan: u });
});

// ------------------------------------------------------------- subscriptions

billingConsole.get("/subscriptions", async (_req, res) => {
  const subs = await prisma.subscription.findMany({ include: { plan: { select: { name: true, monthlyPriceGhs: true } }, facility: { select: { id: true, name: true, status: true } } }, orderBy: { facility: { name: "asc" } } });
  const soon = Date.now() + 30 * DAY;
  res.json({
    subscriptions: subs.map((s) => ({ id: s.id, facilityId: s.facility.id, facility: s.facility.name, plan: s.plan.name, monthlyPriceGhs: s.plan.monthlyPriceGhs, status: s.status, billingCycle: s.billingCycle, currentPeriodEnd: s.currentPeriodEnd, trialEndsAt: s.trialEndsAt, renewingSoon: Boolean(s.currentPeriodEnd && s.currentPeriodEnd.getTime() <= soon && s.status === "ACTIVE") })),
  });
});

const subInput = z.object({
  planId: z.string(),
  billingCycle: z.enum(["MONTHLY", "ANNUAL"]).default("MONTHLY"),
  status: z.enum(["TRIAL", "ACTIVE"]).default("ACTIVE"),
  trialEndsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

/** Starts a subscription, or changes the plan or cycle of the existing one. */
billingConsole.put("/facilities/:id/subscription", async (req, res) => {
  const input = parseOr400(subInput, req.body, res);
  if (!input) return;
  const f = await prisma.facility.findUnique({ where: { id: String(req.params.id) }, select: { id: true, name: true, status: true } });
  if (!f) return res.status(404).json({ error: "not_found" });
  const plan = await prisma.plan.findUnique({ where: { id: input.planId } });
  if (!plan || !plan.active) return res.status(400).json({ error: "invalid_input", message: "Choose a plan that is still offered." });
  const now = new Date();
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + (input.billingCycle === "ANNUAL" ? 12 : 1), now.getUTCDate()));
  const trialEnds = input.status === "TRIAL" ? new Date(`${input.trialEndsAt ?? new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10)}T00:00:00Z`) : null;
  const had = await prisma.subscription.findUnique({ where: { facilityId: f.id }, include: { plan: { select: { name: true } } } });
  const data = { planId: plan.id, billingCycle: input.billingCycle, status: input.status, trialEndsAt: trialEnds, currentPeriodStart: had?.currentPeriodStart ?? now, currentPeriodEnd: had?.currentPeriodEnd ?? periodEnd };
  await prisma.subscription.upsert({ where: { facilityId: f.id }, create: { facilityId: f.id, ...data }, update: data });
  await prisma.facility.update({ where: { id: f.id }, data: { status: input.status === "ACTIVE" ? "ACTIVE" : "TRIAL", trialEndsAt: trialEnds } });
  await platformAudit(req, "subscription_set", `${liveUser(req).displayName} ${had ? `changed ${f.name}'s subscription from ${had.plan.name} to` : "started a subscription for"} ${plan.name} (${input.billingCycle.toLowerCase()}, ${input.status.toLowerCase()}).`, { facilityId: f.id, entityType: "Subscription", entityId: f.id });
  res.json({ ok: true });
});

/** Suspension pauses generation and editing. It never removes reading or export; the facility middleware enforces that. */
billingConsole.post("/facilities/:id/suspend", async (req, res) => {
  const input = parseOr400(z.object({ reason: z.string().trim().min(5, "Say why.").max(300) }), req.body, res);
  if (!input) return;
  const f = await prisma.facility.findUnique({ where: { id: String(req.params.id) }, select: { id: true, name: true } });
  if (!f) return res.status(404).json({ error: "not_found" });
  await prisma.facility.update({ where: { id: f.id }, data: { status: "SUSPENDED" } });
  await prisma.subscription.updateMany({ where: { facilityId: f.id }, data: { status: "SUSPENDED" } });
  await platformAudit(req, "facility_suspended", `${liveUser(req).displayName} suspended ${f.name}: ${input.reason}. Reading and export stay open; generating and editing are paused.`, { facilityId: f.id, entityType: "Facility", entityId: f.id });
  res.json({ ok: true });
});

billingConsole.post("/facilities/:id/reactivate", async (req, res) => {
  const f = await prisma.facility.findUnique({ where: { id: String(req.params.id) }, select: { id: true, name: true } });
  if (!f) return res.status(404).json({ error: "not_found" });
  await prisma.facility.update({ where: { id: f.id }, data: { status: "ACTIVE" } });
  await prisma.subscription.updateMany({ where: { facilityId: f.id }, data: { status: "ACTIVE" } });
  await platformAudit(req, "facility_reactivated", `${liveUser(req).displayName} reactivated ${f.name}.`, { facilityId: f.id, entityType: "Facility", entityId: f.id });
  res.json({ ok: true });
});

// ------------------------------------------------------------- invoices

billingConsole.get("/invoices", async (_req, res) => {
  const rows = await prisma.invoice.findMany({ orderBy: { issuedAt: "desc" }, include: { facility: { select: { name: true } } }, take: 300 });
  const owing = rows.filter((i) => ["ISSUED", "OVERDUE"].includes(i.status));
  res.json({
    invoices: rows.map((i) => ({ id: i.id, number: i.invoiceNumber, facility: i.facility.name, issuedAt: i.issuedAt, dueAt: i.dueAt, totalGhs: i.totalGhs, status: i.status, overdue: isOverdue(i), paidAt: i.paidAt, paymentMethod: i.paymentMethod })),
    outstandingGhs: owing.reduce((n, i) => n + i.totalGhs, 0),
    overdueGhs: rows.filter(isOverdue).reduce((n, i) => n + i.totalGhs, 0),
  });
});

type Line = { description: string; amountGhs: number };

async function planInvoices(monthStr: string) {
  const [y, m] = monthStr.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  const subs = await prisma.subscription.findMany({ where: { status: "ACTIVE" }, include: { plan: true, facility: { select: { name: true } } } });
  const out: { subscriptionId: string; facilityId: string; facility: string; lines: Line[]; totalGhs: number; already: boolean }[] = [];
  for (const s of subs) {
    // Annual subscriptions are billed once, in the month their period starts.
    if (s.billingCycle === "ANNUAL" && s.currentPeriodStart && (s.currentPeriodStart.getUTCMonth() !== m - 1)) continue;
    const already = Boolean(await prisma.invoice.findFirst({ where: { subscriptionId: s.id, periodStart: start }, select: { id: true } }));
    const monthsBilled = s.billingCycle === "ANNUAL" ? 12 : 1;
    const lines: Line[] = [{ description: `HealthFlow, ${s.plan.name} plan, ${monthsBilled === 12 ? "12 months from " : ""}${start.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`, amountGhs: s.plan.monthlyPriceGhs * monthsBilled }];
    const hadSetup = await prisma.invoice.findFirst({ where: { subscriptionId: s.id }, select: { id: true } });
    if (!hadSetup && s.plan.setupPriceGhs) lines.push({ description: "Setup and data migration", amountGhs: s.plan.setupPriceGhs });
    out.push({ subscriptionId: s.id, facilityId: s.facilityId, facility: s.facility.name, lines, totalGhs: lines.reduce((n, l) => n + l.amountGhs, 0), already });
  }
  return { start, end, items: out };
}

billingConsole.get("/invoices/preview", async (req, res) => {
  const q = month.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "invalid_input", message: "Choose a month." });
  const p = await planInvoices(q.data.month);
  res.json({ items: p.items });
});

billingConsole.post("/invoices/generate", async (req, res) => {
  const input = parseOr400(month, req.body, res);
  if (!input) return;
  const p = await planInvoices(input.month);
  let made = 0;
  for (const it of p.items) {
    if (it.already || it.totalGhs <= 0) continue;
    const seq = (await prisma.invoice.count({ where: { invoiceNumber: { startsWith: `HF-${input.month.replace("-", "")}-` } } })) + 1;
    await prisma.invoice.create({
      data: {
        facilityId: it.facilityId, subscriptionId: it.subscriptionId, invoiceNumber: `HF-${input.month.replace("-", "")}-${String(seq).padStart(4, "0")}`,
        issuedAt: new Date(), dueAt: new Date(Date.now() + paymentTermsDays() * DAY), periodStart: p.start, periodEnd: p.end,
        lineItems: it.lines, subtotalGhs: it.totalGhs, totalGhs: it.totalGhs, status: "ISSUED",
      },
    });
    made++;
  }
  await platformAudit(req, "invoices_generated", `${liveUser(req).displayName} issued ${made} invoices for ${input.month}.`, { entityType: "Invoice" });
  res.status(201).json({ issued: made, skipped: p.items.length - made });
});

async function docFor(id: string) {
  const i = await prisma.invoice.findUnique({ where: { id }, include: { facility: { select: { name: true } } } });
  if (!i) return null;
  return { row: i, buffer: await invoicePdf({ number: i.invoiceNumber, facilityName: i.facility.name, issuedAt: i.issuedAt, dueAt: i.dueAt, periodStart: i.periodStart, periodEnd: i.periodEnd, lines: i.lineItems as unknown as Line[], totalGhs: i.totalGhs, status: i.status, paidAt: i.paidAt, paymentReference: i.paymentReference }) };
}
export { docFor as invoiceDocument };

billingConsole.get("/invoices/:id/pdf", async (req, res) => {
  const d = await docFor(String(req.params.id));
  if (!d) return res.status(404).json({ error: "not_found" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${d.row.invoiceNumber}.pdf"`);
  res.send(d.buffer);
});

billingConsole.post("/invoices/:id/email", async (req, res) => {
  const d = await docFor(String(req.params.id));
  if (!d) return res.status(404).json({ error: "not_found" });
  const admin = await prisma.userProfile.findFirst({ where: { facilityId: d.row.facilityId, role: "FACILITY_ADMIN", active: true }, select: { userEmail: true } });
  if (!admin) return res.status(409).json({ error: "no_contact", message: "This facility has no administrator with an email address yet." });
  const sent = await sendEmail({ to: admin.userEmail, subject: `Invoice ${d.row.invoiceNumber} from PS Tech`, text: `Invoice ${d.row.invoiceNumber} for ${d.row.facility.name}: GHS ${d.row.totalGhs.toFixed(2)}, due ${d.row.dueAt?.toISOString().slice(0, 10) ?? "on receipt"}.\n\nIt is also in HealthFlow under Billing, where you can download the PDF.` });
  await platformAudit(req, "invoice_emailed", `${liveUser(req).displayName} ${sent ? "emailed" : "tried to email"} invoice ${d.row.invoiceNumber}.`, { facilityId: d.row.facilityId, entityType: "Invoice", entityId: d.row.id });
  res.json({ emailed: sent });
});

billingConsole.post("/invoices/:id/payment", async (req, res) => {
  const input = parseOr400(z.object({ method: z.enum(["MOBILE_MONEY", "BANK_TRANSFER", "CASH", "CARD", "OTHER"]), reference: z.string().trim().min(2, "Enter the reference.").max(120), paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.body, res);
  if (!input) return;
  const i = await prisma.invoice.findUnique({ where: { id: String(req.params.id) } });
  if (!i) return res.status(404).json({ error: "not_found" });
  if (i.status === "PAID" || i.status === "WRITTEN_OFF") return res.status(409).json({ error: "closed", message: "This invoice is already closed." });
  await prisma.invoice.update({ where: { id: i.id }, data: { status: "PAID", paidAt: input.paidOn ? new Date(`${input.paidOn}T00:00:00Z`) : new Date(), paymentMethod: input.method, paymentReference: input.reference } });
  // A facility that was past due returns to active when nothing is overdue any more.
  const stillOwing = await prisma.invoice.count({ where: { facilityId: i.facilityId, OR: [{ status: "OVERDUE" }, { status: "ISSUED", dueAt: { lt: new Date() } }] } });
  if (stillOwing === 0) await prisma.subscription.updateMany({ where: { facilityId: i.facilityId, status: "PAST_DUE" }, data: { status: "ACTIVE" } });
  await platformAudit(req, "payment_recorded", `${liveUser(req).displayName} recorded payment of GHS ${i.totalGhs.toFixed(2)} against invoice ${i.invoiceNumber} (${input.method.replace(/_/g, " ").toLowerCase()}, reference ${input.reference}).`, { facilityId: i.facilityId, entityType: "Invoice", entityId: i.id });
  res.json({ ok: true });
});

billingConsole.post("/invoices/:id/write-off", async (req, res) => {
  const input = parseOr400(z.object({ reason: z.string().trim().min(5, "Say why.").max(300) }), req.body, res);
  if (!input) return;
  const i = await prisma.invoice.findUnique({ where: { id: String(req.params.id) } });
  if (!i) return res.status(404).json({ error: "not_found" });
  if (i.status === "PAID" || i.status === "WRITTEN_OFF") return res.status(409).json({ error: "closed", message: "This invoice is already closed." });
  await prisma.invoice.update({ where: { id: i.id }, data: { status: "WRITTEN_OFF" } });
  await platformAudit(req, "invoice_written_off", `${liveUser(req).displayName} wrote off invoice ${i.invoiceNumber} (GHS ${i.totalGhs.toFixed(2)}): ${input.reason}.`, { facilityId: i.facilityId, entityType: "Invoice", entityId: i.id });
  res.json({ ok: true });
});

/** Marks issued invoices past their due date as overdue, and their subscriptions as past due. Called with the list, so it is also true without a scheduler. */
export async function markOverdue() {
  const late = await prisma.invoice.findMany({ where: { status: "ISSUED", dueAt: { lt: new Date() } }, select: { id: true, facilityId: true } });
  if (late.length === 0) return 0;
  await prisma.invoice.updateMany({ where: { id: { in: late.map((l) => l.id) } }, data: { status: "OVERDUE" } });
  await prisma.subscription.updateMany({ where: { facilityId: { in: late.map((l) => l.facilityId) }, status: "ACTIVE" }, data: { status: "PAST_DUE" } });
  return late.length;
}

// ------------------------------------------------------------- revenue

billingConsole.get("/revenue", async (_req, res) => {
  const now = new Date();
  const som = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [active, newFacs, cancelled, owing, paid] = await Promise.all([
    prisma.subscription.findMany({ where: { status: "ACTIVE" }, include: { plan: { select: { monthlyPriceGhs: true } } } }),
    prisma.subscription.count({ where: { currentPeriodStart: { gte: som }, status: { in: ["ACTIVE", "TRIAL"] } } }),
    prisma.subscription.count({ where: { status: "CANCELLED" } }),
    prisma.invoice.aggregate({ where: { status: { in: ["ISSUED", "OVERDUE"] } }, _sum: { totalGhs: true } }),
    prisma.invoice.findMany({ where: { status: "PAID", paidAt: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)) } }, select: { totalGhs: true, paidAt: true } }),
  ]);
  const trend = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1));
    const key = d.toISOString().slice(0, 7);
    return { month: key, receivedGhs: paid.filter((p) => p.paidAt!.toISOString().slice(0, 7) === key).reduce((n, p) => n + p.totalGhs, 0) };
  });
  res.json({ mrrGhs: active.reduce((n, s) => n + s.plan.monthlyPriceGhs, 0), activeSubscriptions: active.length, newThisMonth: newFacs, cancelledTotal: cancelled, receivablesGhs: owing._sum.totalGhs ?? 0, trend });
});
