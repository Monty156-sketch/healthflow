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

/**
 * Duties to add to (positive) or take off (negative) each person's share when
 * a roster is built: what they owe less what they are owed, held to the
 * facility's monthly limit so one month is never swamped.
 */
export async function settlementFor(facilityId: string): Promise<Record<string, number>> {
  await expireLedger(facilityId);
  const [{ maxSettlementPerMonth: cap }, balances] = await Promise.all([
    prisma.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { maxSettlementPerMonth: true } }),
    openBalances(facilityId),
  ]);
  const out: Record<string, number> = {};
  for (const [id, b] of balances) {
    const net = Math.max(-cap, Math.min(cap, b.owes - b.owed));
    if (net !== 0) out[id] = net;
  }
  return out;
}

/**
 * When a roster is published, debts are settled against what people actually
 * got: a person who owes and worked more than their cadre's average settles
 * that many duties, oldest first, and the matching credits settle with them.
 * Runs once per roster. Returns the number of duties settled.
 */
export async function settleAgainstRoster(facilityId: string, rosterId: string, by: string): Promise<number> {
  if (await prisma.auditLog.findFirst({ where: { facilityId, action: "ledger_roster_settled", entityId: rosterId }, select: { id: true } })) return 0;
  const [{ maxSettlementPerMonth: cap }, staff, counts] = await Promise.all([
    prisma.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { maxSettlementPerMonth: true } }),
    prisma.staff.findMany({ where: { facilityId, status: "ACTIVE" }, select: { id: true, cadreId: true } }),
    prisma.rosterAssignment.groupBy({ by: ["staffId"], where: { rosterId, shift: { countsAsDuty: true } }, _count: { _all: true } }),
  ]);
  const count = new Map(counts.map((c) => [c.staffId, c._count._all]));
  let total = 0;
  for (const s of staff) {
    const peers = staff.filter((p) => p.cadreId === s.cadreId);
    const average = peers.reduce((n, p) => n + (count.get(p.id) ?? 0), 0) / Math.max(1, peers.length);
    let room = Math.min(cap, Math.max(0, Math.round((count.get(s.id) ?? 0) - average)));
    if (room === 0) continue;
    const debts = await prisma.dutyLedgerEntry.findMany({ where: { facilityId, staffId: s.id, entryType: "DEBT", status: { in: ["OPEN", "PARTLY_SETTLED"] } }, orderBy: { createdAt: "asc" } });
    for (const d of debts) {
      if (room === 0) break;
      const take = Math.min(room, d.duties - d.dutiesSettled);
      const twin = await twinOf(d);
      for (const row of [d, twin]) {
        if (!row) continue;
        const settled = row.dutiesSettled + take;
        await prisma.dutyLedgerEntry.update({ where: { id: row.id }, data: { dutiesSettled: settled, status: settled >= row.duties ? "SETTLED" : "PARTLY_SETTLED" } });
      }
      room -= take;
      total += take;
    }
  }
  await prisma.auditLog.create({
    data: { facilityId, actorEmail: by, action: "ledger_roster_settled", entityType: "Roster", entityId: rosterId, summary: total ? `Publishing the roster settled ${total} ${total === 1 ? "duty" : "duties"} on the duty ledger, against the extra duties people worked.` : "Publishing the roster settled nothing on the duty ledger." },
  });
  return total;
}
