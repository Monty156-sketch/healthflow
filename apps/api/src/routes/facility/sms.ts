// Text messages for a facility: whether they are on, what was sent, and who
// cannot be reached. Turning them on is the facility administrator's decision
// because every text costs money and reaches a person's own phone.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { normalisePhone, smsConfigured } from "../../lib/sms.js";
import { allowRoles, caller, ADMIN_ROLES } from "../../middleware/facilityAccess.js";

export const smsRouter = Router();

smsRouter.get("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [facility, recent, sent30, failed30, staff] = await Promise.all([
    prisma.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { smsEnabled: true } }),
    prisma.smsMessage.findMany({ where: { facilityId }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.smsMessage.count({ where: { facilityId, status: "SENT", createdAt: { gte: since } } }),
    prisma.smsMessage.count({ where: { facilityId, status: "FAILED", createdAt: { gte: since } } }),
    prisma.staff.findMany({ where: { facilityId, status: { in: ["ACTIVE", "ON_LEAVE"] } }, select: { phone: true, smsOptOut: true } }),
  ]);
  const names = new Map((await prisma.staff.findMany({ where: { id: { in: recent.map((r) => r.staffId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((s) => [s.id, s.fullName]));
  res.json({
    configured: smsConfigured(),
    enabled: facility.smsEnabled,
    sent30,
    failed30,
    reachable: staff.filter((s) => !s.smsOptOut && normalisePhone(s.phone)).length,
    withoutNumber: staff.filter((s) => !normalisePhone(s.phone)).length,
    optedOut: staff.filter((s) => s.smsOptOut).length,
    recent: recent.map((r) => ({ id: r.id, at: r.createdAt, staff: r.staffId ? names.get(r.staffId) ?? null : null, type: r.type, body: r.body, status: r.status, error: r.error })),
  });
});

smsRouter.put("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(z.object({ enabled: z.boolean() }), req.body, res);
  if (!input) return;
  if (input.enabled && !smsConfigured()) {
    return res.status(409).json({ error: "not_configured", message: "Text messages are not set up on the server yet. Ask PS Tech to add the SMS key, then turn this on." });
  }
  await prisma.facility.update({ where: { id: who.facilityId }, data: { smsEnabled: input.enabled } });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: input.enabled ? "sms_enabled" : "sms_disabled", entityType: "Facility", entityId: who.facilityId,
    summary: `${who.displayName} turned text messages ${input.enabled ? "on" : "off"} for staff.`,
  });
  res.json({ enabled: input.enabled });
});
