// The duty ledger. Every movement is a matched pair: when A hands a duty to B,
// A owes one and B is owed one, each naming the other. The two sides always
// balance, so the whole ledger can be checked at a glance. Entries lapse after
// the facility's expiry period and are never deleted.
import type { LedgerReason, Prisma } from "@healthflow/db";
import { prisma } from "./prisma.js";

export interface PairInput {
  facilityId: string;
  debtorId: string;
  creditorId: string;
  duties: number;
  reason: LedgerReason;
  description: string;
  leaveRequestId?: string;
  swapId?: string;
}

/** Writes both sides of one movement. Returns the two entry ids. */
export async function writePair(p: PairInput, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  if (p.debtorId === p.creditorId || p.duties < 1) return null;
  const facility = await tx.facility.findUniqueOrThrow({ where: { id: p.facilityId }, select: { ledgerExpiryMonths: true } });
  const expiresAt = new Date();
  expiresAt.setUTCMonth(expiresAt.getUTCMonth() + facility.ledgerExpiryMonths);
  const common = { facilityId: p.facilityId, duties: p.duties, reason: p.reason, description: p.description, relatedLeaveRequestId: p.leaveRequestId ?? null, relatedSwapId: p.swapId ?? null, expiresAt };
  const debt = await tx.dutyLedgerEntry.create({ data: { ...common, staffId: p.debtorId, entryType: "DEBT", counterpartyStaffId: p.creditorId } });
  const credit = await tx.dutyLedgerEntry.create({ data: { ...common, staffId: p.creditorId, entryType: "CREDIT", counterpartyStaffId: p.debtorId } });
  return { debt: debt.id, credit: credit.id };
}

/** Lapses entries past their expiry. Called whenever the ledger is read. */
export async function expireLedger(facilityId: string) {
  await prisma.dutyLedgerEntry.updateMany({ where: { facilityId, status: { in: ["OPEN", "PARTLY_SETTLED"] }, expiresAt: { lt: new Date() } }, data: { status: "EXPIRED" } });
}

/** Open duties owed and owed back, per person. Positive balance means they owe. */
export async function openBalances(facilityId: string) {
  const rows = await prisma.dutyLedgerEntry.findMany({ where: { facilityId, status: { in: ["OPEN", "PARTLY_SETTLED"] } }, select: { staffId: true, entryType: true, duties: true, dutiesSettled: true } });
  const out = new Map<string, { owes: number; owed: number }>();
  for (const r of rows) {
    const b = out.get(r.staffId) ?? { owes: 0, owed: 0 };
    const left = r.duties - r.dutiesSettled;
    if (r.entryType === "DEBT") b.owes += left;
    else b.owed += left;
    out.set(r.staffId, b);
  }
  return out;
}

/** The other side of an entry: same movement, opposite person. */
export async function twinOf(e: { id: string; facilityId: string; staffId: string; counterpartyStaffId: string | null; entryType: "DEBT" | "CREDIT"; reason: LedgerReason; createdAt: Date; duties: number }) {
  if (!e.counterpartyStaffId) return null;
  return prisma.dutyLedgerEntry.findFirst({
    where: { facilityId: e.facilityId, id: { not: e.id }, staffId: e.counterpartyStaffId, counterpartyStaffId: e.staffId, entryType: e.entryType === "DEBT" ? "CREDIT" : "DEBT", reason: e.reason, duties: e.duties, createdAt: { gte: new Date(e.createdAt.getTime() - 5000), lte: new Date(e.createdAt.getTime() + 5000) } },
  });
}
