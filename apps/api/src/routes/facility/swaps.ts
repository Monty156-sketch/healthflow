// Duty swaps (Part 5, 5.5; Part 2, 2.4).
//   Exchange: both people have a duty and they trade.
//   Handover: the other person is free and takes the duty on.
// A swap is checked when it is asked for, offered only if lawful, and checked
// AGAIN, completely, from current data at the moment it is approved. Nothing
// is cached: between asking and approving, leave may have been approved, the
// roster regenerated or the person moved.
import { Router } from "express";
import { z } from "zod";
import type { Prisma, SwapStatus } from "@healthflow/db";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { detachAttendance, relinkAttendance } from "../../lib/attendanceReview.js";
import { notifyDeciders, notifyStaff } from "../../lib/notify.js";
import { writePair } from "../../lib/ledger.js";
import { allowRoles, caller, READ_ROLES } from "../../middleware/facilityAccess.js";
import { sayDay } from "../../engine/time.js";
import { checkOf, findingKey, loadEngineData, monthName, saveVersion, storeFindings, type Data } from "./rosters.js";

export const swapsRouter = Router();

const DAY = 86_400_000;
const dayOf = (d: Date) => Math.floor(d.getTime() / DAY);
const dateOf = (n: number) => new Date(n * DAY);
const isoOf = (n: number) => dateOf(n).toISOString().slice(0, 10);

export interface Spec {
  rosterId: string;
  requesterStaffId: string;
  requesterAssignmentId: string;
  targetStaffId: string;
  targetAssignmentId: string | null;
}
export interface Outcome {
  ok: boolean; // false when something stops the swap outright
  hard: string[]; // reasons it cannot go ahead, in plain words
  warnings: string[]; // things to read and confirm
  type: "EXCHANGE" | "HANDOVER";
  /** The new state of the two duties, for applying. */
  plan?: { aId: string; aToStaff: string; bId: string | null; bToStaff: string | null; dayA: number; dayB: number | null };
  summary?: { requester: string; target: string; give: string; take: string | null };
}

const MIN_SWAP_NOTE = 10;

/** Everything about whether this swap is lawful, from the database as it is now. */
export async function evaluateSwap(facilityId: string, spec: Spec, opts: { enforceCutoff: boolean; ignoreStart?: boolean }): Promise<Outcome> {
  const type = spec.targetAssignmentId ? "EXCHANGE" : "HANDOVER";
  const bad = (reason: string): Outcome => ({ ok: false, hard: [reason], warnings: [], type });

  const roster = await prisma.roster.findFirst({ where: { id: spec.rosterId, facilityId } });
  if (!roster) return bad("The roster for this swap no longer exists.");
  if (roster.status !== "PUBLISHED") return bad(`The ${monthName(roster)} roster is not published, so duties on it cannot be swapped.`);

  const a = await prisma.rosterAssignment.findFirst({ where: { id: spec.requesterAssignmentId, rosterId: roster.id }, include: { shift: true } });
  if (!a || a.staffId !== spec.requesterStaffId) {
    return bad("The duty being given away is no longer on the roster as it was when this was asked for. The roster has changed under it.");
  }
  const b = spec.targetAssignmentId ? await prisma.rosterAssignment.findFirst({ where: { id: spec.targetAssignmentId, rosterId: roster.id }, include: { shift: true } }) : null;
  if (spec.targetAssignmentId && (!b || b.staffId !== spec.targetStaffId)) {
    return bad("The other person's duty is no longer on the roster as it was when this was asked for. The roster has changed under it.");
  }
  const dayA = dayOf(a.dutyDate);
  const dayB = b ? dayOf(b.dutyDate) : null;

  const data = await loadEngineData(facilityId, roster.id, roster.year, roster.month);
  const req = data.staff.find((s) => s.id === spec.requesterStaffId);
  const tgt = data.staff.find((s) => s.id === spec.targetStaffId);
  if (!req) return bad("The person asking is no longer an active member of staff.");
  if (!tgt) return bad("The other person is no longer an active member of staff.");
  if (req.id === tgt.id) return bad("A duty cannot be swapped with yourself.");

  const hard: string[] = [];
  const now = Date.now();
  const cutoff = (await prisma.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { swapCutoffHours: true } })).swapCutoffHours;
  const start = (day: number, hhmm: string | null) => day * DAY + (hhmm ? (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))) * 60_000 : 0);
  const early = (day: number, hhmm: string | null, who: string) => {
    if (opts.ignoreStart) return; // cover for an absence can be found after the shift has begun
    const at = start(day, hhmm);
    if (at <= now) hard.push(`${who}'s duty on ${sayDay(day)} has already started or passed.`);
    else if (opts.enforceCutoff && at - now < cutoff * 3_600_000) hard.push(`${who}'s duty on ${sayDay(day)} is less than ${cutoff} hours away. Swaps close ${cutoff} hours before a duty starts.`);
  };
  early(dayA, a.shift.startTime, req.name);
  if (b && dayB !== null) early(dayB, b.shift.startTime, tgt.name);

  const onLeave = (staffId: string, day: number) => data.leave.some((l) => l.staffId === staffId && day >= l.startDay && day <= l.endDay);
  const can = (s: typeof tgt, shift: typeof a.shift, day: number) => {
    if (onLeave(s.id, day)) hard.push(`${s.name} is on approved leave on ${sayDay(day)}.`);
    if (shift.eligibleCadreIds.length > 0 && (!s.cadreId || !shift.eligibleCadreIds.includes(s.cadreId))) hard.push(`${s.name}'s cadre is not eligible for the ${shift.name} shift.`);
    if (s.eligibleShiftIds.length > 0 && !s.eligibleShiftIds.includes(shift.id)) hard.push(`${s.name} is not set up for the ${shift.name} shift.`);
    if (shift.name.toLowerCase().includes("night") || shift.isOvernight) {
      if (s.excludedFromNights) hard.push(`${s.name} is excluded from night duty.`);
    }
  };
  can(tgt, a.shift, dayA);
  if (b && dayB !== null) can(req, b.shift, dayB);

  // The target must be free on the day they receive: a handover needs no duty
  // that day; an exchange on a different day needs none on the requester's day.
  const dutyIds = new Set(data.shifts.filter((s) => s.countsAsDuty).map((s) => s.id));
  const tgtBusy = data.current.find((x) => x.staffId === tgt.id && x.day === dayA && dutyIds.has(x.shiftId));
  if (tgtBusy && !(b && dayB === dayA)) hard.push(`${tgt.name} already has a duty on ${sayDay(dayA)}.`);
  if (b && dayB !== null) {
    const reqBusy = data.current.find((x) => x.staffId === req.id && x.day === dayB && dutyIds.has(x.shiftId));
    if (reqBusy && dayB !== dayA) hard.push(`${req.name} already has a duty on ${sayDay(dayB)}.`);
  }

  // Compliance, before against after. Only what the swap newly causes counts.
  const before = checkOf(data, data.current);
  const had = new Set(before.map((f) => findingKey(f)));
  const next = swapped(data, spec, dayA, dayB, a.shiftId, b?.shiftId ?? null);
  const after = checkOf(data, next);
  for (const f of after) {
    if (had.has(findingKey(f))) continue;
    if (f.staffId !== req.id && f.staffId !== tgt.id) continue;
    if (f.severity === "BLOCK") hard.push(f.message);
  }
  const warnings = after.filter((f) => f.severity === "WARN" && !had.has(findingKey(f)) && (f.staffId === req.id || f.staffId === tgt.id)).map((f) => f.message);

  return {
    ok: hard.length === 0,
    hard: [...new Set(hard)],
    warnings: [...new Set(warnings)],
    type,
    plan: { aId: a.id, aToStaff: tgt.id, bId: b?.id ?? null, bToStaff: b ? req.id : null, dayA, dayB },
    summary: { requester: req.name, target: tgt.name, give: `${a.shift.name} on ${sayDay(dayA)}`, take: b && dayB !== null ? `${b.shift.name} on ${sayDay(dayB)}` : null },
  };
}

function swapped(data: Data, spec: Spec, dayA: number, dayB: number | null, shiftA: string, shiftB: string | null) {
  const drop = (staffId: string, day: number) => (x: { staffId: string; day: number }) => !(x.staffId === staffId && x.day === day);
  let cur = data.current.filter(drop(spec.requesterStaffId, dayA)).filter(drop(spec.targetStaffId, dayA));
  if (dayB !== null) cur = cur.filter(drop(spec.targetStaffId, dayB)).filter(drop(spec.requesterStaffId, dayB));
  cur = [...cur, { staffId: spec.targetStaffId, shiftId: shiftA, day: dayA, locked: true }];
  if (dayB !== null && shiftB) cur.push({ staffId: spec.requesterStaffId, shiftId: shiftB, day: dayB, locked: true });
  return cur;
}

// ------------------------------------------------------------- what can I swap with

/** Colleagues who could take this duty lawfully, and colleagues to trade with. */
swapsRouter.get("/candidates", async (req, res) => {
  const who = caller(req);
  if (!who.staffId) return res.status(403).json({ error: "forbidden", message: "Your account is not linked to a staff record." });
  const q = z.object({ assignmentId: z.string(), withStaffId: z.string().optional() }).safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "invalid_input" });
  const mine = await prisma.rosterAssignment.findFirst({
    where: { id: q.data.assignmentId, staffId: who.staffId, facilityId: who.facilityId, roster: { status: "PUBLISHED" }, shift: { countsAsDuty: true } },
    include: { shift: true, roster: true },
  });
  if (!mine) return res.status(404).json({ error: "not_found" });
  const mineDay = dayOf(mine.dutyDate);

  const colleagues = await prisma.staff.findMany({
    where: { facilityId: who.facilityId, status: "ACTIVE", id: { not: who.staffId } },
    select: { id: true, fullName: true, cadre: { select: { name: true } } }, orderBy: { fullName: "asc" },
  });

  if (q.data.withStaffId) {
    // That colleague's own coming duties, each checked as a trade.
    const theirs = await prisma.rosterAssignment.findMany({
      where: { rosterId: mine.rosterId, staffId: q.data.withStaffId, shift: { countsAsDuty: true }, dutyDate: { gt: new Date() } },
      include: { shift: true }, orderBy: { dutyDate: "asc" },
    });
    const out = [];
    for (const t of theirs.slice(0, 31)) {
      const o = await evaluateSwap(who.facilityId, { rosterId: mine.rosterId, requesterStaffId: who.staffId, requesterAssignmentId: mine.id, targetStaffId: q.data.withStaffId, targetAssignmentId: t.id }, { enforceCutoff: true });
      out.push({ assignmentId: t.id, date: isoOf(dayOf(t.dutyDate)), shift: t.shift.name, lawful: o.ok, why: o.ok ? null : o.hard[0], warnings: o.warnings });
    }
    return res.json({ duties: out });
  }

  const lawful = [];
  for (const c of colleagues) {
    const o = await evaluateSwap(who.facilityId, { rosterId: mine.rosterId, requesterStaffId: who.staffId, requesterAssignmentId: mine.id, targetStaffId: c.id, targetAssignmentId: null }, { enforceCutoff: true });
    if (o.ok) lawful.push({ staffId: c.id, name: c.fullName, cadre: c.cadre?.name ?? null, warnings: o.warnings });
  }
  res.json({ duty: { id: mine.id, date: isoOf(mineDay), shift: mine.shift.name }, handover: lawful, colleagues: colleagues.map((c) => ({ staffId: c.id, name: c.fullName, cadre: c.cadre?.name ?? null })) });
});

// ------------------------------------------------------------- present

const include = {
  requesterStaff: { select: { fullName: true } },
  targetStaff: { select: { fullName: true } },
  roster: { select: { month: true, year: true } },
} satisfies Prisma.DutySwapInclude;
type Row = Prisma.DutySwapGetPayload<{ include: typeof include }>;

async function present(rows: Row[]) {
  const ids = rows.flatMap((r) => [r.requesterAssignmentId, r.targetAssignmentId].filter(Boolean) as string[]);
  const as = await prisma.rosterAssignment.findMany({ where: { id: { in: ids } }, include: { shift: true } });
  const by = new Map(as.map((a) => [a.id, a]));
  return rows.map((r) => {
    const a = by.get(r.requesterAssignmentId);
    const b = r.targetAssignmentId ? by.get(r.targetAssignmentId) : undefined;
    return {
      id: r.id, type: r.swapType, status: r.status, reason: r.reason, responseNote: r.responseNote, decisionNote: r.decisionNote, decidedBy: r.decidedBy,
      requesterId: r.requesterStaffId, requester: r.requesterStaff.fullName, targetId: r.targetStaffId, target: r.targetStaff.fullName,
      gives: a ? { date: isoOf(dayOf(a.dutyDate)), shift: a.shift.name } : null,
      takes: b ? { date: isoOf(dayOf(b.dutyDate)), shift: b.shift.name } : null,
      month: monthName(r.roster),
    };
  });
}

/** A swap nobody finished before the duty date is closed, and both people told. */
async function expireOld(facilityId: string) {
  const open = await prisma.dutySwap.findMany({ where: { facilityId, status: { in: ["REQUESTED", "ACCEPTED"] } }, include });
  if (open.length === 0) return;
  const as = await prisma.rosterAssignment.findMany({ where: { id: { in: open.map((o) => o.requesterAssignmentId) } }, select: { id: true, dutyDate: true } });
  const date = new Map(as.map((a) => [a.id, a.dutyDate.getTime()]));
  for (const s of open) {
    const at = date.get(s.requesterAssignmentId);
    if (at !== undefined && at > Date.now() - DAY) continue;
    await prisma.dutySwap.update({ where: { id: s.id }, data: { status: "EXPIRED" } });
    const note = { type: "swap_expired", title: "A duty swap expired", body: `The swap between ${s.requesterStaff.fullName} and ${s.targetStaff.fullName} was not finished before the duty date.`, linkUrl: "/swaps" };
    await notifyStaff(facilityId, s.requesterStaffId, note);
    await notifyStaff(facilityId, s.targetStaffId, note);
  }
}

swapsRouter.get("/", async (req, res) => {
  const who = caller(req);
  await expireOld(who.facilityId);
  const decider = READ_ROLES.includes(who.role);
  const [rows] = await Promise.all([
    prisma.dutySwap.findMany({
      where: { facilityId: who.facilityId, ...(decider ? {} : { OR: [{ requesterStaffId: who.staffId ?? "none" }, { targetStaffId: who.staffId ?? "none" }] }) },
      include, orderBy: { id: "desc" }, take: 200,
    }),
  ]);
  res.json({ myStaffId: who.staffId, decider, swaps: await present(rows) });
});

swapsRouter.get("/:id", async (req, res) => {
  const who = caller(req);
  const row = await prisma.dutySwap.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId }, include });
  if (!row) return res.status(404).json({ error: "not_found" });
  const decider = READ_ROLES.includes(who.role);
  if (!decider && row.requesterStaffId !== who.staffId && row.targetStaffId !== who.staffId) return res.status(404).json({ error: "not_found" });
  // Worked out again every time this is opened, never read back from when it was asked.
  const check = ["REQUESTED", "ACCEPTED"].includes(row.status)
    ? await evaluateSwap(who.facilityId, { rosterId: row.rosterId, requesterStaffId: row.requesterStaffId, requesterAssignmentId: row.requesterAssignmentId, targetStaffId: row.targetStaffId, targetAssignmentId: row.targetAssignmentId }, { enforceCutoff: false })
    : null;
  res.json({ swap: (await present([row]))[0], check: check && { ok: check.ok, hard: check.hard, warnings: check.warnings } });
});

// ------------------------------------------------------------- ask

const askInput = z.object({
  assignmentId: z.string(),
  targetStaffId: z.string(),
  targetAssignmentId: z.string().nullish(),
  reason: z.string().trim().max(300).optional().default(""),
});

swapsRouter.post("/", async (req, res) => {
  const who = caller(req);
  const input = parseOr400(askInput, req.body, res);
  if (!input) return;
  if (!who.staffId) return res.status(403).json({ error: "forbidden", message: "Your account is not linked to a staff record." });
  const mine = await prisma.rosterAssignment.findFirst({ where: { id: input.assignmentId, staffId: who.staffId, facilityId: who.facilityId } });
  if (!mine) return res.status(404).json({ error: "not_found" });
  const spec: Spec = { rosterId: mine.rosterId, requesterStaffId: who.staffId, requesterAssignmentId: mine.id, targetStaffId: input.targetStaffId, targetAssignmentId: input.targetAssignmentId ?? null };
  const dup = await prisma.dutySwap.findFirst({ where: { requesterAssignmentId: mine.id, status: { in: ["REQUESTED", "ACCEPTED"] } } });
  if (dup) return res.status(409).json({ error: "already_asked", message: "You already have a swap open for this duty. Cancel it first." });
  const o = await evaluateSwap(who.facilityId, spec, { enforceCutoff: true });
  if (!o.ok) return res.status(409).json({ error: "not_lawful", message: o.hard[0], reasons: o.hard });
  const swap = await prisma.dutySwap.create({
    data: {
      facilityId: who.facilityId, rosterId: mine.rosterId, swapType: o.type, requesterStaffId: who.staffId, requesterAssignmentId: mine.id,
      targetStaffId: input.targetStaffId, targetAssignmentId: input.targetAssignmentId ?? null, reason: input.reason || null,
      revalidationResult: { ok: true, warnings: o.warnings, at: new Date().toISOString() },
    },
    include,
  });
  await notifyStaff(who.facilityId, input.targetStaffId, {
    type: "swap_requested", title: `${swap.requesterStaff.fullName} asks you to ${o.type === "EXCHANGE" ? "swap duties" : "take a duty"}`,
    body: o.type === "EXCHANGE" ? `${o.summary!.give} for your ${o.summary!.take}.` : `${o.summary!.give}.`, linkUrl: "/swaps", severity: "ACTION",
  });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "swap_requested", entityType: "DutySwap", entityId: swap.id,
    summary: `${who.displayName} asked ${swap.targetStaff.fullName} to ${o.type === "EXCHANGE" ? `swap ${o.summary!.give} for ${o.summary!.take}` : `take ${o.summary!.give}`}.`,
  });
  res.status(201).json({ swap: (await present([swap]))[0], warnings: o.warnings });
});

// ------------------------------------------------------------- respond, cancel, decide

const respondInput = z.object({ accept: z.boolean(), note: z.string().trim().max(300).optional().default("") });

swapsRouter.post("/:id/respond", async (req, res) => {
  const who = caller(req);
  const input = parseOr400(respondInput, req.body, res);
  if (!input) return;
  const row = await prisma.dutySwap.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId }, include });
  if (!row || row.targetStaffId !== who.staffId) return res.status(404).json({ error: "not_found" });
  if (row.status !== "REQUESTED") return res.status(409).json({ error: "not_open", message: "This swap is no longer waiting for your answer." });
  const status: SwapStatus = input.accept ? "ACCEPTED" : "DECLINED";
  await prisma.dutySwap.update({ where: { id: row.id }, data: { status, respondedAt: new Date(), responseNote: input.note || null } });
  await notifyStaff(who.facilityId, row.requesterStaffId, {
    type: "swap_responded", title: `${row.targetStaff.fullName} ${input.accept ? "accepted" : "declined"} your swap`,
    body: input.accept ? "It now waits for your in-charge to approve." : input.note || "You can ask someone else.", linkUrl: "/swaps",
  });
  if (input.accept) {
    await notifyDeciders(who.facilityId, { type: "swap_accepted", title: "A duty swap waits for approval", body: `${row.requesterStaff.fullName} and ${row.targetStaff.fullName} agree. It is checked again when you approve.`, linkUrl: "/swaps", severity: "ACTION" });
  }
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: input.accept ? "swap_accepted" : "swap_declined", entityType: "DutySwap", entityId: row.id,
    summary: `${who.displayName} ${input.accept ? "accepted" : "declined"} the swap asked by ${row.requesterStaff.fullName}.`,
  });
  res.json({ ok: true });
});

swapsRouter.post("/:id/cancel", async (req, res) => {
  const who = caller(req);
  const row = await prisma.dutySwap.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId }, include });
  if (!row) return res.status(404).json({ error: "not_found" });
  if (row.requesterStaffId !== who.staffId && !READ_ROLES.includes(who.role)) return res.status(403).json({ error: "forbidden" });
  if (!["REQUESTED", "ACCEPTED"].includes(row.status)) return res.status(409).json({ error: "not_open", message: "This swap is already closed." });
  await prisma.dutySwap.update({ where: { id: row.id }, data: { status: "CANCELLED" } });
  await notifyStaff(who.facilityId, row.targetStaffId, { type: "swap_cancelled", title: "A duty swap was cancelled", body: `${row.requesterStaff.fullName}'s swap with you will not go ahead.`, linkUrl: "/swaps" });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "swap_cancelled", entityType: "DutySwap", entityId: row.id, summary: `${who.displayName} cancelled the swap between ${row.requesterStaff.fullName} and ${row.targetStaff.fullName}.` });
  res.json({ ok: true });
});

const decideInput = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(300).optional().default(""), confirmWarnings: z.boolean().optional().default(false) });

swapsRouter.post("/:id/decide", allowRoles(...READ_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(decideInput, req.body, res);
  if (!input) return;
  const row = await prisma.dutySwap.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId }, include });
  if (!row) return res.status(404).json({ error: "not_found" });
  if (row.status !== "ACCEPTED") return res.status(409).json({ error: "not_ready", message: "Only a swap the other person has accepted can be decided." });

  if (input.decision === "reject") {
    if (input.note.length < MIN_SWAP_NOTE) return res.status(400).json({ error: "invalid_input", fields: { note: "Say why, so both people know." } });
    await prisma.dutySwap.update({ where: { id: row.id }, data: { status: "REJECTED", decidedBy: who.email, decidedAt: new Date(), decisionNote: input.note } });
    const n = { type: "swap_decided", title: "A duty swap was not approved", body: input.note, linkUrl: "/swaps" };
    await notifyStaff(who.facilityId, row.requesterStaffId, n);
    await notifyStaff(who.facilityId, row.targetStaffId, n);
    await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "swap_rejected", entityType: "DutySwap", entityId: row.id, summary: `${who.displayName} did not approve the swap between ${row.requesterStaff.fullName} and ${row.targetStaff.fullName}. ${input.note}` });
    return res.json({ ok: true });
  }

  // Approve: check everything again, from the data as it is right now.
  const o = await evaluateSwap(who.facilityId, { rosterId: row.rosterId, requesterStaffId: row.requesterStaffId, requesterAssignmentId: row.requesterAssignmentId, targetStaffId: row.targetStaffId, targetAssignmentId: row.targetAssignmentId }, { enforceCutoff: false });
  await prisma.dutySwap.update({ where: { id: row.id }, data: { revalidationResult: { ok: o.ok, hard: o.hard, warnings: o.warnings, at: new Date().toISOString() } } });
  if (!o.ok || !o.plan) {
    return res.status(409).json({ error: "not_lawful", message: `This swap can no longer go ahead: ${o.hard[0]}`, reasons: o.hard });
  }
  if (o.warnings.length && !input.confirmWarnings) {
    return res.status(409).json({ error: "confirm_warnings", message: "The swap is lawful but causes warnings. Read them and confirm.", warnings: o.warnings });
  }

  const roster = await prisma.roster.findUniqueOrThrow({ where: { id: row.rosterId } });
  const p = o.plan;
  let loose: { name: string; date: Date }[] = [];
  await prisma.$transaction(
    async (tx) => {
      const version = roster.version + 1;
      await saveVersion(tx, roster.id, version, who.email, "Before a duty swap");
      // The person receiving the duty may have an off-duty marker that day.
      await tx.rosterAssignment.deleteMany({ where: { rosterId: roster.id, staffId: p.aToStaff, dutyDate: dateOf(p.dayA), id: { not: p.aId }, ...(p.bId ? { NOT: { id: p.bId } } : {}) } });
      if (p.bId && p.bToStaff && p.dayB !== null) {
        await tx.rosterAssignment.deleteMany({ where: { rosterId: roster.id, staffId: p.bToStaff, dutyDate: dateOf(p.dayB), id: { not: p.bId } } });
      }
      await detachAttendance(tx, { id: { in: [p.aId, ...(p.bId ? [p.bId] : [])] } });
      await tx.rosterAssignment.update({ where: { id: p.aId }, data: { staffId: p.aToStaff, source: "SWAP", locked: true } });
      if (p.bId && p.bToStaff) await tx.rosterAssignment.update({ where: { id: p.bId }, data: { staffId: p.bToStaff, source: "SWAP", locked: true } });
      loose = await relinkAttendance(tx, roster.id);
      await tx.roster.update({ where: { id: roster.id }, data: { version } });
      await tx.dutySwap.update({ where: { id: row.id }, data: { status: "APPROVED", decidedBy: who.email, decidedAt: new Date(), decisionNote: input.note || null } });
    },
    { timeout: 30_000, maxWait: 10_000 }
  );
  // Re-run the roster's own check so the findings list reflects the new duties.
  const data = await loadEngineData(who.facilityId, roster.id, roster.year, roster.month);
  const findings = checkOf(data, data.current);
  await prisma.$transaction(async (tx) => {
    await storeFindings(tx, roster.id, who.facilityId, findings);
    await tx.roster.update({ where: { id: roster.id }, data: { hasUnresolvedConflicts: findings.some((f) => f.severity === "BLOCK") } });
  });
  const s = o.summary!;
  const sentence = s.take ? `${s.requester} now works ${s.take}, and ${s.target} works ${s.give}.` : `${s.target} now works ${s.give}, instead of ${s.requester}.`;
  const n = { type: "swap_decided", title: "Your duty swap was approved", body: sentence, linkUrl: "/my-duties" };
  await notifyStaff(who.facilityId, row.requesterStaffId, n);
  await notifyStaff(who.facilityId, row.targetStaffId, n);
  void loose;
  // Giving a duty away without taking one back leaves a debt: the person who handed it over owes one.
  if (o.type === "HANDOVER") {
    await writePair({
      facilityId: who.facilityId, debtorId: row.requesterStaffId, creditorId: row.targetStaffId, duties: 1, reason: "SWAP_HANDOVER", swapId: row.id,
      description: `${row.targetStaff.fullName} took ${s.give} from ${row.requesterStaff.fullName}`,
    });
  }
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "swap_approved", entityType: "DutySwap", entityId: row.id,
    before: { requesterAssignmentId: row.requesterAssignmentId, staffId: row.requesterStaffId }, after: { staffId: row.targetStaffId },
    summary: `${who.displayName} approved a swap in the ${monthName(roster)} roster: ${sentence}${o.warnings.length ? ` Confirmed warnings: ${o.warnings.join(" ")}` : ""}`,
  });
  res.json({ ok: true, warnings: o.warnings });
});
