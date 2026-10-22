// What a facility administrator sees of billing: the plan, the renewal date,
// invoices with PDF download, and who to ask.
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { allowRoles, caller, ADMIN_ROLES } from "../../middleware/facilityAccess.js";
import { invoiceDocument } from "../platformBilling.js";
import { bankDetails } from "../../lib/invoicePdf.js";
import { issueRenewalInvoice } from "../../lib/access.js";
import { paystackConfigured, settleReference, startPayment } from "../../lib/paystack.js";

export const billingRouter = Router();
billingRouter.use(allowRoles(...ADMIN_ROLES));

billingRouter.get("/", async (req, res) => {
  const who = caller(req);
  const st = await prisma.facility.findUnique({ where: { id: who.facilityId }, select: { status: true } });
  // A facility whose access ended always has a bill to pay.
  if (st?.status === "LAPSED") await issueRenewalInvoice(who.facilityId);
  const [sub, invoices, facility, plans] = await Promise.all([
    prisma.subscription.findUnique({ where: { facilityId: who.facilityId }, include: { plan: { select: { name: true, monthlyPriceGhs: true } } } }),
    prisma.invoice.findMany({ where: { facilityId: who.facilityId, status: { not: "DRAFT" } }, orderBy: { issuedAt: "desc" } }),
    prisma.facility.findUniqueOrThrow({ where: { id: who.facilityId }, select: { status: true } }),
    prisma.plan.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const bankSet = Boolean(process.env.BILLING_BANK_NAME && process.env.BILLING_ACCOUNT_NAME && process.env.BILLING_ACCOUNT_NUMBER);
  res.json({
    facilityStatus: facility.status,
    subscription: sub && { plan: sub.plan.name, monthlyPriceGhs: sub.plan.monthlyPriceGhs, status: sub.status, billingCycle: sub.billingCycle, renews: sub.currentPeriodEnd, trialEndsAt: sub.trialEndsAt },
    invoices: invoices.map((i) => ({ id: i.id, number: i.invoiceNumber, issuedAt: i.issuedAt, dueAt: i.dueAt, totalGhs: i.totalGhs, status: i.status, paidAt: i.paidAt })),
    payOnline: paystackConfigured(),
    bank: bankSet ? bankDetails() : null,
    plans: plans.map((p) => ({ id: p.id, name: p.name, monthlyPriceGhs: p.monthlyPriceGhs, setupPriceGhs: p.setupPriceGhs, staffBandMin: p.staffBandMin, staffBandMax: p.staffBandMax, current: sub?.planId === p.id })),
    contact: { email: process.env.BILLING_CONTACT_EMAIL ?? process.env.ACCESS_REQUEST_NOTIFY?.split(",")[0]?.trim() ?? null, phone: process.env.BILLING_CONTACT_PHONE ?? null },
  });
});

billingRouter.get("/invoices/:id/pdf", async (req, res) => {
  const who = caller(req);
  const d = await invoiceDocument(String(req.params.id));
  if (!d || d.row.facilityId !== who.facilityId || d.row.status === "DRAFT") return res.status(404).json({ error: "not_found" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${d.row.invoiceNumber}.pdf"`);
  res.send(d.buffer);
});

/** The receipt for a paid invoice: proof of what was paid, when and how. */
billingRouter.get("/invoices/:id/receipt", async (req, res) => {
  const who = caller(req);
  const d = await invoiceDocument(String(req.params.id), true);
  if (!d || d.row.facilityId !== who.facilityId || d.row.status !== "PAID") return res.status(404).json({ error: "not_found", message: "A receipt is available once an invoice is paid." });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="Receipt-${d.row.invoiceNumber}.pdf"`);
  res.send(d.buffer);
});

/** An invoice on request, for a facility that needs the paper before it can pay. Returns the open one if there already is one. */
billingRouter.post("/invoices", async (req, res) => {
  const who = caller(req);
  const f = await prisma.facility.findUniqueOrThrow({ where: { id: who.facilityId }, select: { status: true } });
  if (!["TRIAL", "ACTIVE", "LAPSED"].includes(f.status)) return res.status(409).json({ error: "not_open", message: "An invoice cannot be raised for this account." });
  const inv = await issueRenewalInvoice(who.facilityId);
  if (!inv) return res.status(409).json({ error: "no_plan", message: "No plan is set for your facility yet, so there is nothing to invoice. Contact PS Tech." });
  res.status(201).json({ id: inv.id, number: inv.invoiceNumber });
});

/** Sends the administrator to Paystack to pay one invoice by card, mobile money or bank transfer. */
billingRouter.post("/invoices/:id/pay", async (req, res) => {
  const who = caller(req);
  if (!paystackConfigured()) return res.status(503).json({ error: "not_configured", message: "Online payment is not switched on yet. Pay by bank transfer using the details on the invoice." });
  const i = await prisma.invoice.findUnique({ where: { id: String(req.params.id) } });
  if (!i || i.facilityId !== who.facilityId || i.status === "DRAFT") return res.status(404).json({ error: "not_found" });
  if (i.status === "PAID" || i.status === "WRITTEN_OFF") return res.status(409).json({ error: "closed", message: "This invoice is already closed." });
  try {
    res.json(await startPayment(i, who.email));
  } catch (e) {
    req.log?.error(e);
    res.status(502).json({ error: "payment_unavailable", message: "The payment service did not answer. Try again in a minute." });
  }
});

/** The page Paystack sends the person back to asks here what happened. */
billingRouter.get("/payments/:reference", async (req, res) => {
  const who = caller(req);
  const ref = String(req.params.reference);
  const inv = await prisma.invoice.findFirst({ where: { facilityId: who.facilityId, id: ref.split("-")[1] } });
  if (!inv) return res.status(404).json({ error: "not_found" });
  try {
    res.json(await settleReference(ref));
  } catch (e) {
    req.log?.error(e);
    res.json({ state: "pending", invoiceNumber: inv.invoiceNumber });
  }
});
