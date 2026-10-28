// WhatsApp duty reminders for a facility: whether they are on, how many people chose them, and what was sent.
// Turning them on is the administrator's decision. Each person then decides for themselves, and only they can.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { normalisePhone } from "../../lib/sms.js";
import { sendWhatsapp, whatsappConfigured } from "../../lib/whatsapp.js";
import { allowRoles, caller, ADMIN_ROLES } from "../../middleware/facilityAccess.js";

export const whatsappRouter = Router();

whatsappRouter.get("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [facility, recent, sent30, failed30, staff] = await Promise.all([
    prisma.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { whatsappEnabled: true } }),
    prisma.whatsappMessage.findMany({ where: { facilityId }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.whatsappMessage.count({ where: { facilityId, status: "SENT", createdAt: { gte: since } } }),
    prisma.whatsappMessage.count({ where: { facilityId, status: "FAILED", createdAt: { gte: since } } }),
    prisma.staff.findMany({ where: { facilityId, status: { in: ["ACTIVE", "ON_LEAVE"] } }, select: { phone: true, whatsappOptIn: true } }),
  ]);
  const names = new Map((await prisma.staff.findMany({ where: { id: { in: recent.map((r) => r.staffId) } }, select: { id: true, fullName: true } })).map((s) => [s.id, s.fullName]));
  res.json({
    configured: whatsappConfigured(),
    enabled: facility.whatsappEnabled,
    optedIn: staff.filter((s) => s.whatsappOptIn && normalisePhone(s.phone)).length,
    withoutNumber: staff.filter((s) => !normalisePhone(s.phone)).length,
    sent30, failed30,
    recent: recent.map((r) => ({ id: r.id, at: r.createdAt, staff: names.get(r.staffId) ?? null, dutyDate: r.dutyDate.toISOString().slice(0, 10), status: r.status, attempts: r.attempts, error: r.error })),
  });
});

whatsappRouter.put("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(z.object({ enabled: z.boolean() }), req.body, res);
  if (!input) return;
  if (input.enabled && !whatsappConfigured()) {
    return res.status(409).json({ error: "not_configured", message: "WhatsApp is not set up on the server yet. Ask PS Tech to add the WhatsApp keys, then turn this on." });
  }
  await prisma.facility.update({ where: { id: who.facilityId }, data: { whatsappEnabled: input.enabled } });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: input.enabled ? "whatsapp_enabled" : "whatsapp_disabled", entityType: "Facility", entityId: who.facilityId,
    summary: `${who.displayName} turned WhatsApp duty reminders ${input.enabled ? "on" : "off"} for staff.`,
  });
  res.json({ enabled: input.enabled });
});

// Proves the template is approved and the keys work: sends one real message to a number the administrator types.
whatsappRouter.post("/test", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(z.object({ phone: z.string().trim().min(1, "Enter a phone number.") }), req.body, res);
  if (!input) return;
  if (!whatsappConfigured()) return res.status(409).json({ error: "not_configured", message: "WhatsApp is not set up on the server yet." });
  const to = normalisePhone(input.phone);
  if (!to) return res.status(400).json({ error: "invalid_input", fields: { phone: "Enter a Ghana mobile number, such as 024 123 4567." } });
  const facility = await prisma.facility.findUniqueOrThrow({ where: { id: who.facilityId }, select: { name: true } });
  const result = await sendWhatsapp(to, ["there", "a test shift", facility.name]);
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "whatsapp_test_sent", entityType: "Facility", entityId: who.facilityId, summary: `${who.displayName} sent a test WhatsApp message${result.ok ? "" : ", which failed"}.` });
  if (!result.ok) return res.status(502).json({ error: "send_failed", message: result.error ?? "The message was not sent." });
  res.json({ ok: true });
});
