// Who may use a facility's account, and when. A facility is open while it is on
// a trial or has paid up to a date. It is locked while it waits for approval,
// after it is declined, and after its trial or paid month ends unpaid (only the
// billing page stays open, so it can pay). A suspended facility is a separate,
// manual state: read only. Paying an invoice, by Paystack or recorded by hand,
// opens the account for another month.
import type { FacilityStatus } from "@healthflow/db";
import { prisma } from "./prisma.js";
import { writeAuditLog } from "./audit.js";
import { notifyDeciders } from "./notify.js";
import { appUrl, sendEmail } from "./email.js";

const DAY = 86_400_000;
export const REMIND_DAYS = 7;

export const LOCKED: FacilityStatus[] = ["PENDING", "DECLINED", "LAPSED"];

const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()));

type Sub = { billingCycle: string; currentPeriodEnd: Date | null; trialEndsAt: Date | null } | null;

/** The date access runs to: the trial's end while on trial, otherwise the paid period's end. Null means no end date is set. */
export function accessEnds(f: { status: FacilityStatus; trialEndsAt: Date | null }, sub: Sub): Date | null {
  if (f.status === "TRIAL") return sub?.trialEndsAt ?? f.trialEndsAt ?? sub?.currentPeriodEnd ?? null;
  return sub?.currentPeriodEnd ?? null;
}

export const daysUntil = (end: Date, now = new Date()) => Math.ceil((end.getTime() - now.getTime()) / DAY);

/** Creates the next invoice for a facility unless one is already open. Returns it. */
export async function issueRenewalInvoice(facilityId: string) {
  const open = await prisma.invoice.findFirst({ where: { facilityId, status: { in: ["ISSUED", "OVERDUE"] } } });
  if (open) return open;
  const sub = await prisma.subscription.findUnique({ where: { facilityId }, include: { plan: true } });
  if (!sub) return null;
  const months = sub.billingCycle === "ANNUAL" ? 12 : 1;
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lines: { description: string; amountGhs: number }[] = [{ description: `HealthFlow, ${sub.plan.name} plan, ${months === 12 ? "12 months" : "1 month"}`, amountGhs: sub.plan.monthlyPriceGhs * months }];
  const hadAny = await prisma.invoice.findFirst({ where: { subscriptionId: sub.id }, select: { id: true } });
  if (!hadAny && sub.plan.setupPriceGhs) lines.push({ description: "Setup and data migration", amountGhs: sub.plan.setupPriceGhs });
  const total = lines.reduce((n, l) => n + l.amountGhs, 0);
  if (total <= 0) return null;
  const tag = `HF-${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}-`;
  const seq = (await prisma.invoice.count({ where: { invoiceNumber: { startsWith: tag } } })) + 1;
  return prisma.invoice.create({
    data: {
      facilityId, subscriptionId: sub.id, invoiceNumber: `${tag}${String(seq).padStart(4, "0")}`, issuedAt: now, dueAt: new Date(now.getTime() + 7 * DAY),
      periodStart: start, periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)), lineItems: lines, subtotalGhs: total, totalGhs: total, status: "ISSUED",
    },
  });
}

/** Called once for each invoice that becomes paid. Another month (or twelve) of access, counted on from the later of today and the current end. */
export async function extendAfterPayment(facilityId: string) {
  const f = await prisma.facility.findUnique({ where: { id: facilityId }, select: { id: true, name: true, status: true, trialEndsAt: true, subscription: true } });
  const sub = f?.subscription;
  if (!f || !sub) return;
  const now = new Date();
  const from = [sub.currentPeriodEnd, sub.trialEndsAt, f.trialEndsAt].reduce<Date>((m, d) => (d && d > m ? d : m), now);
  const end = addMonths(from, sub.billingCycle === "ANNUAL" ? 12 : 1);
  const opens = f.status === "TRIAL" || f.status === "ACTIVE" || f.status === "LAPSED";
  await prisma.subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: end, currentPeriodStart: from > now ? sub.currentPeriodStart : now, trialEndsAt: null, ...(opens ? { status: "ACTIVE" } : {}) } });
  if (opens) await prisma.facility.update({ where: { id: f.id }, data: { status: "ACTIVE", trialEndsAt: null, accessNote: null } });
  await writeAuditLog({ facilityId: f.id, action: opens && f.status === "LAPSED" ? "access_restored" : "access_extended", entityType: "Facility", entityId: f.id, summary: `Payment received. ${f.name} has access until ${end.toISOString().slice(0, 10)}.` });
}

const decidersAndAdmins = (facilityId: string) =>
  prisma.userProfile.findMany({ where: { facilityId, active: true, role: "FACILITY_ADMIN" }, select: { userEmail: true } });

/**
 * Run every hour. Locks facilities whose date has passed unpaid, and each day
 * during the last week reminds the administrator and in-charges. Facilities with
 * no end date are left alone.
 */
export async function runAccessJob(now = new Date()) {
  const rows = await prisma.facility.findMany({
    where: { active: true, status: { in: ["TRIAL", "ACTIVE"] } },
    select: { id: true, name: true, status: true, trialEndsAt: true, subscription: { select: { status: true, billingCycle: true, currentPeriodEnd: true, trialEndsAt: true } } },
  });
  let lapsed = 0, reminded = 0;
  for (const f of rows) {
    const end = accessEnds(f, f.subscription);
    if (!end) continue;
    const days = daysUntil(end, now);
    const kind = f.status === "TRIAL" ? "trial" : "subscription";
    if (days <= 0) {
      await prisma.facility.update({ where: { id: f.id }, data: { status: "LAPSED" } });
      if (f.subscription && f.subscription.status !== "SUSPENDED") await prisma.subscription.updateMany({ where: { facilityId: f.id }, data: { status: "PAST_DUE" } });
      const inv = await issueRenewalInvoice(f.id);
      await writeAuditLog({ facilityId: f.id, action: "access_lapsed", entityType: "Facility", entityId: f.id, summary: `The ${kind} ended on ${end.toISOString().slice(0, 10)} without payment. Access is paused until the bill is paid.` });
      await notifyDeciders(f.id, { type: "payment_overdue", title: "Access is paused until payment", body: `The ${kind} for ${f.name} ended on ${end.toISOString().slice(0, 10)}. Pay the bill to open the system again for everyone.`, linkUrl: "/billing", severity: "ACTION" });
      void inv;
      lapsed++;
      continue;
    }
    if (days > REMIND_DAYS) continue;
    const recent = await prisma.notification.findFirst({ where: { facilityId: f.id, type: "payment_due", createdAt: { gte: new Date(now.getTime() - 20 * 3_600_000) } }, select: { id: true } });
    if (recent) continue;
    const inv = await issueRenewalInvoice(f.id);
    const when = days === 1 ? "tomorrow" : `in ${days} days`;
    const text = `The ${kind} for ${f.name} ends ${when} (${end.toISOString().slice(0, 10)}). Pay before then so nobody loses access.${inv ? ` The bill is ${inv.invoiceNumber}, GHS ${inv.totalGhs.toFixed(2)}.` : ""} If it is not paid by that day, the system closes for the whole facility until it is.`;
    await notifyDeciders(f.id, { type: "payment_due", title: `Payment due ${when}`, body: text, linkUrl: "/billing", severity: "ACTION" });
    const admins = await decidersAndAdmins(f.id);
    await Promise.allSettled(admins.map((a) => sendEmail({ to: a.userEmail, subject: `HealthFlow payment due ${when}: ${f.name}`, text: `${text}\n\nPay or download the bill: ${appUrl("/billing")}\n\nPS Tech, 055 457 1800.` })));
    reminded++;
  }
  return { lapsed, reminded };
}
