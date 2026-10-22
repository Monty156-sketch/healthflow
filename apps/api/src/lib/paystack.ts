// Paystack: card, mobile money and bank transfer through one hosted page.
// The facility is sent to Paystack to pay; we never see card or wallet
// details. An invoice is marked paid only after Paystack itself confirms the
// transaction, the amount and the currency, never because a browser says so.
import crypto from "node:crypto";
import { prisma } from "./prisma.js";
import { writeAuditLog } from "./audit.js";
import { extendAfterPayment } from "./access.js";

const API = "https://api.paystack.co";

export const paystackConfigured = () => Boolean(process.env.PAYSTACK_SECRET_KEY);

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not set");
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init?.headers } });
  const body = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: T };
  if (!res.ok || !body.status) throw new Error(`Paystack: ${body.message ?? res.status}`);
  return body.data as T;
}

/** Reference carries the invoice id so a confirmation can find its invoice. */
export const referenceFor = (invoiceId: string) => `HF-${invoiceId}-${Date.now().toString(36)}`;
export const invoiceIdFrom = (ref: string) => /^HF-(.+)-[a-z0-9]+$/.exec(ref)?.[1] ?? null;

export async function startPayment(invoice: { id: string; totalGhs: number; invoiceNumber: string; facilityId: string }, email: string) {
  const reference = referenceFor(invoice.id);
  const data = await call<{ authorization_url: string }>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email,
      amount: Math.round(invoice.totalGhs * 100),
      currency: "GHS",
      reference,
      callback_url: `${process.env.WEB_ORIGIN ?? ""}/billing?reference=${reference}`,
      metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, facilityId: invoice.facilityId },
    }),
  });
  return { url: data.authorization_url, reference };
}

const METHOD: Record<string, "CARD" | "MOBILE_MONEY" | "BANK_TRANSFER" | "OTHER"> = { card: "CARD", mobile_money: "MOBILE_MONEY", bank: "BANK_TRANSFER", bank_transfer: "BANK_TRANSFER", ussd: "OTHER", qr: "OTHER" };

export type Settled = { state: "paid" | "pending" | "failed" | "unknown"; invoiceNumber?: string };

/** Asks Paystack what happened to a reference and, if it succeeded for the right amount, marks the invoice paid. Safe to call twice. */
export async function settleReference(reference: string): Promise<Settled> {
  const invoiceId = invoiceIdFrom(reference);
  if (!invoiceId) return { state: "unknown" };
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return { state: "unknown" };
  if (invoice.status === "PAID") return { state: "paid", invoiceNumber: invoice.invoiceNumber };
  const tx = await call<{ status: string; amount: number; currency: string; channel: string; reference: string }>(`/transaction/verify/${encodeURIComponent(reference)}`);
  if (tx.status !== "success") return { state: tx.status === "failed" || tx.status === "abandoned" ? "failed" : "pending", invoiceNumber: invoice.invoiceNumber };
  if (tx.currency !== "GHS" || tx.amount !== Math.round(invoice.totalGhs * 100)) {
    await writeAuditLog({ facilityId: invoice.facilityId, action: "payment_mismatch", entityType: "Invoice", entityId: invoice.id, summary: `Paystack reported a payment for invoice ${invoice.invoiceNumber} that does not match the invoice (${tx.currency} ${(tx.amount / 100).toFixed(2)}, reference ${reference}). The invoice was left open for PS Tech to check.` });
    return { state: "pending", invoiceNumber: invoice.invoiceNumber };
  }
  const done = await prisma.invoice.updateMany({ where: { id: invoice.id, status: { not: "PAID" } }, data: { status: "PAID", paidAt: new Date(), paymentMethod: METHOD[tx.channel] ?? "OTHER", paymentReference: reference } });
  if (done.count === 1) {
    const stillOwing = await prisma.invoice.count({ where: { facilityId: invoice.facilityId, OR: [{ status: "OVERDUE" }, { status: "ISSUED", dueAt: { lt: new Date() } }] } });
    if (stillOwing === 0) await prisma.subscription.updateMany({ where: { facilityId: invoice.facilityId, status: "PAST_DUE" }, data: { status: "ACTIVE" } });
    await extendAfterPayment(invoice.facilityId);
    await writeAuditLog({ facilityId: invoice.facilityId, action: "payment_received", entityType: "Invoice", entityId: invoice.id, summary: `Invoice ${invoice.invoiceNumber} was paid (GHS ${invoice.totalGhs.toFixed(2)}, ${(METHOD[tx.channel] ?? "OTHER").replace(/_/g, " ").toLowerCase()} through Paystack, reference ${reference}).` });
  }
  return { state: "paid", invoiceNumber: invoice.invoiceNumber };
}

/** Paystack signs the raw body with the secret key (HMAC SHA-512). */
export function validSignature(raw: Buffer | undefined, signature: string | undefined): boolean {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || !raw || !signature) return false;
  const want = crypto.createHmac("sha512", key).update(raw).digest("hex");
  const a = Buffer.from(want);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
