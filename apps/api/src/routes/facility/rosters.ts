// Rosters (Part 3, 1.5 to 1.8): create a month, generate it, read it back
// with its findings. Generation and the rule checks live in src/engine and
// work on plain data; this file loads the data, calls them, and stores the
// result. Editing cells, review and publishing arrive with the roster
// builder.
import { rostersByUnit, seedUnitDemand } from "../../lib/unitDemand.js";
import { notifyRosterPublished } from "../../lib/rosterPublished.js";
import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@healthflow/db";
import { prisma } from "../../lib/prisma.js";
import { detachAttendance, relinkAttendance } from "../../lib/attendanceReview.js";
import { rosterPdf, type PdfRoster } from "../../lib/rosterPdf.js";
import { settleAgainstRoster, settlementFor } from "../../lib/ledger.js";
import { rosterWorkbook } from "../../lib/rosterExcel.js";
import { FACILITY_TYPE_LABEL } from "../../lib/labels.js";
import { notifyDeciders } from "../../lib/notify.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { allowRoles, caller, ADMIN_ROLES, READ_ROLES } from "../../middleware/facilityAccess.js";
import { effectiveEnd, overlaps } from "../../lib/leaveWindow.js";
import { ensureHolidays } from "../../lib/holidays.js";
import { ensureRules } from "./rules.js";
import { ensureOffDuty } from "./shifts.js";
import { generate, type Shortfall } from "../../engine/generate.js";
import { evaluateCompliance } from "../../engine/evaluators.js";
import { rosterInsights } from "../../engine/insights.js";
import { hasDemand } from "../../engine/demand.js";
import { staffingCheck } from "../../engine/staffing.js";
import { dayOf, daysInMonth, isoOf, sayDay } from "../../engine/time.js";
import type { EAssignment, ECycleRule, ERotation, EShift, EStaff, Finding } from "../../engine/types.js";

export const rostersRouter = Router();

const ROSTER_ROLES = ["FACILITY_ADMIN", "ROSTER_MANAGER"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dayFromDate = (d: Date) => Math.floor(d.getTime() / 86_400_000);
const dateFromDay = (day: number) => new Date(day * 86_400_000);
export const monthName = (r: { month: number; year: number }) => `${MONTHS[r.month - 1]} ${r.year}`;

// ------------------------------------------------------------- loading

export async function loadEngineData(facilityId: string, rosterId: string, year: number, month: number) {
  await ensureRules(facilityId);
  await ensureOffDuty(facilityId);
  await ensureHolidays(facilityId);
  const startDay = dayOf(year, month, 1);
  const period = { startDay, endDay: startDay + daysInMonth(year, month) - 1 };
  // A ward roster is for that department's people, with the ward's own minimums where it has set them.
  const unit = (await prisma.roster.findUnique({ where: { id: rosterId }, select: { departmentId: true, department: { select: { kind: true } } } })) ?? null;
  const ward = unit?.departmentId ?? null;
  // Security, drivers and cleaners set their own numbers; the wards' numbers never apply to them.
  const ownNumbersOnly = unit?.department?.kind === "SUPPORT";
  const demand = ward ? await prisma.shiftDemand.findMany({ where: { departmentId: ward } }) : [];
  // Ward transfers this month: someone joining counts from their day, someone leaving until the day before.
  const moves = ward
    ? await prisma.wardTransfer.findMany({
        where: { cancelledAt: null, effectiveDate: { lte: dateFromDay(period.endDay) }, OR: [{ toDepartmentId: ward, OR: [{ appliedAt: null }, { effectiveDate: { gt: dateFromDay(period.startDay) } }] }, { fromDepartmentId: ward, appliedAt: null }] },
        select: { staffId: true, toDepartmentId: true, effectiveDate: true },
      })
    : [];
  const joining = moves.filter((m) => m.toDepartmentId === ward);
  const away = moves.map((m) => {
    const eff = Math.max(dayFromDate(m.effectiveDate), period.startDay);
    return m.toDepartmentId === ward ? { staffId: m.staffId, startDay: period.startDay, endDay: eff - 1 } : { staffId: m.staffId, startDay: eff, endDay: period.endDay };
  }).filter((x) => x.endDay >= x.startDay);

  const [facility, staffRows, shiftRows, ruleRows, cycleRows, leaveRows, holidayRows, historyRows, rosterRows, cadres, rotationRows] = await Promise.all([
    prisma.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { weekStartsOn: true, referencePeriodWeeks: true } }),
    prisma.staff.findMany({ where: { facilityId, status: "ACTIVE", ...(ward ? { OR: [{ departmentId: ward }, { id: { in: joining.map((m) => m.staffId) } }] } : {}) }, orderBy: { staffNo: "asc" }, include: { cadre: { select: { takesNights: true, onRoster: true, weekdaysOnly: true } }, department: { select: { runsNights: true, kind: true } }, restrictions: { where: { kind: "NO_NIGHTS", endDate: { gte: dateFromDay(period.startDay - 14) }, startDate: { lte: dateFromDay(period.endDay) } }, select: { startDate: true, endDate: true } } } }),
    prisma.shift.findMany({ where: { facilityId }, include: { eligibleStaff: { select: { id: true } } }, orderBy: { sortOrder: "asc" } }),
    prisma.constraintRule.findMany({ where: { facilityId, enabled: true } }),
    prisma.dutyCycleRule.findMany({ where: { facilityId, active: true }, include: { countingShifts: { select: { id: true } } } }),
    prisma.leaveRequest.findMany({
      where: { facilityId, status: "APPROVED", startDate: { lte: dateFromDay(period.endDay) }, OR: [{ endDate: { gte: dateFromDay(period.startDay) } }, { actualReturnDate: null }] },
      select: { staffId: true, startDate: true, endDate: true, isOpenEnded: true, actualReturnDate: true, returnStatus: true },
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
    prisma.shiftRotation.findMany({ where: { facilityId, active: true }, orderBy: { name: "asc" } }),
  ]);

  const eligibleByStaff = new Map<string, string[]>();
  for (const s of shiftRows) for (const e of s.eligibleStaff) eligibleByStaff.set(e.id, [...(eligibleByStaff.get(e.id) ?? []), s.id]);

  const toMin = (t: string | null) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);
  // The morning shift: the earliest day shift that is not overnight or on call. In-charges work it, and only it.
  const morning = shiftRows
    .filter((x) => x.active && x.countsAsDuty && !x.isOvernight && !x.isOnCall && x.startTime)
    .sort((a, b) => (toMin(a.startTime) ?? 0) - (toMin(b.startTime) ?? 0))[0];
  // Doctors and other cadres kept off the roster are left out. Nights are not given to cadres or departments that do not take them.
  const staff: EStaff[] = staffRows
    .filter((s) => s.cadre?.onRoster !== false && s.department?.kind !== "OFFICE")
    .map((s) => {
      // In-charges, and cadres on office hours, work the weekday morning only, outside the duty cycles.
      const weekdays = (s.morningOnly || s.cadre?.weekdaysOnly === true) && Boolean(morning);
      return {
        id: s.id, staffNo: s.staffNo, name: s.fullName, cadreId: s.cadreId, departmentId: s.departmentId,
        excludedFromNights: s.excludedFromNights || s.cadre?.takesNights === false || s.department?.runsNights === false || weekdays,
        morningOnly: weekdays,
        maxDutiesPerWeek: s.maxDutiesPerWeek,
        eligibleShiftIds: weekdays && morning ? [morning.id] : eligibleByStaff.get(s.id) ?? [],
        canLead: s.canLead,
        maxNightsPerMonth: s.maxNightsPerMonth,
        maxHoursPerMonth: s.maxHoursPerMonth,
        noNights: s.restrictions.map((x) => ({ startDay: dayFromDate(x.startDate), endDay: dayFromDate(x.endDate) })),
      };
    });

  const shifts: EShift[] = shiftRows.map((s) => ({
    id: s.id, code: s.code, name: s.name, startMin: toMin(s.startTime), durationMin: Math.round(s.durationHours * 60), isOvernight: s.isOvernight,
    isOnCall: s.isOnCall, onCallFactor: s.onCallHoursFactor, countsAsDuty: s.countsAsDuty,
    // A shift that is switched off asks for nobody. A ward's own numbers replace the facility's, weekday, weekend and holiday alike.
    ...(() => {
      const own = demand.find((d) => d.shiftId === s.id);
      const src = own ?? s;
      if (!s.active || (ownNumbersOnly && !own)) return { minStaff: 0, minByCadre: {}, weekendMinStaff: null, weekendMinByCadre: null, holidayMinStaff: null, holidayMinByCadre: null };
      return {
        minStaff: src.minStaff,
        minByCadre: (src.minByCadre ?? {}) as Record<string, number>,
        weekendMinStaff: src.weekendMinStaff,
        weekendMinByCadre: (src.weekendMinByCadre ?? null) as Record<string, number> | null,
        holidayMinStaff: src.holidayMinStaff,
        holidayMinByCadre: (src.holidayMinByCadre ?? null) as Record<string, number> | null,
      };
    })(),
    eligibleCadreIds: s.eligibleCadreIds, sortOrder: s.sortOrder, keepFull: s.keepFull, minLeads: s.active ? s.minLeads : 0,
  }));

  const rules = ruleRows.map((r) => ({
    code: r.code, threshold: r.thresholdValue, severity: (r.behaviour === "BLOCK" ? "BLOCK" : "WARN") as "BLOCK" | "WARN",
  }));
  const cycles: ECycleRule[] = cycleRows.map((c) => ({
    id: c.id, name: c.name, countingShiftIds: c.countingShifts.map((s) => s.id), consecutiveDuties: c.consecutiveDuties, offDaysRequired: c.offDaysRequired,
    cadreIds: c.applicableCadreIds, departmentIds: c.applicableDepartmentIds, enforcement: c.enforcement, priority: c.priority,
  }));
  const rotations: ERotation[] = rotationRows.map((r) => ({
    id: r.id, name: r.name, sequenceShiftIds: r.sequenceOrder, cadreIds: r.applicableCadreIds, departmentIds: r.applicableDepartmentIds, enforcement: r.enforcement,
  }));
  const leave = leaveRows
    .filter((l) => overlaps(l, period.startDay, period.endDay))
    .map((l) => ({ staffId: l.staffId, startDay: dayFromDate(l.startDate), endDay: Math.min(effectiveEnd(l), period.endDay + 60) }))
    // Days in another ward are days this ward cannot use.
    .concat(away);
  const toAssignment = (a: { staffId: string; shiftId: string; dutyDate: Date; locked?: boolean }): EAssignment => ({ staffId: a.staffId, shiftId: a.shiftId, day: dayFromDate(a.dutyDate), locked: a.locked });

  // Public-holiday duties each person worked over the last twelve months, so holidays are shared over the year.
  const pastHolidays = await prisma.publicHoliday.findMany({
    where: { OR: [{ facilityId }, { facilityId: null }], date: { gte: dateFromDay(period.startDay - 365), lt: dateFromDay(period.startDay) } },
    select: { date: true },
  });
  const holidayWorked: Record<string, number> = {};
  if (pastHolidays.length) {
    const worked = await prisma.rosterAssignment.groupBy({
      by: ["staffId"],
      where: { facilityId, dutyDate: { in: pastHolidays.map((h) => h.date) }, shift: { countsAsDuty: true }, staffId: { in: staff.map((x) => x.id) } },
      _count: { _all: true },
    });
    for (const w of worked) holidayWorked[w.staffId] = w._count._all;
  }

  // Days people asked to have off this month: approved ones are kept free, ones still waiting are avoided where possible.
  const offRows = await prisma.dayOffRequest.findMany({
    where: { facilityId, status: { in: ["REQUESTED", "APPROVED"] }, date: { gte: dateFromDay(period.startDay), lte: dateFromDay(period.endDay) }, staffId: { in: staff.map((x) => x.id) } },
    select: { staffId: true, date: true, status: true },
  });
  const daysOff = offRows.map((o) => ({ staffId: o.staffId, day: dayFromDate(o.date), approved: o.status === "APPROVED" }));

  return {
    period,
    staff,
    holidayWorked,
    daysOff,
    shifts,
    rules,
    cycles,
    rotations,
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

export type Data = Awaited<ReturnType<typeof loadEngineData>>;

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

export async function saveVersion(tx: Prisma.TransactionClient, rosterId: string, version: number, by: string, reason: string) {
  const rows = await tx.rosterAssignment.findMany({ where: { rosterId }, select: { staffId: true, shiftId: true, dutyDate: true, source: true, locked: true } });
  await tx.rosterVersionSnapshot.create({
    data: { rosterId, version, createdBy: by, reason, assignments: rows.map((a) => ({ ...a, dutyDate: a.dutyDate.toISOString().slice(0, 10) })) },
  });
}

export const findingKey = (f: { ruleCode: string; staffId: string | null; dutyDate?: Date | null; day?: number | null }) =>
  `${f.ruleCode}|${f.staffId ?? ""}|${f.dutyDate ? Math.floor(f.dutyDate.getTime() / 86_400_000) : f.day ?? ""}`;

/**
 * Replaces a roster's findings with a fresh set, carrying over any that a
 * manager has already overridden with a reason, so re-checking does not
 * silently bring back a finding someone accepted.
 */
/** Attendance that no longer matches a duty: tell the people who run the roster. */
async function flagReview(who: { facilityId: string; email: string }, roster: { month: number; year: number }, loose: { name: string; date: Date }[]) {
  if (loose.length === 0) return;
  const names = [...new Set(loose.map((l) => l.name))];
  await notifyDeciders(who.facilityId, {
    type: "attendance_review",
    title: `${loose.length} attendance ${loose.length === 1 ? "record needs" : "records need"} a second look`,
    body: `A duty changed after attendance was recorded for ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}, in the ${monthName(roster)} roster. The record was kept; check that it is still right.`,
    linkUrl: `/attendance?date=${loose[0].date.toISOString().slice(0, 10)}`,
    severity: "ACTION",
  });
}

export async function storeFindings(tx: Prisma.TransactionClient, rosterId: string, facilityId: string, findings: Finding[]) {
  const kept = await tx.complianceFinding.findMany({ where: { rosterId, status: "OVERRIDDEN" } });
  const overrides = new Map(kept.map((k) => [findingKey(k), k]));
  await tx.complianceFinding.deleteMany({ where: { rosterId } });
  await tx.complianceFinding.createMany({
    data: findings.map((f) => {
      const row = findingRow(rosterId, facilityId, f);
      const o = overrides.get(findingKey(f));
      return o ? { ...row, status: "OVERRIDDEN" as const, overrideReason: o.overrideReason, overrideBy: o.overrideBy, overrideAt: o.overrideAt } : row;
    }),
  });
}

// ------------------------------------------------------------- list, create, read

async function summaryOf(rosterId: string) {
  return (await summariesOf([rosterId])).get(rosterId)!;
}

/** The counts for many rosters in three queries, not four for each. */
async function summariesOf(ids: string[]) {
  const [duties, findings] = await Promise.all([
    prisma.rosterAssignment.groupBy({ by: ["rosterId"], where: { rosterId: { in: ids }, shift: { countsAsDuty: true } }, _count: { _all: true } }),
    prisma.complianceFinding.groupBy({ by: ["rosterId", "severity", "ruleCode"], where: { rosterId: { in: ids }, status: "OPEN" }, _count: { _all: true } }),
  ]);
  const out = new Map(ids.map((id) => [id, { duties: 0, blocks: 0, warnings: 0, unfilled: 0 }]));
  for (const d of duties) out.get(d.rosterId)!.duties = d._count._all;
  for (const f of findings) {
    const o = out.get(f.rosterId)!;
    if (f.severity === "BLOCK") o.blocks += f._count._all;
    else o.warnings += f._count._all;
    if (f.ruleCode === "C11") o.unfilled += f._count._all;
  }
  return out;
}

const presentRoster = (r: Awaited<ReturnType<typeof prisma.roster.findFirstOrThrow>> & { department?: { name: string } | null }) => ({
  id: r.id, year: r.year, month: r.month, label: r.department ? `${monthName(r)}, ${r.department.name}` : monthName(r), departmentId: r.departmentId, department: r.department?.name ?? null, status: r.status, version: r.version,
  generatedAt: r.generatedAt, generationSeconds: r.generationSeconds,
});

rostersRouter.get("/", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId, departmentId } = caller(req);
  const rows = await prisma.roster.findMany({ where: { facilityId, ...(departmentId ? { departmentId } : {}) }, include: { department: { select: { name: true } } }, orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "asc" }], take: 60 });
  const sums = await summariesOf(rows.map((r) => r.id));
  const rosters = rows.map((r) => ({ ...presentRoster(r), ...sums.get(r.id)! }));
  res.json({ rosters });
});

const createInput = z.object({
  year: z.number({ invalid_type_error: "Choose a year." }).int().min(2020, "Choose a year from 2020.").max(2100, "Choose a year up to 2100."),
  month: z.number({ invalid_type_error: "Choose a month." }).int().min(1, "Choose a month.").max(12, "Choose a month."),
  departmentId: z.string().trim().nullish().transform((v) => v || null),
});

/** Hospitals keep one roster per ward or department. Health centres, clinics and CHPS compounds keep one for the whole facility. */
export const WARD_FACILITY_TYPES = ["HOSPITAL", "PRIVATE_HOSPITAL", "POLYCLINIC", "REGIONAL_HOSPITAL", "TEACHING_HOSPITAL"];

rostersRouter.post("/", allowRoles(...ROSTER_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(createInput, req.body, res);
  if (!input) return;
  const facility = await prisma.facility.findUniqueOrThrow({ where: { id: who.facilityId }, select: { facilityType: true } });
  const byWard = await rostersByUnit(who.facilityId, facility.facilityType, WARD_FACILITY_TYPES);
  const departmentId = who.departmentId ?? input.departmentId;
  if (byWard && !departmentId) return res.status(400).json({ error: "invalid_input", fields: { departmentId: "Choose the ward or department this roster is for." }, message: "Choose the ward or department this roster is for." });
  if (!byWard && departmentId) return res.status(400).json({ error: "invalid_input", message: "This facility keeps one roster for the whole facility." });
  const dept = departmentId ? await prisma.department.findFirst({ where: { id: departmentId, facilityId: who.facilityId }, select: { id: true, name: true, kind: true } }) : null;
  if (departmentId && !dept) return res.status(400).json({ error: "invalid_input", message: "That department was not found." });
  if (dept?.kind === "OFFICE") return res.status(400).json({ error: "invalid_input", fields: { departmentId: `${dept.name} has no roster.` }, message: `${dept.name} has no roster.` });
  const exists = await prisma.roster.findFirst({ where: { facilityId: who.facilityId, month: input.month, year: input.year, departmentId: dept?.id ?? null } });
  if (exists) return res.status(409).json({ error: "roster_exists", message: `There is already a roster for ${monthName(input)}${dept ? ` in ${dept.name}` : ""}.`, id: exists.id });
  const roster = await prisma.roster.create({ data: { facilityId: who.facilityId, month: input.month, year: input.year, departmentId: dept?.id ?? null, preparedBy: who.email }, include: { department: { select: { name: true } } } });
  if (dept && facility.facilityType === "HEALTH_CENTRE") await seedUnitDemand(who.facilityId, dept);
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "roster_created", entityType: "Roster", entityId: roster.id,
    summary: `${who.displayName} started the roster for ${monthName(roster)}${dept ? ` in ${dept.name}` : ""}.`,
  });
  res.status(201).json({ roster: presentRoster(roster) });
});

// A ward roster manager reaches only their own department's rosters, whatever the address says.
rostersRouter.param("id", async (req, res, next, id) => {
  const departmentId = req.caller?.departmentId;
  if (!departmentId) return next();
  const r = await prisma.roster.findFirst({ where: { id: String(id), facilityId: req.caller!.facilityId }, select: { departmentId: true } });
  if (!r || r.departmentId !== departmentId) return res.status(404).json({ error: "not_found" });
  next();
});

rostersRouter.get("/:id", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  const roster = await prisma.roster.findFirst({ where: { id: String(req.params.id), facilityId }, include: { department: { select: { name: true } } } });
  if (!roster) return res.status(404).json({ error: "not_found" });

  const [assignments, findings, shifts, cadres] = await Promise.all([
    prisma.rosterAssignment.findMany({ where: { rosterId: roster.id }, select: { staffId: true, shiftId: true, dutyDate: true, source: true, locked: true } }),
    prisma.complianceFinding.findMany({ where: { rosterId: roster.id }, orderBy: [{ severity: "asc" }, { dutyDate: "asc" }, { ruleCode: "asc" }] }),
    prisma.shift.findMany({ where: { facilityId }, orderBy: { sortOrder: "asc" }, select: { id: true, code: true, name: true, colour: true, countsAsDuty: true, isOvernight: true, active: true } }),
    prisma.cadre.findMany({ where: { facilityId }, select: { id: true, sortOrder: true } }),
  ]);
  const inRoster = new Set(assignments.map((a) => a.staffId));
  const staff = await prisma.staff.findMany({
    where: { facilityId, OR: [{ status: "ACTIVE" }, { id: { in: [...inRoster] } }], ...(roster.departmentId ? { departmentId: roster.departmentId } : {}) },
    include: { cadre: { select: { id: true, name: true, code: true } }, department: { select: { id: true, name: true } } },
    orderBy: { staffNo: "asc" },
  });
  const order = new Map(cadres.map((c) => [c.id, c.sortOrder]));
  // Leave and approved days off as codes in their cells, and public holidays: the same as the printed roster.
  const sheet = await marksFor(facilityId, roster, staff.map((s) => s.id));

  res.json({
    roster: presentRoster(roster),
    summary: await summaryOf(roster.id),
    marks: Object.fromEntries(sheet.marks),
    markLegend: sheet.markLegend,
    holidays: sheet.holidays.map((d) => `${roster.year}-${String(roster.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`),
    staff: staff.map((s) => ({
      id: s.id, name: s.fullName, staffNo: s.staffNo, cadreCode: s.cadre?.code ?? s.cadre?.name ?? null, cadreName: s.cadre?.name ?? null,
      cadreOrder: s.cadreId ? order.get(s.cadreId) ?? 999 : 999, departmentName: s.department?.name ?? null,
    })),
    shifts,
    assignments: assignments.map((a) => ({ staffId: a.staffId, shiftId: a.shiftId, date: a.dutyDate.toISOString().slice(0, 10), source: a.source, locked: a.locked })),
    findings: findings.map((f) => ({
      id: f.id, ruleCode: f.ruleCode, severity: f.severity, message: f.message, staffId: f.staffId,
      date: f.dutyDate ? f.dutyDate.toISOString().slice(0, 10) : null, status: f.status,
      overrideReason: f.overrideReason, overrideBy: f.overrideBy,
    })),
  });
});

/** Who carries how much, and where a cadre is short and what would close it. Read from the roster as it stands now. */
/** Before generating: can these people cover these minimums at all, and what would make it possible. */
rostersRouter.get("/:id/staffing", allowRoles(...READ_ROLES), async (req, res) => {
  const who = caller(req);
  const roster = await prisma.roster.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!roster) return res.status(404).json({ error: "not_found" });
  const data = await loadEngineData(who.facilityId, roster.id, roster.year, roster.month);
  res.json(staffingCheck({ staff: data.staff, shifts: data.shifts, cycles: data.cycles, rules: data.rules, leave: data.leave, holidays: data.holidays, period: data.period, cadreNames: data.cadreNames }));
});

rostersRouter.get("/:id/insights", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  const roster = await prisma.roster.findFirst({ where: { id: String(req.params.id), facilityId } });
  if (!roster) return res.status(404).json({ error: "not_found" });
  const data = await loadEngineData(facilityId, roster.id, roster.year, roster.month);
  const view = rosterInsights({ staff: data.staff, shifts: data.shifts, cycles: data.cycles, leave: data.leave, holidays: data.holidays, period: data.period, assignments: data.current, cadreNames: data.cadreNames });
  const who = new Map(data.staff.map((s) => [s.id, s]));
  res.json({
    ...view,
    workload: view.workload.map((w) => ({ ...w, name: who.get(w.staffId)?.name ?? "", staffNo: who.get(w.staffId)?.staffNo ?? "", cadreName: (who.get(w.staffId)?.cadreId && data.cadreNames[who.get(w.staffId)!.cadreId!]) || "No cadre set" })),
  });
});

type RosterRow = NonNullable<Awaited<ReturnType<typeof prisma.roster.findFirst>>>;

/** Everything the printed and Excel sheets show, read once. */
/** Leave and approved days off as codes per staffId|YYYY-MM-DD, and the public holidays (day of month), for screen and print. */
async function marksFor(facilityId: string, roster: { year: number; month: number }, staffIds: string[]) {
  // Leave and approved days off show as codes in their cells; public holidays are marked in the header.
  const first = new Date(Date.UTC(roster.year, roster.month - 1, 1));
  const last = new Date(Date.UTC(roster.year, roster.month, 0));
  const [leaveRows, offRows, holidayRows] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { facilityId, status: "APPROVED", staffId: { in: staffIds }, startDate: { lte: last }, OR: [{ endDate: { gte: first } }, { isOpenEnded: true, actualReturnDate: null }] },
      select: { staffId: true, startDate: true, endDate: true, isOpenEnded: true, actualReturnDate: true, leaveType: { select: { code: true, name: true } } },
    }),
    prisma.dayOffRequest.findMany({ where: { facilityId, status: "APPROVED", date: { gte: first, lte: last }, staffId: { in: staffIds } }, select: { staffId: true, date: true } }),
    prisma.publicHoliday.findMany({ where: { OR: [{ facilityId }, { facilityId: null }], date: { gte: first, lte: last } }, select: { date: true } }),
  ]);
  const marks = new Map<string, string>();
  const legend = new Map<string, string>();
  for (const l of leaveRows) {
    const code = (l.leaveType.code || "L").slice(0, 3).toUpperCase();
    legend.set(code, `${l.leaveType.name} leave`);
    const until = l.isOpenEnded ? (l.actualReturnDate ? new Date(l.actualReturnDate.getTime() - 86_400_000) : last) : l.endDate;
    for (let d = Math.max(dayFromDate(l.startDate), dayFromDate(first)); d <= Math.min(dayFromDate(until), dayFromDate(last)); d++) marks.set(`${l.staffId}|${isoOf(d)}`, code);
  }
  for (const o of offRows) {
    const key = `${o.staffId}|${o.date.toISOString().slice(0, 10)}`;
    if (!marks.has(key)) {
      marks.set(key, "RO");
      legend.set("RO", "day off asked for and approved");
    }
  }
  return { marks, markLegend: [...legend].map(([code, label]) => ({ code, label })), holidays: holidayRows.map((h) => h.date.getUTCDate()) };
}

async function buildSheet(facilityId: string, roster: RosterRow) {
  const [facility, assignments, shifts, cadres, findings] = await Promise.all([
    prisma.facility.findUniqueOrThrow({ where: { id: facilityId }, include: { district: { select: { name: true } } } }),
    prisma.rosterAssignment.findMany({ where: { rosterId: roster.id }, select: { staffId: true, shiftId: true, dutyDate: true } }),
    prisma.shift.findMany({ where: { facilityId }, orderBy: { sortOrder: "asc" } }),
    prisma.cadre.findMany({ where: { facilityId }, select: { id: true, sortOrder: true } }),
    prisma.complianceFinding.findMany({ where: { rosterId: roster.id }, select: { severity: true, status: true } }),
  ]);
  const inRoster = new Set(assignments.map((a) => a.staffId));
  const staffRows = await prisma.staff.findMany({
    where: { facilityId, OR: [{ status: "ACTIVE" }, { id: { in: [...inRoster] } }], ...(roster.departmentId ? { departmentId: roster.departmentId } : {}) },
    include: { cadre: { select: { name: true } } },
  });
  const { marks, markLegend, holidays } = await marksFor(facilityId, roster, staffRows.map((x) => x.id));
  const order = new Map(cadres.map((c) => [c.id, c.sortOrder]));
  staffRows.sort((a, b) => (order.get(a.cadreId ?? "") ?? 999) - (order.get(b.cadreId ?? "") ?? 999) || a.staffNo.localeCompare(b.staffNo, undefined, { numeric: true }));

  const nameOf = async (email: string | null) => {
    if (!email) return null;
    const u = await prisma.userProfile.findUnique({ where: { userEmail: email }, select: { staff: { select: { fullName: true } } } });
    return u?.staff?.fullName ?? email;
  };
  const status = roster.status.charAt(0) + roster.status.slice(1).toLowerCase().replace("_", " ");
  const sheet: PdfRoster = {
    facilityName: facility.name,
    place: [FACILITY_TYPE_LABEL[facility.facilityType], facility.district?.name, facility.region].filter(Boolean).join(", ") || null,
    title: monthName(roster),
    statusWord: status === "Draft" || status === "Generated" || status === "Under review" ? `${status}, not yet approved` : status,
    version: roster.version,
    year: roster.year,
    month: roster.month,
    staff: staffRows.map((s) => ({ id: s.id, name: s.fullName, staffNo: s.staffNo, cadre: s.cadre?.name ?? null })),
    shifts: shifts.filter((s) => s.active || assignments.some((a) => a.shiftId === s.id)).map((s) => ({
      id: s.id, code: s.code, name: s.name, time: s.startTime && s.endTime ? `${s.startTime} to ${s.endTime}` : null, colour: s.colour, countsAsDuty: s.countsAsDuty,
    })),
    cells: new Map(assignments.map((a) => [`${a.staffId}|${a.dutyDate.toISOString().slice(0, 10)}`, a.shiftId])),
    preparedBy: await nameOf(roster.preparedBy),
    approvedBy: await nameOf(roster.approvedBy),
    blocking: findings.filter((f) => f.severity === "BLOCK" && f.status === "OPEN").length,
    warnings: findings.filter((f) => f.severity === "WARN").length,
    overrides: findings.filter((f) => f.status === "OVERRIDDEN").length,
    printedOn: new Date().toISOString().slice(0, 10).split("-").reverse().join("/"),
    holidays,
    marks,
    markLegend,
    leads: new Set(staffRows.filter((x) => x.canLead).map((x) => x.id)),
  };
  return { sheet, status, facilityName: facility.name, hours: new Map(shifts.map((s) => [s.id, s.countsAsDuty ? s.durationHours * (s.isOnCall ? s.onCallHoursFactor : 1) : 0])) };
}

const fileStem = (name: string, r: { year: number; month: number }) => `${name.replace(/[^A-Za-z0-9]+/g, "-")}-roster-${r.year}-${String(r.month).padStart(2, "0")}`;

/** The A4 landscape sheet. Available at any status, so a draft can be circulated for comment. */
rostersRouter.get("/:id/pdf", allowRoles(...READ_ROLES), async (req, res) => {
  const who = caller(req);
  const roster = await prisma.roster.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!roster) return res.status(404).json({ error: "not_found" });
  const { sheet, status, facilityName } = await buildSheet(who.facilityId, roster);
  const buf = await rosterPdf(sheet);
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "roster_pdf_downloaded", entityType: "Roster", entityId: roster.id,
    summary: `${who.displayName} downloaded the ${monthName(roster)} roster as a PDF (${status.toLowerCase()}, version ${roster.version}).`,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileStem(facilityName, roster)}.pdf"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(buf);
});

/** The same roster as a spreadsheet, at any status. */
rostersRouter.get("/:id/excel", allowRoles(...READ_ROLES), async (req, res) => {
  const who = caller(req);
  const roster = await prisma.roster.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!roster) return res.status(404).json({ error: "not_found" });
  const { sheet, status, facilityName, hours } = await buildSheet(who.facilityId, roster);
  const buf = await rosterWorkbook(sheet, hours);
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "roster_excel_downloaded", entityType: "Roster", entityId: roster.id,
    summary: `${who.displayName} downloaded the ${monthName(roster)} roster as an Excel file (${status.toLowerCase()}, version ${roster.version}).`,
  });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${fileStem(facilityName, roster)}.xlsx"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(buf);
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
  if (!data.shifts.some((s) => s.countsAsDuty && !s.isOnCall && hasDemand(s))) {
    return res.status(409).json({ error: "no_demand", message: roster.departmentId ? "No shift asks for anyone here yet. Set how many people each shift needs, on this roster page." : "No shift asks for any staff yet. Set a minimum number of people on at least one shift, under Shifts." });
  }

  const settlement = await settlementFor(who.facilityId);
  const started = Date.now();
  const locked = data.current.filter((a) => a.locked);
  // The first generation is the plain order. Every later one is a new variation, unless the caller pins one.
  const hadBefore = await prisma.rosterAssignment.count({ where: { rosterId: roster.id } });
  const asked = Number((req.body as { variation?: unknown } | undefined)?.variation);
  const variation = Number.isInteger(asked) && asked >= 0 && asked < 1_000_000 ? asked : hadBefore ? 1 + Math.floor(Math.random() * 99_999) : 0;
  const result = generate({
    variation,
    staff: data.staff, shifts: data.shifts, offShiftId: data.offShiftId, rules: data.rules, cycles: data.cycles, rotations: data.rotations, leave: data.leave, holidays: data.holidays,
    period: data.period, weekStartsOn: data.weekStartsOn, referenceWeeks: data.referenceWeeks, history: data.history, locked, cadreNames: data.cadreNames, settlement,
    holidayWorked: data.holidayWorked,
    daysOff: data.daysOff,
  });

  if (!result.feasible) {
    const shortfalls = result.shortfalls.slice(0, 40).map((s) => sayShortfall(s, data));
    return res.status(409).json({
      error: "not_feasible",
      message: `A lawful roster for ${monthName(roster)} is not possible with the staff and shifts as they are. Nothing was generated.${roster.departmentId ? " Check how many people this ward needs on each shift." : ""}`,
      shortfalls,
      more: Math.max(0, result.shortfalls.length - shortfalls.length),
    });
  }

  const seconds = (Date.now() - started) / 1000;
  const hadDuties = await prisma.rosterAssignment.count({ where: { rosterId: roster.id } });
  const blocking = result.findings.filter((f) => f.severity === "BLOCK").length;
  let loose: { name: string; date: Date }[] = [];
  await prisma.$transaction(
    async (tx) => {
      if (hadDuties) await saveVersion(tx, roster.id, roster.version + 1, who.email, "Before generating again");
      await detachAttendance(tx, { rosterId: roster.id, locked: false });
      await tx.rosterAssignment.deleteMany({ where: { rosterId: roster.id, locked: false } });
      await tx.rosterAssignment.createMany({
        data: result.cells.map((c) => ({ rosterId: roster.id, facilityId: who.facilityId, staffId: c.staffId, shiftId: c.shiftId, dutyDate: dateFromDay(c.day), source: c.source })),
      });
      loose = await relinkAttendance(tx, roster.id);
      await storeFindings(tx, roster.id, who.facilityId, result.findings);
      await tx.roster.update({
        where: { id: roster.id },
        data: { status: "GENERATED", generatedAt: new Date(), generationSeconds: seconds, hasUnresolvedConflicts: blocking > 0, preparedBy: who.email, ...(hadDuties ? { version: roster.version + 1 } : {}) },
      });
    },
    { timeout: 30_000, maxWait: 10_000 }
  );
  await flagReview(who, roster, loose);
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "roster_generated", entityType: "Roster", entityId: roster.id,
    summary: `${who.displayName} generated the roster for ${monthName(roster)}: ${result.stats.duties} duties, ${result.stats.unfilled} unfilled, ${blocking} blocking ${blocking === 1 ? "finding" : "findings"}.${Object.keys(settlement).length ? ` The duty ledger moved ${Object.keys(settlement).length} ${Object.keys(settlement).length === 1 ? "person's" : "people's"} share.` : ""}${` Applied ${data.cycles.length} duty ${data.cycles.length === 1 ? "cycle" : "cycles"} and ${data.rotations.length} rotation ${data.rotations.length === 1 ? "order" : "orders"}, variation ${variation}.`}${result.stats.carried ? ` Duties from the last three months moved ${result.stats.carried} ${result.stats.carried === 1 ? "person's" : "people's"} share.` : ""}`,
  });
  const applied = {
    cycles: data.cycles.map((c) => ({ name: c.name, rule: `${c.consecutiveDuties} on, ${c.offDaysRequired} off`, enforcement: c.enforcement })),
    rotations: data.rotations.map((r) => ({ name: r.name, enforcement: r.enforcement })),
    ledgerPeople: Object.keys(settlement).length,
    carriedPeople: result.stats.carried,
    lockedKept: locked.length,
    variation,
  };
  res.json({
    applied,
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
    weekStartsOn: data.weekStartsOn, referenceWeeks: data.referenceWeeks, cadreNames: data.cadreNames, holidays: data.holidays,
  });
  const blocking = findings.filter((f) => f.severity === "BLOCK").length;
  await prisma.$transaction(async (tx) => {
    await storeFindings(tx, roster.id, who.facilityId, findings);
    await tx.roster.update({ where: { id: roster.id }, data: { hasUnresolvedConflicts: blocking > 0 } });
  });
  res.json({ summary: await summaryOf(roster.id) });
});

// ------------------------------------------------------------- editing one duty

const EDITABLE = ["GENERATED", "UNDER_REVIEW"];

const cellInput = z.object({
  staffId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  shiftId: z.string().min(1),
  overrideReason: z.string().trim().max(500).optional(),
});

export function checkOf(data: Data, assignments: EAssignment[]) {
  return evaluateCompliance(data.rules, {
    staff: data.staff, shifts: data.shifts, assignments: [...data.history, ...assignments], leave: data.leave, period: data.period,
    weekStartsOn: data.weekStartsOn, referenceWeeks: data.referenceWeeks, cadreNames: data.cadreNames, holidays: data.holidays,
  });
}

rostersRouter.put("/:id/cell", allowRoles(...ROSTER_ROLES), async (req, res) => {
  const who = caller(req);
  const roster = await prisma.roster.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!roster) return res.status(404).json({ error: "not_found" });
  if (!EDITABLE.includes(roster.status)) {
    return res.status(409).json({
      error: "roster_locked",
      message: roster.status === "DRAFT" ? "Generate the roster before changing duties." : `The ${monthName(roster)} roster is ${STATUS_SAY[roster.status]}, so duties cannot be changed. Reopen it first.`,
    });
  }
  const input = parseOr400(cellInput, req.body, res);
  if (!input) return;

  const day = dayFromDate(new Date(`${input.date}T00:00:00Z`));
  const first = dayOf(roster.year, roster.month, 1);
  if (!(day >= first && day < first + daysInMonth(roster.year, roster.month))) {
    return res.status(400).json({ error: "invalid_input", fields: { date: `That date is not in ${monthName(roster)}.` } });
  }
  const data = await loadEngineData(who.facilityId, roster.id, roster.year, roster.month);
  const person = data.staff.find((p) => p.id === input.staffId);
  const shift = data.shifts.find((x) => x.id === input.shiftId);
  if (!person) return res.status(404).json({ error: "not_found", message: "That person is not an active member of staff here." });
  if (!shift) return res.status(404).json({ error: "not_found", message: "That shift is not one of your facility's shifts." });
  if (shift.countsAsDuty === false && shift.id !== data.offShiftId) return res.status(400).json({ error: "invalid_input", fields: { shiftId: "That shift cannot be assigned." } });

  const before = checkOf(data, data.current);
  const next = [...data.current.filter((a) => !(a.staffId === person.id && a.day === day)), { staffId: person.id, shiftId: shift.id, day, locked: true }];
  const after = checkOf(data, next);
  const had = new Set(before.map((f) => findingKey(f)));
  const added = after.filter((f) => f.severity === "BLOCK" && !had.has(findingKey(f)));

  if (added.length && !input.overrideReason) {
    return res.status(409).json({
      error: "blocks_rule",
      message: `${shift.name} for ${person.name} on ${sayDay(day)} breaks a rule that is set to block.`,
      findings: added.map((f) => ({ ruleCode: f.ruleCode, message: f.message })),
    });
  }
  if (added.length && (input.overrideReason?.length ?? 0) < 10) {
    return res.status(400).json({ error: "invalid_input", fields: { overrideReason: "Give a reason of at least a few words." } });
  }

  const previous = data.current.find((a) => a.staffId === person.id && a.day === day);
  const blocking = after.filter((f) => f.severity === "BLOCK").length;
  let loose: { name: string; date: Date }[] = [];
  await prisma.$transaction(async (tx) => {
    await detachAttendance(tx, { rosterId: roster.id, staffId: person.id, dutyDate: dateFromDay(day) });
    await tx.rosterAssignment.deleteMany({ where: { rosterId: roster.id, staffId: person.id, dutyDate: dateFromDay(day) } });
    await tx.rosterAssignment.create({
      data: { rosterId: roster.id, facilityId: who.facilityId, staffId: person.id, shiftId: shift.id, dutyDate: dateFromDay(day), source: "MANUAL", locked: true },
    });
    loose = await relinkAttendance(tx, roster.id);
    await storeFindings(tx, roster.id, who.facilityId, after);
    if (added.length) {
      const keys = new Set(added.map((f) => findingKey(f)));
      const rows = await tx.complianceFinding.findMany({ where: { rosterId: roster.id, severity: "BLOCK", status: "OPEN" } });
      const ids = rows.filter((r) => keys.has(findingKey(r))).map((r) => r.id);
      await tx.complianceFinding.updateMany({
        where: { id: { in: ids } },
        data: { status: "OVERRIDDEN", overrideReason: input.overrideReason, overrideBy: who.email, overrideAt: new Date() },
      });
    }
    await tx.roster.update({ where: { id: roster.id }, data: { hasUnresolvedConflicts: blocking - added.length > 0 } });
  });
  await flagReview(who, roster, loose);
  const was = previous ? data.shiftName.get(previous.shiftId) ?? "a shift" : "nothing";
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "roster_cell_changed", entityType: "Roster", entityId: roster.id,
    before: { shiftId: previous?.shiftId ?? null }, after: { shiftId: shift.id },
    summary: `${who.displayName} changed ${person.name} on ${sayDay(day)} in the ${monthName(roster)} roster from ${was} to ${shift.name}${
      added.length ? `, overriding ${added.map((f) => f.ruleCode).join(", ")}: ${input.overrideReason}` : ""
    }.`,
  });
  res.json({ summary: await summaryOf(roster.id) });
});

// ------------------------------------------------------------- overriding a finding

rostersRouter.post("/:id/findings/:findingId/override", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(z.object({ reason: z.string().trim().min(10, "Give a reason of at least a few words.").max(500) }), req.body, res);
  if (!input) return;
  const roster = await prisma.roster.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!roster) return res.status(404).json({ error: "not_found" });
  if (!EDITABLE.includes(roster.status)) return res.status(409).json({ error: "roster_locked", message: "Reopen the roster before overriding a finding." });
  const finding = await prisma.complianceFinding.findFirst({ where: { id: String(req.params.findingId), rosterId: roster.id } });
  if (!finding) return res.status(404).json({ error: "not_found" });
  if (finding.status !== "OPEN") return res.status(409).json({ error: "not_open", message: "That finding is already dealt with." });
  await prisma.complianceFinding.update({ where: { id: finding.id }, data: { status: "OVERRIDDEN", overrideReason: input.reason, overrideBy: who.email, overrideAt: new Date() } });
  const open = await prisma.complianceFinding.count({ where: { rosterId: roster.id, severity: "BLOCK", status: "OPEN" } });
  await prisma.roster.update({ where: { id: roster.id }, data: { hasUnresolvedConflicts: open > 0 } });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "roster_finding_overridden", entityType: "Roster", entityId: roster.id,
    summary: `${who.displayName} accepted the ${finding.ruleCode} finding "${finding.message}" in the ${monthName(roster)} roster. Reason: ${input.reason}`,
    reason: input.reason,
  });
  res.json({ summary: await summaryOf(roster.id) });
});

// ------------------------------------------------------------- review, approval, publishing

const STATUS_SAY: Record<string, string> = {
  DRAFT: "a draft", GENERATED: "generated", UNDER_REVIEW: "in review", APPROVED: "approved", PUBLISHED: "published", ARCHIVED: "archived",
};

/** from -> to, with who may make the move. */
const MOVES: Record<string, { from: string[]; to: "GENERATED" | "UNDER_REVIEW" | "APPROVED" | "PUBLISHED" | "ARCHIVED"; roles: readonly string[]; word: string }> = {
  submit: { from: ["GENERATED"], to: "UNDER_REVIEW", roles: ROSTER_ROLES, word: "sent for review" },
  return: { from: ["UNDER_REVIEW"], to: "GENERATED", roles: ADMIN_ROLES, word: "returned for changes" },
  approve: { from: ["UNDER_REVIEW"], to: "APPROVED", roles: ADMIN_ROLES, word: "approved" },
  reopen: { from: ["APPROVED"], to: "GENERATED", roles: ADMIN_ROLES, word: "reopened" },
  publish: { from: ["APPROVED"], to: "PUBLISHED", roles: ADMIN_ROLES, word: "published" },
  archive: { from: ["PUBLISHED"], to: "ARCHIVED", roles: ADMIN_ROLES, word: "archived" },
};

rostersRouter.post("/:id/status", allowRoles(...ROSTER_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(z.object({ action: z.enum(["submit", "return", "approve", "reopen", "publish", "archive"]), note: z.string().trim().max(500).optional() }), req.body, res);
  if (!input) return;
  const move = MOVES[input.action];
  const roster = await prisma.roster.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!roster) return res.status(404).json({ error: "not_found" });
  if (!move.roles.includes(who.role)) return res.status(403).json({ error: "forbidden", message: "Only a facility admin can do that." });
  if (!move.from.includes(roster.status)) {
    return res.status(409).json({ error: "wrong_status", message: `The ${monthName(roster)} roster is ${STATUS_SAY[roster.status]}, so it cannot be ${move.word}.` });
  }
  if (input.action === "approve" || input.action === "publish") {
    const open = await prisma.complianceFinding.count({ where: { rosterId: roster.id, severity: "BLOCK", status: "OPEN" } });
    if (open > 0) {
      return res.status(409).json({
        error: "open_blocks",
        message: `The roster still has ${open} blocking ${open === 1 ? "finding" : "findings"}. Fix ${open === 1 ? "it" : "them"} by changing duties, or accept ${open === 1 ? "it" : "each"} with a reason, then try again.`,
      });
    }
  }
  const snapshot = ["approve", "publish"].includes(input.action);
  const version = snapshot ? roster.version + 1 : roster.version;
  await prisma.$transaction(async (tx) => {
    if (snapshot) await saveVersion(tx, roster.id, version, who.email, `${move.word[0].toUpperCase()}${move.word.slice(1)}${input.note ? `: ${input.note}` : ""}`);
    await tx.roster.update({
      where: { id: roster.id },
      data: {
        status: move.to, version,
        ...(input.action === "approve" ? { approvedBy: who.email } : {}),
        ...(input.action === "reopen" ? { approvedBy: null } : {}),
        ...(input.action === "publish" ? { publishedAt: new Date() } : {}),
      },
    });
  });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: `roster_${input.action}`, entityType: "Roster", entityId: roster.id,
    summary: `${who.displayName} ${move.word} the ${monthName(roster)} roster${input.note ? `. Note: ${input.note}` : ""}.`,
  });
  if (input.action === "publish") {
    await settleAgainstRoster(who.facilityId, roster.id, who.email);
    // Telling staff is best effort: a failed notice must not undo the publication.
    await notifyRosterPublished(who.facilityId, roster.id).catch((e) => console.warn("Roster notice failed:", e instanceof Error ? e.message : e));
  }
  const fresh = await prisma.roster.findUniqueOrThrow({ where: { id: roster.id } });
  res.json({ roster: presentRoster(fresh), summary: await summaryOf(roster.id) });
});

// ------------------------------------------------------------- versions

rostersRouter.get("/:id/versions", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  const roster = await prisma.roster.findFirst({ where: { id: String(req.params.id), facilityId } });
  if (!roster) return res.status(404).json({ error: "not_found" });
  const rows = await prisma.rosterVersionSnapshot.findMany({ where: { rosterId: roster.id }, orderBy: { version: "desc" }, select: { id: true, version: true, createdAt: true, createdBy: true, reason: true } });
  res.json({ current: roster.version, versions: rows });
});

rostersRouter.post("/:id/versions/:versionId/restore", allowRoles(...ROSTER_ROLES), async (req, res) => {
  const who = caller(req);
  const roster = await prisma.roster.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!roster) return res.status(404).json({ error: "not_found" });
  if (!EDITABLE.includes(roster.status)) return res.status(409).json({ error: "roster_locked", message: `The ${monthName(roster)} roster is ${STATUS_SAY[roster.status]}. Reopen it before restoring an earlier version.` });
  const snap = await prisma.rosterVersionSnapshot.findFirst({ where: { id: String(req.params.versionId), rosterId: roster.id } });
  if (!snap) return res.status(404).json({ error: "not_found" });
  const restoreInput = parseOr400(z.object({ reason: z.string().trim().min(5, "Say why, in a few words.").max(300) }), req.body, res);
  if (!restoreInput) return;

  const saved = snap.assignments as { staffId: string; shiftId: string; dutyDate: string; source: "GENERATED" | "MANUAL" | "SWAP" | "COVER" | "REST_BLOCK"; locked: boolean }[];
  const [staff, shifts] = await Promise.all([
    prisma.staff.findMany({ where: { facilityId: who.facilityId }, select: { id: true } }),
    prisma.shift.findMany({ where: { facilityId: who.facilityId }, select: { id: true } }),
  ]);
  const okStaff = new Set(staff.map((x) => x.id));
  const okShift = new Set(shifts.map((x) => x.id));
  const rows = saved.filter((a) => okStaff.has(a.staffId) && okShift.has(a.shiftId));

  const version = roster.version + 1;
  let loose: { name: string; date: Date }[] = [];
  await prisma.$transaction(
    async (tx) => {
      await saveVersion(tx, roster.id, version, who.email, `Before restoring version ${snap.version}`);
      await detachAttendance(tx, { rosterId: roster.id });
      await tx.rosterAssignment.deleteMany({ where: { rosterId: roster.id } });
      await tx.rosterAssignment.createMany({
        data: rows.map((a) => ({ rosterId: roster.id, facilityId: who.facilityId, staffId: a.staffId, shiftId: a.shiftId, dutyDate: new Date(`${a.dutyDate}T00:00:00Z`), source: a.source, locked: a.locked })),
      });
      loose = await relinkAttendance(tx, roster.id);
      await tx.roster.update({ where: { id: roster.id }, data: { version } });
    },
    { timeout: 30_000, maxWait: 10_000 }
  );
  await flagReview(who, roster, loose);
  const data = await loadEngineData(who.facilityId, roster.id, roster.year, roster.month);
  const findings = checkOf(data, data.current);
  const blocking = findings.filter((f) => f.severity === "BLOCK").length;
  await prisma.$transaction(async (tx) => {
    await storeFindings(tx, roster.id, who.facilityId, findings);
    await tx.roster.update({ where: { id: roster.id }, data: { hasUnresolvedConflicts: blocking > 0 } });
  });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "roster_version_restored", entityType: "Roster", entityId: roster.id,
    summary: `${who.displayName} restored version ${snap.version} of the ${monthName(roster)} roster. The roster as it was before is saved as version ${version}. Reason: ${restoreInput.reason}`,
    reason: restoreInput.reason,
  });
  res.json({ summary: await summaryOf(roster.id), skipped: saved.length - rows.length });
});
