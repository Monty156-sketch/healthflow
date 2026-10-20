// Duty cycle rules (Part 3, 1.2 and 1.3): the off-day patterns. "After N
// consecutive duties, give M days off", counted over the shifts the rule
// names. A rule can be turned off or deleted; deleting a starting rule means
// it is not set up again.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400, requiredText } from "../../lib/validate.js";
import { allowRoles, caller, ADMIN_ROLES, READ_ROLES } from "../../middleware/facilityAccess.js";

export const cyclesRouter = Router();

type RuleRow = Awaited<ReturnType<typeof loadRules>>[number];

function loadRules(facilityId: string) {
  return prisma.dutyCycleRule.findMany({
    where: { facilityId },
    include: { countingShifts: { select: { id: true, code: true, isOvernight: true } } },
    orderBy: [{ active: "desc" }, { priority: "asc" }],
  });
}

function present(r: RuleRow) {
  return {
    id: r.id,
    name: r.name,
    countingShiftIds: r.countingShifts.map((s) => s.id),
    /** A night rule counts only overnight shifts; anything else is a day rule. The roster blends the two. */
    kind: (r.countingShifts.length > 0 && r.countingShifts.every((s) => s.isOvernight) ? "NIGHT" : "DAY") as "NIGHT" | "DAY",
    consecutiveDuties: r.consecutiveDuties,
    offDaysRequired: r.offDaysRequired,
    offDaysConsecutive: r.offDaysConsecutive,
    applicableCadreIds: r.applicableCadreIds,
    applicableDepartmentIds: r.applicableDepartmentIds,
    enforcement: r.enforcement,
    priority: r.priority,
    nextShiftAfterRestId: r.nextShiftAfterRestId,
    blockShiftPatternIds: r.blockShiftPatternIds,
    active: r.active,
  };
}

/** Which of the two starting rules a facility gets depends on the shifts it has. */
async function ensureSeeded(facilityId: string) {
  if ((await prisma.dutyCycleRule.count({ where: { facilityId } })) > 0) return;
  // Once a rule has been deleted the facility has chosen its own set; never put the presets back.
  if (await prisma.auditLog.findFirst({ where: { facilityId, action: "cycle_rule_deleted" }, select: { id: true } })) return;
  const shifts = await prisma.shift.findMany({ where: { facilityId, countsAsDuty: true, active: true } });
  if (!shifts.length) return;
  const night = shifts.filter((s) => s.isOvernight);
  const day = shifts.filter((s) => !s.isOvernight && !s.isOnCall);
  const named = (w: string) => day.find((x) => x.name.toLowerCase().includes(w));
  const afternoon = named("afternoon");
  const morning = named("morning");
  const seeds = [
    { name: "4 nights on, 3 off", shifts: night, n: 4, m: 3, after: afternoon?.id ?? null, pattern: [] as string[] },
    { name: "4 days on, 1 off", shifts: day, n: 4, m: 1, after: null, pattern: afternoon && morning ? [afternoon.id, morning.id] : [] },
  ].filter((s) => s.shifts.length > 0);
  let priority = 1;
  for (const s of seeds) {
    await prisma.dutyCycleRule.create({
      data: {
        facilityId,
        name: s.name,
        consecutiveDuties: s.n,
        offDaysRequired: s.m,
        enforcement: "PREFER",
        priority: priority++,
        nextShiftAfterRestId: s.after,
        blockShiftPatternIds: s.pattern,
        countingShifts: { connect: s.shifts.map((x) => ({ id: x.id })) },
      },
    });
  }
}

cyclesRouter.get("/", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  await ensureSeeded(facilityId);
  const [rules, shifts, cadres, departments] = await Promise.all([
    loadRules(facilityId),
    prisma.shift.findMany({ where: { facilityId, countsAsDuty: true, active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, code: true, name: true, colour: true, isOvernight: true } }),
    prisma.cadre.findMany({ where: { facilityId, active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.department.findMany({ where: { facilityId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  res.json({ rules: rules.map(present), shifts, cadres, departments, checks: await cycleChecks(facilityId, rules) });
});

/**
 * Where a cycle asks for something the facility's own rules will not allow. The roster
 * still works, but it quietly shortens the block, so say so and say which number to change.
 */
async function cycleChecks(facilityId: string, rules: RuleRow[]): Promise<string[]> {
  const limits = await prisma.constraintRule.findMany({ where: { facilityId, enabled: true, code: { in: ["C2", "C7", "C8"] } }, select: { code: true, thresholdValue: true } });
  const limit = (code: string) => limits.find((l) => l.code === code)?.thresholdValue ?? null;
  const shifts = await prisma.shift.findMany({ where: { facilityId, active: true, countsAsDuty: true }, select: { id: true, name: true, durationHours: true, isOvernight: true } });
  const out: string[] = [];
  for (const r of rules.filter((x) => x.active)) {
    const counted = shifts.filter((s) => r.countingShifts.some((c) => c.id === s.id));
    if (!counted.length) continue;
    const night = counted.every((s) => s.isOvernight);
    const c8 = limit("C8");
    const c7 = limit("C7");
    const c2 = limit("C2");
    if (night && c8 !== null && r.consecutiveDuties > c8) {
      out.push(`${r.name} asks for ${r.consecutiveDuties} nights in a row, but Maximum consecutive night duties is ${c8}, so the roster plans blocks of ${c8}. Raise that rule to ${r.consecutiveDuties} under Rules, or change this cycle to ${c8} nights.`);
    }
    if (c7 !== null && r.consecutiveDuties > c7) {
      out.push(`${r.name} asks for ${r.consecutiveDuties} duties in a row, but Maximum consecutive duty days is ${c7}, so the roster plans blocks of ${c7}.`);
    }
    const longest = Math.max(...counted.map((s) => s.durationHours));
    const inWeek = Math.min(r.consecutiveDuties, 7);
    if (c2 !== null && longest * inWeek > c2) {
      out.push(`${r.name}: ${inWeek} ${counted.find((s) => s.durationHours === longest)!.name.toLowerCase()} shifts of ${longest} hours come to ${longest * inWeek} hours in a week, above the weekly limit of ${c2}. The roster will not plan a full block. Shorten the block or raise Maximum normal hours per week under Rules.`);
    }
  }
  return out;
}

const cycleInput = z.object({
  name: requiredText(80, "Name"),
  countingShiftIds: z.array(z.string()).min(1, "Choose at least one shift to count."),
  consecutiveDuties: z.number({ invalid_type_error: "Enter a number of duties." }).int("Use a whole number.").min(1, "At least 1.").max(14, "At most 14."),
  offDaysRequired: z.number({ invalid_type_error: "Enter a number of days." }).int("Use a whole number.").min(1, "At least 1.").max(7, "At most 7."),
  offDaysConsecutive: z.boolean().default(true),
  applicableCadreIds: z.array(z.string()).default([]),
  applicableDepartmentIds: z.array(z.string()).default([]),
  enforcement: z.enum(["BLOCK", "PREFER"]),
  nextShiftAfterRestId: z.string().nullable().default(null),
  blockShiftPatternIds: z.array(z.string()).max(14, "At most 14 steps.").default([]),
  priority: z.number().int("Use a whole number.").min(1, "At least 1.").max(99).optional(),
  /** Needed to switch a rule to Block: the facility has chosen which it would rather live with. */
  confirmBlock: z.boolean().optional(),
});

async function validate(
  facilityId: string,
  body: unknown,
  res: import("express").Response,
  existing?: RuleRow
): Promise<null | { input: z.infer<typeof cycleInput>; priority: number }> {
  const input = parseOr400(cycleInput, body, res);
  if (!input) return null;
  const fields: Record<string, string> = {};

  const shifts = await prisma.shift.findMany({ where: { facilityId, id: { in: input.countingShiftIds }, countsAsDuty: true }, select: { id: true } });
  if (shifts.length !== new Set(input.countingShiftIds).size) fields.countingShiftIds = "One of the shifts is not a duty shift in your facility.";
  const ownDuty = async (ids: string[]) =>
    (await prisma.shift.count({ where: { facilityId, id: { in: [...new Set(ids)] }, countsAsDuty: true, active: true } })) === new Set(ids).size;
  if (input.nextShiftAfterRestId && !(await ownDuty([input.nextShiftAfterRestId]))) fields.nextShiftAfterRestId = "That is not a duty shift in your facility.";
  if (input.blockShiftPatternIds.length && !(await ownDuty(input.blockShiftPatternIds))) fields.blockShiftPatternIds = "One of the shifts is not a duty shift in your facility.";
  if (input.applicableCadreIds.length) {
    const n = await prisma.cadre.count({ where: { facilityId, id: { in: input.applicableCadreIds } } });
    if (n !== new Set(input.applicableCadreIds).size) fields.applicableCadreIds = "One of the cadres is not in your facility.";
  }
  if (input.applicableDepartmentIds.length) {
    const n = await prisma.department.count({ where: { facilityId, id: { in: input.applicableDepartmentIds } } });
    if (n !== new Set(input.applicableDepartmentIds).size) fields.applicableDepartmentIds = "One of the departments is not in your facility.";
  }

  let priority = input.priority;
  if (priority === undefined) {
    priority = existing?.priority ?? ((await prisma.dutyCycleRule.aggregate({ where: { facilityId }, _max: { priority: true } }))._max.priority ?? 0) + 1;
  } else {
    const clash = await prisma.dutyCycleRule.findFirst({
      where: { facilityId, active: true, priority, ...(existing ? { id: { not: existing.id } } : {}) },
      select: { name: true },
    });
    if (clash) fields.priority = `"${clash.name}" already has priority ${priority}. When two rules fire together the lower number wins, so each needs its own.`;
  }

  if (input.enforcement === "BLOCK" && existing?.enforcement !== "BLOCK" && !input.confirmBlock) {
    res.status(409).json({
      error: "block_confirm_needed",
      message:
        "Block makes the off days mandatory: in a thin month the roster leaves a shift unfilled rather than break this pattern. Confirm that you would rather have an uncovered shift than an irregular roster.",
    });
    return null;
  }
  if (Object.keys(fields).length) {
    res.status(400).json({ error: "invalid_input", fields });
    return null;
  }
  return { input, priority };
}

function describe(r: { consecutiveDuties: number; offDaysRequired: number; enforcement: string }) {
  return `after ${r.consecutiveDuties} consecutive ${r.consecutiveDuties === 1 ? "duty" : "duties"}, ${r.offDaysRequired} ${r.offDaysRequired === 1 ? "day" : "days"} off, ${r.enforcement === "BLOCK" ? "enforced" : "preferred"}`;
}

cyclesRouter.post("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const ok = await validate(who.facilityId, req.body, res);
  if (!ok) return;
  const { input, priority } = ok;
  const rule = await prisma.dutyCycleRule.create({
    data: {
      facilityId: who.facilityId,
      name: input.name,
      consecutiveDuties: input.consecutiveDuties,
      offDaysRequired: input.offDaysRequired,
      offDaysConsecutive: input.offDaysConsecutive,
      applicableCadreIds: input.applicableCadreIds,
      applicableDepartmentIds: input.applicableDepartmentIds,
      enforcement: input.enforcement,
      priority,
      nextShiftAfterRestId: input.nextShiftAfterRestId,
      blockShiftPatternIds: input.blockShiftPatternIds,
      countingShifts: { connect: input.countingShiftIds.map((id) => ({ id })) },
    },
    include: { countingShifts: { select: { id: true, code: true, isOvernight: true } } },
  });
  await writeAuditLog({
    facilityId: who.facilityId,
    actorEmail: who.email,
    action: "cycle_rule_created",
    entityType: "DutyCycleRule",
    entityId: rule.id,
    after: present(rule),
    summary: `${who.displayName} added the duty cycle rule "${rule.name}": ${describe(rule)}, counting ${rule.countingShifts.map((s) => s.code).join(", ")}.`,
  });
  res.status(201).json({ rule: present(rule) });
});

cyclesRouter.patch("/:id", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const existing = (await loadRules(who.facilityId)).find((r) => r.id === String(req.params.id));
  if (!existing) return res.status(404).json({ error: "not_found" });
  const ok = await validate(who.facilityId, req.body, res, existing);
  if (!ok) return;
  const { input, priority } = ok;
  const rule = await prisma.dutyCycleRule.update({
    where: { id: existing.id },
    data: {
      name: input.name,
      consecutiveDuties: input.consecutiveDuties,
      offDaysRequired: input.offDaysRequired,
      offDaysConsecutive: input.offDaysConsecutive,
      applicableCadreIds: input.applicableCadreIds,
      applicableDepartmentIds: input.applicableDepartmentIds,
      enforcement: input.enforcement,
      priority,
      nextShiftAfterRestId: input.nextShiftAfterRestId,
      blockShiftPatternIds: input.blockShiftPatternIds,
      countingShifts: { set: input.countingShiftIds.map((id) => ({ id })) },
    },
    include: { countingShifts: { select: { id: true, code: true, isOvernight: true } } },
  });
  const before = present(existing);
  const after = present(rule);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    await writeAuditLog({
      facilityId: who.facilityId,
      actorEmail: who.email,
      action: "cycle_rule_updated",
      entityType: "DutyCycleRule",
      entityId: rule.id,
      before,
      after,
      summary: `${who.displayName} changed the duty cycle rule "${existing.name}" from ${describe(existing)} to ${describe(rule)}${
        rule.name !== existing.name ? `, and renamed it "${rule.name}"` : ""
      }.`,
    });
  }
  res.json({ rule: after });
});

cyclesRouter.patch("/:id/active", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(z.object({ active: z.boolean() }), req.body, res);
  if (!input) return;
  const existing = (await loadRules(who.facilityId)).find((r) => r.id === String(req.params.id));
  if (!existing) return res.status(404).json({ error: "not_found" });
  if (input.active) {
    const clash = await prisma.dutyCycleRule.findFirst({ where: { facilityId: who.facilityId, active: true, priority: existing.priority, id: { not: existing.id } }, select: { name: true } });
    if (clash) {
      return res.status(409).json({ error: "priority_taken", message: `"${clash.name}" already has priority ${existing.priority}. Change one of the priorities first.` });
    }
  }
  const rule = await prisma.dutyCycleRule.update({
    where: { id: existing.id },
    data: { active: input.active },
    include: { countingShifts: { select: { id: true, code: true, isOvernight: true } } },
  });
  await writeAuditLog({
    facilityId: who.facilityId,
    actorEmail: who.email,
    action: input.active ? "cycle_rule_reactivated" : "cycle_rule_deactivated",
    entityType: "DutyCycleRule",
    entityId: rule.id,
    summary: `${who.displayName} ${input.active ? "turned on" : "turned off"} the duty cycle rule "${rule.name}".`,
  });
  res.json({ rule: present(rule) });
});

cyclesRouter.delete("/:id", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const existing = (await loadRules(who.facilityId)).find((r) => r.id === String(req.params.id));
  if (!existing) return res.status(404).json({ error: "not_found" });
  await prisma.dutyCycleRule.delete({ where: { id: existing.id } });
  await writeAuditLog({
    facilityId: who.facilityId,
    actorEmail: who.email,
    action: "cycle_rule_deleted",
    entityType: "DutyCycleRule",
    entityId: existing.id,
    summary: `${who.displayName} deleted the duty cycle rule "${existing.name}".`,
  });
  res.json({ ok: true });
});

// ------------------------------------------------------------- capacity check

/**
 * Per cadre: can the staff there cover what the shifts require this month,
 * given the most restrictive off-day rule that applies to them?
 *
 *   density = N / (N + M)            for the most restrictive applicable rule
 *   supply  = active staff x days in month x density
 *   demand  = sum of the cadre's minimum across duty shifts x days in month
 *
 * A bound, not a simulation: it ignores leave and individual eligibility, so
 * it is optimistic in a month with heavy leave.
 */
cyclesRouter.get("/capacity", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  const month = typeof req.query.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();

  await ensureSeeded(facilityId);
  const [rules, shifts, cadres, staff] = await Promise.all([
    prisma.dutyCycleRule.findMany({ where: { facilityId, active: true } }),
    prisma.shift.findMany({ where: { facilityId, countsAsDuty: true, active: true } }),
    prisma.cadre.findMany({ where: { facilityId, active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.staff.findMany({ where: { facilityId, status: "ACTIVE" }, select: { cadreId: true, departmentId: true } }),
  ]);

  const out = [];
  for (const c of cadres) {
    const perDay = shifts.reduce((sum, s) => sum + ((s.minByCadre as Record<string, number>)[c.id] ?? 0), 0);
    if (perDay === 0) continue;
    const staffCount = staff.filter((s) => s.cadreId === c.id).length;
    const applicable = rules.filter((r) => !r.applicableCadreIds.length || r.applicableCadreIds.includes(c.id));
    const density = (r: { consecutiveDuties: number; offDaysRequired: number }) => r.consecutiveDuties / (r.consecutiveDuties + r.offDaysRequired);
    const strictest = applicable.length ? applicable.reduce((a, b) => (density(b) < density(a) ? b : a)) : null;
    const d = strictest ? density(strictest) : 1;
    const supply = staffCount * days * d;
    const demand = perDay * days;
    const achievable = Math.round(supply) >= demand;

    let staffNeeded = 0;
    let suggestion: { consecutiveDuties: number; offDaysRequired: number } | null = null;
    if (!achievable) {
      staffNeeded = Math.max(1, Math.ceil(demand / (days * d)) - staffCount);
      if (strictest) {
        for (let off = strictest.offDaysRequired - 1; off >= 1; off--) {
          if (staffCount * days * (strictest.consecutiveDuties / (strictest.consecutiveDuties + off)) >= demand) {
            suggestion = { consecutiveDuties: strictest.consecutiveDuties, offDaysRequired: off };
            break;
          }
        }
      }
    }
    out.push({
      cadreId: c.id,
      cadreName: c.name,
      staffCount,
      rule: strictest ? { id: strictest.id, name: strictest.name, consecutiveDuties: strictest.consecutiveDuties, offDaysRequired: strictest.offDaysRequired } : null,
      supply: Math.round(supply),
      demand,
      shortBy: achievable ? 0 : demand - Math.round(supply),
      achievable,
      staffNeeded,
      suggestion,
    });
  }
  res.json({ month, daysInMonth: days, cadres: out });
});
