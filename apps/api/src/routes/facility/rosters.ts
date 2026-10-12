// Rosters (Part 3, 1.5 to 1.8): create a month, generate it, read it back
// with its findings. Generation and the rule checks live in src/engine and
// work on plain data; this file loads the data, calls them, and stores the
// result. Editing cells, review and publishing arrive with the roster
// builder.
import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@healthflow/db";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { allowRoles, caller, READ_ROLES } from "../../middleware/facilityAccess.js";
import { ensureRules } from "./rules.js";
import { ensureOffDuty } from "./shifts.js";
import { generate, type Shortfall } from "../../engine/generate.js";
import { evaluateCompliance } from "../../engine/evaluators.js";
import { dayOf, daysInMonth, isoOf, sayDay } from "../../engine/time.js";
import type { EAssignment, ECycleRule, EShift, EStaff, Finding } from "../../engine/types.js";

export const rostersRouter = Router();

const ROSTER_ROLES = ["FACILITY_ADMIN", "ROSTER_MANAGER"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dayFromDate = (d: Date) => Math.floor(d.getTime() / 86_400_000);
const dateFromDay = (day: number) => new Date(day * 86_400_000);
const monthName = (r: { month: number; year: number }) => `${MONTHS[r.month - 1]} ${r.year}`;

// ------------------------------------------------------------- loading

async function loadEngineData(facilityId: string, rosterId: string, year: number, month: number) {
  await ensureRules(facilityId);
  await ensureOffDuty(facilityId);
  const startDay = dayOf(year, month, 1);
  const period = { startDay, endDay: startDay + daysInMonth(year, month) - 1 };

  const [facility, staffRows, shiftRows, ruleRows, cycleRows, leaveRows, holidayRows, historyRows, rosterRows, cadres] = await Promise.all([
    prisma.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { weekStartsOn: true, referencePeriodWeeks: true } }),
    prisma.staff.findMany({ where: { facilityId, status: "ACTIVE" }, orderBy: { staffNo: "asc" } }),
    prisma.shift.findMany({ where: { facilityId }, include: { eligibleStaff: { select: { id: true } } }, orderBy: { sortOrder: "asc" } }),
    prisma.constraintRule.findMany({ where: { facilityId, enabled: true } }),
    prisma.dutyCycleRule.findMany({ where: { facilityId, active: true }, include: { countingShifts: { select: { id: true } } } }),
    prisma.leaveRequest.findMany({
      where: { facilityId, status: "APPROVED", startDate: { lte: dateFromDay(period.endDay) }, endDate: { gte: dateFromDay(period.startDay) } },
      select: { staffId: true, startDate: true, endDate: true },
    }),
    prisma.publicHoliday.findMany({
      where: { OR: [{ facilityId }, { facilityId: null }], date: { gte: dateFromDay(period.startDay), lte: dateFromDay(period.endDay) } },
      select: { date: true },
    }),
    prisma.rosterAssignment.findMany({
      where: { facilityId, rosterId: { not: rosterId }, dutyDate: { gte: dateFromDay(period.startDay - 90), lt: dateFromDay(period.startDay) } },
      select: { staffId: true, shiftId: true, dutyDate: true },
    }),
    prisma.rosterAssignment.findMany({ where: { rosterId }, select: { staffId: true, shiftId: true, dutyDate: true, locked: true } }),
    prisma.cadre.findMany({ where: { facilityId }, select: { id: true, name: true } }),
  ]);

  const eligibleByStaff = new Map<string, string[]>();
  for (const s of shiftRows) for (const e of s.eligibleStaff) eligibleByStaff.set(e.id, [...(eligibleByStaff.get(e.id) ?? []), s.id]);

  const staff: EStaff[] = staffRows.map((s) => ({
    id: s.id, staffNo: s.staffNo, name: s.fullName, cadreId: s.cadreId, departmentId: s.departmentId,
    excludedFromNights: s.excludedFromNights, maxDutiesPerWeek: s.maxDutiesPerWeek, eligibleShiftIds: eligibleByStaff.get(s.id) ?? [],
  }));

  const toMin = (t: string | null) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);
  const shifts: EShift[] = shiftRows.map((s) => ({
    id: s.id, code: s.code, name: s.name, startMin: toMin(s.startTime), durationMin: Math.round(s.durationHours * 60), isOvernight: s.isOvernight,
    isOnCall: s.isOnCall, onCallFactor: s.onCallHoursFactor, countsAsDuty: s.countsAsDuty,
    // A shift that is switched off asks for nobody.
    minStaff: s.active ? s.minStaff : 0, minByCadre: s.active ? ((s.minByCadre ?? {}) as Record<string, number>) : {},
    eligibleCadreIds: s.eligibleCadreIds, sortOrder: s.sortOrder,
  }));

  const rules = ruleRows.map((r) => ({
    code: r.code, threshold: r.thresholdValue, severity: (r.behaviour === "BLOCK" ? "BLOCK" : "WARN") as "BLOCK" | "WARN",
  }));
  const cycles: ECycleRule[] = cycleRows.map((c) => ({
    id: c.id, name: c.name, countingShiftIds: c.countingShifts.map((s) => s.id), consecutiveDuties: c.consecutiveDuties, offDaysRequired: c.offDaysRequired,
    cadreIds: c.applicableCadreIds, departmentIds: c.applicableDepartmentIds, enforcement: c.enforcement, priority: c.priority,
  }));
  const leave = leaveRows.map((l) => ({ staffId: l.staffId, startDay: dayFromDate(l.startDate), endDay: dayFromDate(l.endDate) }));
  const toAssignment = (a: { staffId: string; shiftId: string; dutyDate: Date; locked?: boolean }): EAssignment => ({ staffId: a.staffId, shiftId: a.shiftId, day: dayFromDate(a.dutyDate), locked: a.locked });

  return {
    period,
    staff,
    shifts,
    rules,
    cycles,
    leave,
    holidays: holidayRows.map((h) => dayFromDate(h.date)),
    history: historyRows.map(toAssignment),
    current: rosterRows.map(toAssignment),
    offShiftId: shiftRows.find((s) => !s.countsAsDuty)?.id ?? null,
    weekStartsOn: facility.weekStartsOn,
    referenceWeeks: facility.referencePeriodWeeks,
    cadreNames: Object.fromEntries(cadres.map((c) => [c.id, c.name])),
    shiftName: new Map(shiftRows.map((s) => [s.id, s.name])),
  };
}

type Data = Awaited<ReturnType<typeof loadEngineData>>;

function sayShortfall(s: Shortfall, d: Data): { date: string; shift: string | null; cadre: string | null; required: number; available: number; sentence: string } {
  const shift = s.shiftId ? d.shiftName.get(s.shiftId) ?? "A shift" : null;
  const cadre = s.cadreId ? d.cadreNames[s.cadreId] ?? null : null;
  const are = `${s.available} ${s.available === 1 ? "person is" : "people are"} available`;
  const sentence = shift
    ? `${shift} on ${sayDay(s.day)} needs ${s.required} ${cadre ? `from ${cadre}` : "in total"}, and only ${are}.`
    : `On ${sayDay(s.day)} the shifts need ${s.required} people between them, and only ${are}.`;
  return { date: isoOf(s.day), shift, cadre, required: s.required, available: s.available, sentence };
}

function findingRow(rosterId: string, facilityId: string, f: Finding): Prisma.ComplianceFindingCreateManyInput {
  return {
    rosterId, facilityId, staffId: f.staffId, ruleCode: f.ruleCode, severity: f.severity, message: f.message,
    detail: (f.detail ?? undefined) as Prisma.InputJsonValue | undefined, dutyDate: f.day === null ? null : dateFromDay(f.day),
    requiresReassignment: f.severity === "BLOCK" && ["C6", "C9"].includes(f.ruleCode),
  };
}

// ------------------------------------------------------------- list, create, read

async function summaryOf(rosterId: string) {
  const [duties, blocks, warnings, unfilled] = await Promise.all([
    prisma.rosterAssignment.count({ where: { rosterId, shift: { countsAsDuty: true } } }),
    prisma.complianceFinding.count({ where: { rosterId, severity: "BLOCK", status: "OPEN" } }),
    prisma.complianceFinding.count({ where: { rosterId, severity: "WARN", status: "OPEN" } }),
    prisma.complianceFinding.count({ where: { rosterId, ruleCode: "C11", status: "OPEN" } }),
  ]);
  return { duties, blocks, warnings, unfilled };
}

const presentRoster = (r: Awaited<ReturnType<typeof prisma.roster.findFirstOrThrow>>) => ({
  id: r.id, year: r.year, month: r.month, label: monthName(r), status: r.status, version: r.version,
  generatedAt: r.generatedAt, generationSeconds: r.generationSeconds,
});

rostersRouter.get("/", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  const rows = await prisma.roster.findMany({ where: { facilityId }, orderBy: [{ year: "desc" }, { month: "desc" }], take: 36 });
  const rosters = await Promise.all(rows.map(async (r) => ({ ...presentRoster(r), ...(await summaryOf(r.id)) })));
  res.json({ rosters });
});

const createInput = z.object({
  year: z.number({ invalid_type_error: "Choose a year." }).int().min(2020, "Choose a year from 2020.").max(2100, "Choose a year up to 2100."),
  month: z.number({ invalid_type_error: "Choose a month." }).int().min(1, "Choose a month.").max(12, "Choose a month."),
});

rostersRouter.post("/", allowRoles(...ROSTER_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(createInput, req.body, res);
  if (!input) return;
  const exists = await prisma.roster.findUnique({ where: { facilityId_month_year: { facilityId: who.facilityId, month: input.month, year: input.year } } });
  if (exists) return res.status(409).json({ error: "roster_exists", message: `There is already a roster for ${monthName(input)}.`, id: exists.id });
  const roster = await prisma.roster.create({ data: { facilityId: who.facilityId, month: input.month, year: input.year, preparedBy: who.email } });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "roster_created", entityType: "Roster", entityId: roster.id,
    summary: `${who.displayName} started the roster for ${monthName(roster)}.`,
  });
  res.status(201).json({ roster: presentRoster(roster) });
});

rostersRouter.get("/:id", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  const roster = await prisma.roster.findFirst({ where: { id: String(req.params.id), facilityId } });
  if (!roster) return res.status(404).json({ error: "not_found" });

  const [assignments, findings, shifts, cadres] = await Promise.all([
    prisma.rosterAssignment.findMany({ where: { rosterId: roster.id }, select: { staffId: true, shiftId: true, dutyDate: true, source: true, locked: true } }),
    prisma.complianceFinding.findMany({ where: { rosterId: roster.id }, orderBy: [{ severity: "asc" }, { dutyDate: "asc" }, { ruleCode: "asc" }] }),
    prisma.shift.findMany({ where: { facilityId }, orderBy: { sortOrder: "asc" }, select: { id: true, code: true, name: true, colour: true, countsAsDuty: true, isOvernight: true, active: true } }),
    prisma.cadre.findMany({ where: { facilityId }, select: { id: true, sortOrder: true } }),
  ]);
  const inRoster = new Set(assignments.map((a) => a.staffId));
  const staff = await prisma.staff.findMany({
    where: { facilityId, OR: [{ status: "ACTIVE" }, { id: { in: [...inRoster] } }] },
    include: { cadre: { select: { id: true, name: true, code: true } }, department: { select: { id: true, name: true } } },
    orderBy: { staffNo: "asc" },
  });
  const order = new Map(cadres.map((c) => [c.id, c.sortOrder]));

  res.json({
    roster: presentRoster(roster),
    summary: await summaryOf(roster.id),
    staff: staff.map((s) => ({
      id: s.id, name: s.fullName, staffNo: s.staffNo, cadreCode: s.cadre?.code ?? s.cadre?.name ?? null, cadreName: s.cadre?.name ?? null,
      cadreOrder: s.cadreId ? order.get(s.cadreId) ?? 999 : 999, departmentName: s.department?.name ?? null,
    })),
    shifts,
    assignments: assignments.map((a) => ({ staffId: a.staffId, shiftId: a.shiftId, date: a.dutyDate.toISOString().slice(0, 10), source: a.source, locked: a.locked })),
    findings: findings.map((f) => ({
      id: f.id, ruleCode: f.ruleCode, severity: f.severity, message: f.message, staffId: f.staffId,
      date: f.dutyDate ? f.dutyDate.toISOString().slice(0, 10) : null, status: f.status,
    })),
  });
});

// ------------------------------------------------------------- generate and validate

rostersRouter.post("/:id/generate", allowRoles(...ROSTER_ROLES), async (req, res) => {
  const who = caller(req);
  const roster = await prisma.roster.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!roster) return res.status(404).json({ error: "not_found" });
  if (!["DRAFT", "GENERATED"].includes(roster.status)) {
    return res.status(409).json({ error: "roster_locked", message: `The ${monthName(roster)} roster is already ${roster.status === "PUBLISHED" ? "published" : "in review"}, so it cannot be generated again.` });
  }

  const data = await loadEngineData(who.facilityId, roster.id, roster.year, roster.month);
  if (!data.staff.length) return res.status(409).json({ error: "no_staff", message: "There are no active staff to roster. Add staff first." });
  if (!data.shifts.some((s) => s.countsAsDuty && !s.isOnCall && (s.minStaff > 0 || Object.keys(s.minByCadre).length))) {
    return res.status(409).json({ error: "no_demand", message: "No shift asks for any staff yet. Set a minimum number of people on at least one shift, under Shifts." });
  }

  const started = Date.now();
  const locked = data.current.filter((a) => a.locked);
  const result = generate({
    staff: data.staff, shifts: data.shifts, offShiftId: data.offShiftId, rules: data.rules, cycles: data.cycles, leave: data.leave, holidays: data.holidays,
    period: data.period, weekStartsOn: data.weekStartsOn, referenceWeeks: data.referenceWeeks, history: data.history, locked, cadreNames: data.cadreNames,
  });

  if (!result.feasible) {
    const shortfalls = result.shortfalls.slice(0, 40).map((s) => sayShortfall(s, data));
    return res.status(409).json({
      error: "not_feasible",
      message: `A lawful roster for ${monthName(roster)} is not possible with the staff and shifts as they are. Nothing was generated.`,
      shortfalls,
      more: Math.max(0, result.shortfalls.length - shortfalls.length),
    });
  }

  const seconds = (Date.now() - started) / 1000;
  const blocking = result.findings.filter((f) => f.severity === "BLOCK").length;
  await prisma.$transaction(
    async (tx) => {
      await tx.complianceFinding.deleteMany({ where: { rosterId: roster.id } });
      await tx.rosterAssignment.deleteMany({ where: { rosterId: roster.id, locked: false } });
      await tx.rosterAssignment.createMany({
        data: result.cells.map((c) => ({ rosterId: roster.id, facilityId: who.facilityId, staffId: c.staffId, shiftId: c.shiftId, dutyDate: dateFromDay(c.day), source: c.source })),
      });
      await tx.complianceFinding.createMany({ data: result.findings.map((f) => findingRow(roster.id, who.facilityId, f)) });
      await tx.roster.update({
        where: { id: roster.id },
        data: { status: "GENERATED", generatedAt: new Date(), generationSeconds: seconds, hasUnresolvedConflicts: blocking > 0, preparedBy: who.email },
      });
    },
    { timeout: 30_000, maxWait: 10_000 }
  );
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "roster_generated", entityType: "Roster", entityId: roster.id,
    summary: `${who.displayName} generated the roster for ${monthName(roster)}: ${result.stats.duties} duties, ${result.stats.unfilled} unfilled, ${blocking} blocking ${blocking === 1 ? "finding" : "findings"}.`,
  });
  res.json({
    roster: presentRoster({ ...roster, status: "GENERATED" }),
    summary: { ...(await summaryOf(roster.id)) },
    unfilled: result.unfilled.map((s) => sayShortfall(s, data)),
  });
});

rostersRouter.post("/:id/validate", allowRoles(...ROSTER_ROLES), async (req, res) => {
  const who = caller(req);
  const roster = await prisma.roster.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!roster) return res.status(404).json({ error: "not_found" });
  const data = await loadEngineData(who.facilityId, roster.id, roster.year, roster.month);
  const findings = evaluateCompliance(data.rules, {
    staff: data.staff, shifts: data.shifts, assignments: [...data.history, ...data.current], leave: data.leave, period: data.period,
    weekStartsOn: data.weekStartsOn, referenceWeeks: data.referenceWeeks, cadreNames: data.cadreNames,
  });
  const blocking = findings.filter((f) => f.severity === "BLOCK").length;
  await prisma.$transaction([
    prisma.complianceFinding.deleteMany({ where: { rosterId: roster.id } }),
    prisma.complianceFinding.createMany({ data: findings.map((f) => findingRow(roster.id, who.facilityId, f)) }),
    prisma.roster.update({ where: { id: roster.id }, data: { hasUnresolvedConflicts: blocking > 0 } }),
  ]);
  res.json({ summary: await summaryOf(roster.id) });
});
