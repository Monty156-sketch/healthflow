// Constraint rules (Part 3, 1.2): the twelve rules the roster is checked
// against. They are seeded for every facility, never deleted, and what can
// be changed depends on the rule's type:
//   statutory  threshold only, and only after confirming the warning
//   logical    nothing (C6 and C9 are facts, not choices)
//   policy and facility rules  threshold, warn or block, on or off
//   fairness   threshold and on/off
import { Router } from "express";
import { z } from "zod";
import type { RuleBehaviour, RuleType } from "@healthflow/db";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { allowRoles, caller, ADMIN_ROLES, READ_ROLES } from "../../middleware/facilityAccess.js";

export const rulesRouter = Router();

interface Seed {
  code: string;
  name: string;
  ruleType: RuleType;
  thresholdValue: number | null;
  unit: string | null;
  behaviour: RuleBehaviour;
  overridable: boolean;
  description: string;
  min?: number;
  max?: number;
}

export const RULE_SEEDS: Seed[] = [
  { code: "C1", name: "Maximum normal hours per day", ruleType: "STATUTORY", thresholdValue: 8, unit: "hours", behaviour: "WARN", overridable: true, min: 1, max: 24,
    description: "Flags a day's duties that add up to more than this many hours." },
  { code: "C2", name: "Maximum normal hours per week", ruleType: "STATUTORY", thresholdValue: 40, unit: "hours", behaviour: "WARN", overridable: true, min: 1, max: 168,
    description: "Flags any rolling seven days that add up to more than this many hours." },
  { code: "C3", name: "Weekly consecutive rest", ruleType: "STATUTORY", thresholdValue: 48, unit: "hours", behaviour: "BLOCK", overridable: true, min: 24, max: 168,
    description: "Every seven days must contain an unbroken rest of at least this many hours." },
  { code: "C4", name: "Reference-period average weekly hours", ruleType: "STATUTORY", thresholdValue: 40, unit: "hours", behaviour: "WARN", overridable: true, min: 1, max: 168,
    description: "Average weekly hours over the facility's reference period must stay within this limit." },
  { code: "C5", name: "Minimum rest between shifts", ruleType: "POLICY", thresholdValue: 11, unit: "hours", behaviour: "BLOCK", overridable: true, min: 1, max: 24,
    description: "The gap between the end of one shift and the start of the next." },
  { code: "C6", name: "Physically impossible sequence", ruleType: "LOGICAL", thresholdValue: 0, unit: "hours", behaviour: "BLOCK", overridable: false,
    description: "Two shifts that overlap, such as a morning shift the day after a night shift that ends at 08:00 the same morning." },
  { code: "C7", name: "Maximum consecutive duty days", ruleType: "POLICY", thresholdValue: 6, unit: "days", behaviour: "WARN", overridable: true, min: 1, max: 31,
    description: "Flags more than this many duty days in a row." },
  { code: "C8", name: "Maximum consecutive night duties", ruleType: "POLICY", thresholdValue: 4, unit: "shifts", behaviour: "WARN", overridable: true, min: 1, max: 31,
    description: "Flags more than this many night duties in a row." },
  { code: "C9", name: "Assignment during approved leave", ruleType: "LOGICAL", thresholdValue: null, unit: null, behaviour: "BLOCK", overridable: false,
    description: "Nobody can be rostered on a day of approved leave." },
  { code: "C10", name: "Cadre or staff not eligible for shift", ruleType: "FACILITY", thresholdValue: null, unit: null, behaviour: "BLOCK", overridable: true,
    description: "The person's cadre, or their own shift list, does not allow this shift." },
  { code: "C11", name: "Minimum staffing per shift", ruleType: "FACILITY", thresholdValue: null, unit: null, behaviour: "BLOCK", overridable: true,
    description: "A shift has fewer people than its minimum, or fewer of a cadre than that cadre's minimum." },
  { code: "C12", name: "Night duty distribution", ruleType: "FAIRNESS", thresholdValue: 1, unit: "standard deviations", behaviour: "OPTIMISE", overridable: false, min: 0.1, max: 5,
    description: "Spreads night duties evenly. Used when generating a roster, not reported as a finding." },
];

const SEED_BY_CODE = new Map(RULE_SEEDS.map((s) => [s.code, s]));

export async function ensureRules(facilityId: string) {
  const have = await prisma.constraintRule.findMany({ where: { facilityId }, select: { code: true } });
  const haveCodes = new Set(have.map((r) => r.code));
  const missing = RULE_SEEDS.filter((s) => !haveCodes.has(s.code));
  if (!missing.length) return;
  await prisma.constraintRule.createMany({
    data: missing.map(({ min: _min, max: _max, ...s }) => ({ ...s, facilityId })),
    skipDuplicates: true,
  });
}

function present(r: Awaited<ReturnType<typeof prisma.constraintRule.findFirstOrThrow>>) {
  const seed = SEED_BY_CODE.get(r.code);
  return {
    code: r.code,
    name: r.name,
    ruleType: r.ruleType,
    thresholdValue: r.thresholdValue,
    unit: r.unit,
    behaviour: r.behaviour,
    overridable: r.overridable,
    enabled: r.enabled,
    description: r.description,
    // What can be changed: drives which controls the screen shows.
    editable: {
      threshold: r.ruleType !== "LOGICAL" && r.thresholdValue !== null,
      behaviour: r.ruleType === "POLICY" || r.ruleType === "FACILITY",
      enabled: r.ruleType !== "LOGICAL" && r.ruleType !== "STATUTORY",
    },
    range: seed?.min !== undefined ? { min: seed.min, max: seed.max } : null,
    standard: seed?.thresholdValue ?? null,
  };
}

const ORDER = RULE_SEEDS.map((s) => s.code);

rulesRouter.get("/", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  await ensureRules(facilityId);
  const rows = await prisma.constraintRule.findMany({ where: { facilityId } });
  rows.sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code));
  res.json({ rules: rows.map(present) });
});

const BEHAVIOUR_WORD: Record<string, string> = { BLOCK: "block", WARN: "warn", OPTIMISE: "optimise" };

const ruleInput = z.object({
  thresholdValue: z.number({ invalid_type_error: "Enter a number." }).optional(),
  behaviour: z.enum(["BLOCK", "WARN"]).optional(),
  enabled: z.boolean().optional(),
  /** Required to change a statutory threshold: the person has seen the warning. */
  confirmStatutory: z.boolean().optional(),
  reason: z.string().trim().max(300).nullish(),
});

rulesRouter.patch("/:code", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(ruleInput, req.body, res);
  if (!input) return;
  await ensureRules(who.facilityId);
  const rule = await prisma.constraintRule.findUnique({ where: { facilityId_code: { facilityId: who.facilityId, code: String(req.params.code) } } });
  if (!rule) return res.status(404).json({ error: "not_found" });
  const meta = present(rule);
  const seed = SEED_BY_CODE.get(rule.code)!;

  const refuse = (message: string) => res.status(409).json({ error: "rule_locked", message });
  if (rule.ruleType === "LOGICAL") return refuse(`${rule.code} is a fact about time and leave, not a choice, so it cannot be changed or turned off.`);
  if (input.thresholdValue !== undefined && !meta.editable.threshold) return refuse(`${rule.code} has no threshold to change.`);
  if (input.behaviour !== undefined && !meta.editable.behaviour) {
    return refuse(`${rule.code} is a ${rule.ruleType === "STATUTORY" ? "statutory" : "fairness"} rule, so only its threshold can change.`);
  }
  if (input.enabled === false && !meta.editable.enabled) {
    return refuse(`${rule.code} is ${rule.ruleType === "STATUTORY" ? "a statutory rule and cannot be turned off" : "fixed and cannot be turned off"}.`);
  }

  if (input.thresholdValue !== undefined) {
    const { min, max } = seed;
    if (min !== undefined && max !== undefined && (input.thresholdValue < min || input.thresholdValue > max)) {
      return res.status(400).json({ error: "invalid_input", fields: { thresholdValue: `Use a value from ${min} to ${max} ${rule.unit ?? ""}.`.trim() } });
    }
  }
  const thresholdChanged = input.thresholdValue !== undefined && input.thresholdValue !== rule.thresholdValue;
  if (rule.ruleType === "STATUTORY" && thresholdChanged) {
    if (!input.confirmStatutory) {
      return res.status(409).json({
        error: "statutory_confirm_needed",
        message: `${rule.code} comes from the Labour Act. Change it only on the advice of a qualified labour law practitioner, and say what that advice was.`,
      });
    }
    if (!input.reason) {
      return res.status(400).json({ error: "invalid_input", fields: { reason: "Record the advice this change is based on." } });
    }
  }

  const updated = await prisma.constraintRule.update({
    where: { id: rule.id },
    data: {
      ...(input.thresholdValue !== undefined ? { thresholdValue: input.thresholdValue } : {}),
      ...(input.behaviour !== undefined ? { behaviour: input.behaviour } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    },
  });

  const parts: string[] = [];
  if (thresholdChanged) parts.push(`threshold from ${rule.thresholdValue} to ${updated.thresholdValue} ${rule.unit ?? ""}`.trim());
  if (updated.behaviour !== rule.behaviour) parts.push(`behaviour from ${BEHAVIOUR_WORD[rule.behaviour]} to ${BEHAVIOUR_WORD[updated.behaviour]}`);
  if (updated.enabled !== rule.enabled) parts.push(updated.enabled ? "turned it on" : "turned it off");
  if (parts.length) {
    await writeAuditLog({
      facilityId: who.facilityId,
      actorEmail: who.email,
      action: "rule_updated",
      entityType: "ConstraintRule",
      entityId: rule.id,
      before: { thresholdValue: rule.thresholdValue, behaviour: rule.behaviour, enabled: rule.enabled },
      after: { thresholdValue: updated.thresholdValue, behaviour: updated.behaviour, enabled: updated.enabled },
      reason: rule.ruleType === "STATUTORY" && thresholdChanged ? input.reason : null,
      summary: `${who.displayName} changed rule ${rule.code} (${rule.name}): ${parts.join("; ")}.${
        rule.ruleType === "STATUTORY" && thresholdChanged && input.reason ? ` Advice recorded: ${input.reason}` : ""
      }`,
    });
  }
  res.json({ rule: present(updated) });
});
