// How many people a ward needs on each shift. A hospital keeps one roster per
// ward, and a ward is far smaller than the facility, so its minimums are its
// own. A shift with no ward figure uses the facility's.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { allowRoles, caller, READ_ROLES } from "../../middleware/facilityAccess.js";

export const wardDemandRouter = Router();
const WRITE_ROLES = ["FACILITY_ADMIN", "ROSTER_MANAGER"] as const;

async function ward(req: Parameters<typeof caller>[0], id: string) {
  const who = caller(req);
  if (who.departmentId && who.departmentId !== id) return null;
  return prisma.department.findFirst({ where: { id, facilityId: who.facilityId }, select: { id: true, name: true, kind: true } });
}

wardDemandRouter.get("/:departmentId", allowRoles(...READ_ROLES), async (req, res) => {
  const who = caller(req);
  const dept = await ward(req, String(req.params.departmentId));
  if (!dept) return res.status(404).json({ error: "not_found" });
  const [shifts, rows] = await Promise.all([
    prisma.shift.findMany({ where: { facilityId: who.facilityId, active: true, countsAsDuty: true, isOnCall: false }, orderBy: { sortOrder: "asc" } }),
    prisma.shiftDemand.findMany({ where: { departmentId: dept.id } }),
  ]);
  res.json({
    department: dept,
    shifts: shifts.map((s) => {
      const own = rows.find((r) => r.shiftId === s.id);
      // A support unit (security, drivers, cleaners) starts from nobody, not from the wards' numbers.
      const src = own ?? (dept.kind === "SUPPORT" ? { minStaff: 0, weekendMinStaff: null, holidayMinStaff: null } : s);
      return {
        shiftId: s.id, code: s.code, name: s.name, minStaff: src.minStaff, weekendMinStaff: src.weekendMinStaff, holidayMinStaff: src.holidayMinStaff,
        custom: Boolean(own), facilityMinStaff: s.minStaff, facilityWeekendMinStaff: s.weekendMinStaff, facilityHolidayMinStaff: s.holidayMinStaff,
      };
    }),
  });
});

const count = z.number({ invalid_type_error: "Enter a whole number." }).int("Enter a whole number.").min(0, "Cannot be negative.").max(200, "That is more than a ward can need.");

const putInput = z.object({
  shifts: z.array(z.object({
    shiftId: z.string(),
    minStaff: count,
    /** Blank means the same as weekdays. */
    weekendMinStaff: count.nullish(),
    /** Blank means the weekend number, or the weekday number when there is none. */
    holidayMinStaff: count.nullish(),
  })).max(50),
});

wardDemandRouter.put("/:departmentId", allowRoles(...WRITE_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(putInput, req.body, res);
  if (!input) return;
  const dept = await ward(req, String(req.params.departmentId));
  if (!dept) return res.status(404).json({ error: "not_found" });
  const shifts = await prisma.shift.findMany({ where: { facilityId: who.facilityId, id: { in: input.shifts.map((s) => s.shiftId) } }, select: { id: true, code: true } });
  const known = new Set(shifts.map((s) => s.id));
  for (const s of input.shifts) {
    if (!known.has(s.shiftId)) continue;
    await prisma.shiftDemand.upsert({
      where: { departmentId_shiftId: { departmentId: dept.id, shiftId: s.shiftId } },
      create: { facilityId: who.facilityId, departmentId: dept.id, shiftId: s.shiftId, minStaff: s.minStaff, weekendMinStaff: s.weekendMinStaff ?? null, holidayMinStaff: s.holidayMinStaff ?? null },
      update: { minStaff: s.minStaff, minByCadre: {}, weekendMinStaff: s.weekendMinStaff ?? null, holidayMinStaff: s.holidayMinStaff ?? null },
    });
  }
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "ward_demand_set", entityType: "Department", entityId: dept.id,
    summary: `${who.displayName} set the minimum staff for ${dept.name}: ${input.shifts.filter((s) => known.has(s.shiftId)).map((s) => `${shifts.find((x) => x.id === s.shiftId)!.code} ${s.minStaff}${s.weekendMinStaff != null ? ` (weekends ${s.weekendMinStaff})` : ""}${s.holidayMinStaff != null ? ` (holidays ${s.holidayMinStaff})` : ""}`).join(", ")}.`,
  });
  res.json({ ok: true });
});
