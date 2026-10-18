// What a facility administrator sees of billing: the plan, the renewal date,
// invoices with PDF download, and who to ask.
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { allowRoles, caller, ADMIN_ROLES } from "../../middleware/facilityAccess.js";
import { invoiceDocument } from "../platformBilling.js";

export const billingRouter = Router();
billingRouter.use(allowRoles(...ADMIN_ROLES));

billingRouter.get("/", async (req, res) => {
  const who = caller(req);
  const [sub, invoices, facility] = await Promise.all([
    prisma.subscription.findUnique({ where: { facilityId: who.facilityId }, include: { plan: { select: { name: true, monthlyPriceGhs: true } } } }),
    prisma.invoice.findMany({ where: { facilityId: who.facilityId, status: { not: "DRAFT" } }, orderBy: { issuedAt: "desc" } }),
    prisma.facility.findUniqueOrThrow({ where: { id: who.facilityId }, select: { status: true } }),
  ]);
  res.json({
    facilityStatus: facility.status,
    subscription: sub && { plan: sub.plan.name, monthlyPriceGhs: sub.plan.monthlyPriceGhs, status: sub.status, billingCycle: sub.billingCycle, renews: sub.currentPeriodEnd, trialEndsAt: sub.trialEndsAt },
    invoices: invoices.map((i) => ({ id: i.id, number: i.invoiceNumber, issuedAt: i.issuedAt, dueAt: i.dueAt, totalGhs: i.totalGhs, status: i.status, paidAt: i.paidAt })),
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
