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

// People with a phone number but no login of their own. They cannot switch reminders on themselves, so the administrator records
// that the person agreed, and the record says who recorded it. A person with a login is never listed: that choice stays theirs.
whatsappRouter.get("/people", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  const logins = await prisma.userProfile.findMany({ where: { facilityId, active: true, staffId: { not: null } }, select: { staffId: true } });
  const withLogin = new Set(logins.map((l) => l.staffId));
  const staff = await prisma.staff.findMany({ where: { facilityId, status: "ACTIVE" }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, staffNo: true, phone: true, whatsappOptIn: true } });
  res.json({ people: staff.filter((s) => !withLogin.has(s.id) && normalisePhone(s.phone)).map((s) => ({ id: s.id, name: s.fullName, staffNo: s.staffNo, optIn: s.whatsappOptIn })) });
});

whatsappRouter.put("/people/:staffId", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(z.object({ optIn: z.boolean() }), req.body, res);
  if (!input) return;
  const staff = await prisma.staff.findFirst({ where: { id: String(req.params.staffId), facilityId: who.facilityId, status: "ACTIVE" }, select: { id: true, fullName: true, phone: true } });
  if (!staff) return res.status(404).json({ error: "not_found" });
  if ((await prisma.userProfile.count({ where: { facilityId: who.facilityId, staffId: staff.id, active: true } })) > 0) {
    return res.status(409).json({ error: "has_login", message: `${staff.fullName} has their own login, so only they can choose this.` });
  }
  if (input.optIn && !normalisePhone(staff.phone)) return res.status(409).json({ error: "no_number", message: `${staff.fullName} has no usable mobile number.` });
  await prisma.staff.update({ where: { id: staff.id }, data: { whatsappOptIn: input.optIn, whatsappOptInAt: input.optIn ? new Date() : null } });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "whatsapp_opt_in_recorded", entityType: "Staff", entityId: staff.id,
    summary: input.optIn ? `${who.displayName} recorded that ${staff.fullName}, who has no login, agreed to WhatsApp duty reminders.` : `${who.displayName} recorded that ${staff.fullName} no longer wants WhatsApp duty reminders.`,
  });
  res.json({ optIn: input.optIn });
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
