// Cover for an absence, and the duty ledger it feeds.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { allowRoles, caller, READ_ROLES, ADMIN_ROLES } from "../../middleware/facilityAccess.js";
import { assignCover, CoverError, coverOptions, respondToCover, syncCover } from "../../lib/cover.js";
import { expireLedger, openBalances, twinOf, writePair } from "../../lib/ledger.js";

export const coverRouter = Router();
export const ledgerRouter = Router();

const DAY = 86_400_000;

function fail(res: import("express").Response, err: unknown) {
  if (err instanceof CoverError) return res.status(err.status).json({ error: err.status === 404 ? "not_found" : "cover_failed", message: err.message, reasons: err.reasons });
  throw err;
}

// ------------------------------------------------------------- cover

coverRouter.get("/options", allowRoles(...READ_ROLES), async (req, res) => {
  const q = z.object({ assignmentId: z.string() }).safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "invalid_input" });
  try {
    res.json(await coverOptions(caller(req).facilityId, q.data.assignmentId));
  } catch (e) {
    fail(res, e);
  }
});

const assignInput = z.object({ assignmentId: z.string(), proposalId: z.string(), owedBack: z.boolean().default(false) });

coverRouter.post("/assign", allowRoles(...READ_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(assignInput, req.body, res);
  if (!input) return;
  try {
    const out = await assignCover(who.facilityId, input.assignmentId, input.proposalId, { email: who.email, displayName: who.displayName }, input.owedBack);
    res.json({ ok: true, warnings: out.warnings });
  } catch (e) {
    fail(res, e);
  }
});

const respondInput = z.object({ accept: z.boolean(), reason: z.string().trim().max(300).optional().default("") });

/** The person asked to cover answers: yes, or no with a reason. */
coverRouter.post("/:assignmentId/respond", async (req, res) => {
  const who = caller(req);
  const input = parseOr400(respondInput, req.body, res);
  if (!input) return;
  if (!who.staffId) return res.status(403).json({ error: "forbidden", message: "Your account is not linked to a staff record." });
  try {
    res.json(await respondToCover(who.facilityId, String(req.params.assignmentId), who.staffId, input.accept, input.reason, { email: who.email, displayName: who.displayName }));
  } catch (e) {
    fail(res, e);
  }
});

/** Cover waiting on an answer: your own, or for the in-charge, everyone's. */
coverRouter.get("/awaiting", async (req, res) => {
  const who = caller(req);
  await syncCover(who.facilityId);
  const decider = READ_ROLES.includes(who.role);
  if (!decider && !who.staffId) return res.json({ cover: [] });
  const rows = await prisma.rosterAssignment.findMany({
    where: { facilityId: who.facilityId, isCover: true, acknowledgementState: { in: ["AWAITING", "ESCALATED"] }, dutyDate: { gte: new Date(Math.floor(Date.now() / DAY) * DAY) }, roster: { status: "PUBLISHED" }, ...(decider ? {} : { staffId: who.staffId! }) },
    include: { shift: true, staff: { select: { fullName: true } } }, orderBy: { dutyDate: "asc" },
  });
  const away = await prisma.staff.findMany({ where: { id: { in: rows.map((r) => r.coverForStaffId).filter(Boolean) as string[] } }, select: { id: true, fullName: true } });
  const name = new Map(away.map((a) => [a.id, a.fullName]));
  res.json({
    cover: rows.map((r) => ({
      assignmentId: r.id, date: r.dutyDate.toISOString().slice(0, 10), shift: r.shift.name, startTime: r.shift.startTime, staffId: r.staffId, coverName: r.staff.fullName,
      forName: r.coverForStaffId ? (name.get(r.coverForStaffId) ?? null) : null, state: r.acknowledgementState, notifiedAt: r.notifiedAt, mine: r.staffId === who.staffId,
    })),
  });
});

// ------------------------------------------------------------- ledger

ledgerRouter.use(allowRoles(...READ_ROLES));

ledgerRouter.get("/", async (req, res) => {
  const { facilityId } = caller(req);
  await expireLedger(facilityId);
  const [people, balances, entries] = await Promise.all([
    prisma.staff.findMany({ where: { facilityId, status: "ACTIVE" }, select: { id: true, fullName: true, cadre: { select: { name: true } } }, orderBy: { fullName: "asc" } }),
    openBalances(facilityId),
    prisma.dutyLedgerEntry.findMany({
      where: { facilityId }, orderBy: { createdAt: "desc" }, take: 150,
      include: { staff: { select: { fullName: true } }, counterpartyStaff: { select: { fullName: true } } },
    }),
  ]);
  let debts = 0;
  let credits = 0;
  for (const b of balances.values()) {
    debts += b.owes;
    credits += b.owed;
  }
  res.json({
    summary: { openDebts: debts, openCredits: credits, balanced: debts === credits, line: `Open debts ${debts} ${debts === 1 ? "duty" : "duties"} · open credits ${credits} ${credits === 1 ? "duty" : "duties"} · ${debts === credits ? "balanced" : "does not balance"}` },
    people: people.map((p) => ({ staffId: p.id, name: p.fullName, cadre: p.cadre?.name ?? null, owes: balances.get(p.id)?.owes ?? 0, owed: balances.get(p.id)?.owed ?? 0 })).filter((p) => p.owes > 0 || p.owed > 0),
    staff: people.map((p) => ({ id: p.id, name: p.fullName })),
    entries: entries.map((e) => ({
      id: e.id, staffId: e.staffId, staffName: e.staff.fullName, type: e.entryType, duties: e.duties, settled: e.dutiesSettled, status: e.status, reason: e.reason, description: e.description,
      counterparty: e.counterpartyStaff?.fullName ?? null, createdAt: e.createdAt, expiresAt: e.expiresAt, writtenOffReason: e.writtenOffReason,
    })),
  });
});

const adjustInput = z.object({
  debtorId: z.string(),
  creditorId: z.string(),
  duties: z.number().int().min(1).max(30),
  note: z.string().trim().min(10, "Say why, in a sentence.").max(300),
});

ledgerRouter.post("/adjust", async (req, res) => {
  const who = caller(req);
  const input = parseOr400(adjustInput, req.body, res);
  if (!input) return;
  if (input.debtorId === input.creditorId) return res.status(400).json({ error: "invalid_input", fields: { creditorId: "Choose two different people." } });
  const people = await prisma.staff.findMany({ where: { facilityId: who.facilityId, id: { in: [input.debtorId, input.creditorId] } }, select: { id: true, fullName: true } });
  if (people.length !== 2) return res.status(404).json({ error: "not_found" });
  const name = (id: string) => people.find((p) => p.id === id)!.fullName;
  await writePair({ facilityId: who.facilityId, debtorId: input.debtorId, creditorId: input.creditorId, duties: input.duties, reason: "MANUAL_ADJUSTMENT", description: input.note });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "ledger_adjusted", entityType: "DutyLedgerEntry", entityId: input.debtorId,
    summary: `${who.displayName} recorded that ${name(input.debtorId)} owes ${name(input.creditorId)} ${input.duties} ${input.duties === 1 ? "duty" : "duties"}. ${input.note}`,
    reason: input.note,
  });
  res.status(201).json({ ok: true });
});

const settleInput = z.object({ duties: z.number().int().min(1).max(30).default(1) });

/** A duty has been worked back: settle both sides of the pair. */
ledgerRouter.post("/entries/:id/settle", async (req, res) => {
  const who = caller(req);
  const input = parseOr400(settleInput, req.body, res);
  if (!input) return;
  const e = await prisma.dutyLedgerEntry.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId }, include: { staff: { select: { fullName: true } } } });
  if (!e) return res.status(404).json({ error: "not_found" });
  if (!["OPEN", "PARTLY_SETTLED"].includes(e.status)) return res.status(409).json({ error: "closed", message: "This entry is already closed." });
  const left = e.duties - e.dutiesSettled;
  if (input.duties > left) return res.status(400).json({ error: "invalid_input", message: `Only ${left} ${left === 1 ? "duty is" : "duties are"} left on this entry.` });
  const twin = await twinOf(e);
  for (const row of [e, twin]) {
    if (!row) continue;
    const settled = row.dutiesSettled + input.duties;
    await prisma.dutyLedgerEntry.update({ where: { id: row.id }, data: { dutiesSettled: settled, status: settled >= row.duties ? "SETTLED" : "PARTLY_SETTLED" } });
  }
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "ledger_settled", entityType: "DutyLedgerEntry", entityId: e.id,
    summary: `${who.displayName} settled ${input.duties} ${input.duties === 1 ? "duty" : "duties"} on ${e.staff.fullName}'s ${e.entryType === "DEBT" ? "debt" : "credit"} (${e.description ?? "no description"}).`,
  });
  res.json({ ok: true });
});

const writeOffInput = z.object({ reason: z.string().trim().min(10, "Say why, in a sentence.").max(300) });

/** Wipes a pair. Needs the facility admin and a reason, and both sides go together. */
ledgerRouter.post("/entries/:id/write-off", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(writeOffInput, req.body, res);
  if (!input) return;
  const e = await prisma.dutyLedgerEntry.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId }, include: { staff: { select: { fullName: true } } } });
  if (!e) return res.status(404).json({ error: "not_found" });
  if (!["OPEN", "PARTLY_SETTLED"].includes(e.status)) return res.status(409).json({ error: "closed", message: "This entry is already closed." });
  const twin = await twinOf(e);
  for (const row of [e, twin]) {
    if (row) await prisma.dutyLedgerEntry.update({ where: { id: row.id }, data: { status: "WRITTEN_OFF", writtenOffBy: who.email, writtenOffReason: input.reason } });
  }
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "ledger_written_off", entityType: "DutyLedgerEntry", entityId: e.id,
    summary: `${who.displayName} wrote off ${e.duties - e.dutiesSettled} ${e.duties - e.dutiesSettled === 1 ? "duty" : "duties"} on ${e.staff.fullName}'s ${e.entryType === "DEBT" ? "debt" : "credit"}, with its matching side. Reason: ${input.reason}`,
    reason: input.reason,
  });
  res.json({ ok: true });
});

