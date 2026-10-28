// Weekly rosters, from the Emergency roster screen. The facility administrator and
// roster managers draw them; a ward in-charge reaches only their own unit.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { parseOr400 } from "../../lib/validate.js";
import { todayDay } from "../../lib/leaveWindow.js";
import { rostersByUnit } from "../../lib/unitDemand.js";
import { drawWeek, weekView, WeekProblem } from "../../lib/weeklyRoster.js";
import { allowRoles, caller } from "../../middleware/facilityAccess.js";
import { WARD_FACILITY_TYPES } from "./rosters.js";

export const weeklyRostersRouter = Router();
const ROLES = ["FACILITY_ADMIN", "ROSTER_MANAGER"] as const;
const DAY = 86_400_000;

const isoDate = z.string().trim().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) === v, "Choose a real date.");
const weekInput = z.object({ departmentId: z.string().trim().nullish().transform((v) => v || null), startDate: isoDate, variation: z.number().int().min(0).max(999_999).optional() });
const dayOfIso = (v: string) => Math.floor(new Date(`${v}T00:00:00.000Z`).getTime() / DAY);

/** The units this person may draw a week for. A facility with one roster for everyone has a single, unnamed choice. */
async function scope(req: Parameters<typeof caller>[0]) {
  const who = caller(req);
  const f = await prisma.facility.findUniqueOrThrow({ where: { id: who.facilityId }, select: { facilityType: true } });
  const byUnit = await rostersByUnit(who.facilityId, f.facilityType, WARD_FACILITY_TYPES);
  const departments = byUnit
    ? await prisma.department.findMany({ where: { facilityId: who.facilityId, active: true, kind: { not: "OFFICE" }, ...(who.departmentId ? { id: who.departmentId } : {}) }, orderBy: { name: "asc" }, select: { id: true, name: true } })
    : [];
  return { who, byUnit, departments };
}

weeklyRostersRouter.get("/units", allowRoles(...ROLES), async (req, res) => {
  const { byUnit, departments } = await scope(req);
  res.json({ byUnit, departments });
});

/** Resolves the unit asked for against what this person may reach. Returns null after answering with an error. */
async function unitFor(req: Parameters<typeof caller>[0], res: import("express").Response, wanted: string | null) {
  const { who, byUnit, departments } = await scope(req);
  if (!byUnit) return { who, departmentId: null as string | null };
  const id = who.departmentId ?? wanted;
  if (!id) { res.status(400).json({ error: "invalid_input", fields: { departmentId: "Choose the unit." }, message: "Choose the unit." }); return null; }
  if (!departments.some((d) => d.id === id)) { res.status(404).json({ error: "not_found" }); return null; }
  return { who, departmentId: id };
}

weeklyRostersRouter.get("/", allowRoles(...ROLES), async (req, res) => {
  const input = parseOr400(weekInput, { departmentId: req.query.departmentId, startDate: req.query.startDate }, res);
  if (!input) return;
  const unit = await unitFor(req, res, input.departmentId);
  if (!unit) return;
  res.json({ week: await weekView(unit.who.facilityId, unit.departmentId, dayOfIso(input.startDate)) });
});

weeklyRostersRouter.post("/", allowRoles(...ROLES), async (req, res) => {
  const input = parseOr400(weekInput, req.body, res);
  if (!input) return;
  const from = dayOfIso(input.startDate);
  if (from < todayDay()) return res.status(400).json({ error: "invalid_input", fields: { startDate: "Start today or later." } });
  if (from > todayDay() + 120) return res.status(400).json({ error: "invalid_input", fields: { startDate: "Choose a date within the next four months." } });
  const unit = await unitFor(req, res, input.departmentId);
  if (!unit) return;
  try {
    const week = await drawWeek(unit.who.facilityId, unit.departmentId, from, { email: unit.who.email, displayName: unit.who.displayName }, input.variation);
    res.status(201).json({ week });
  } catch (e) {
    if (e instanceof WeekProblem) return res.status(e.status).json({ error: e.code, message: e.message });
    throw e;
  }
});
