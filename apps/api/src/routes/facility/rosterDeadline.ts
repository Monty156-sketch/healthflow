// The roster publishing deadline: set by the administrator, and a view of where each roster stands against it.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { allowRoles, caller, ADMIN_ROLES, READ_ROLES } from "../../middleware/facilityAccess.js";
import { standing, targets, unitsOf } from "../../lib/rosterDeadline.js";

export const rosterDeadlineRouter = Router();

rosterDeadlineRouter.get("/", allowRoles(...READ_ROLES), async (req, res) => {
  const who = caller(req);
  const f = await prisma.facility.findUniqueOrThrow({ where: { id: who.facilityId }, select: { facilityType: true, rosterDeadlineDay: true } });
  if (f.rosterDeadlineDay === null) return res.json({ day: null, standing: [], late: [] });
  let units = await unitsOf(who.facilityId, f.facilityType);
  if (who.departmentId) units = units.filter((u) => u.departmentId === who.departmentId);
  const rows = [];
  for (const t of targets()) for (const u of units) rows.push(await standing(who.facilityId, u, t.year, t.month, f.rosterDeadlineDay));
  const late = await prisma.roster.findMany({
    where: { facilityId: who.facilityId, publishedLate: true, ...(who.departmentId ? { departmentId: who.departmentId } : {}) },
    orderBy: { publishedAt: "desc" }, take: 12, select: { year: true, month: true, publishedAt: true, department: { select: { name: true } } },
  });
  res.json({
    day: f.rosterDeadlineDay,
    standing: rows,
    late: late.map((r) => ({ unit: r.department?.name ?? "Facility", year: r.year, month: r.month, publishedAt: r.publishedAt?.toISOString() ?? null })),
  });
});

rosterDeadlineRouter.put("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(z.object({ day: z.number().int("Use a whole number.").min(1, "Use a day from 1 to 28.").max(28, "Use a day from 1 to 28.").nullable() }), req.body, res);
  if (!input) return;
  await prisma.facility.update({ where: { id: who.facilityId }, data: { rosterDeadlineDay: input.day } });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "roster_deadline_set", entityType: "Facility", entityId: who.facilityId,
    summary: input.day === null ? `${who.displayName} removed the roster publishing deadline.` : `${who.displayName} set the roster publishing deadline to day ${input.day} of the month before.`,
  });
  res.json({ ok: true, day: input.day });
});
