// The public front door: an access request, and the plans a visitor can read.
// An access request does three things, all required: it is written as a record
// (the system of record), PS Tech is told, and the person who asked is
// acknowledged. There is no route here that creates a facility.
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { sendEmail, appUrl } from "../lib/email.js";
import { parseOr400 } from "../lib/validate.js";
import { clientIp } from "../lib/clientIp.js";

export const publicRouter = Router();

/** The response time we publish. The console shows red when a request waits longer. */
export const RESPONSE_HOURS = 48;

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: process.env.NODE_ENV === "test" ? 1000 : 6,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  message: { error: "too_many_attempts", message: "Too many requests from this connection. Please try again in an hour, or call us." },
});

const accessInput = z.object({
  facilityName: z.string().trim().min(2, "Enter the facility name.").max(160),
  facilityType: z.enum(["CHPS_COMPOUND", "HEALTH_CENTRE", "CLINIC", "POLYCLINIC", "HOSPITAL", "PRIVATE_HOSPITAL"]).optional(),
  district: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  contactName: z.string().trim().min(2, "Enter your name.").max(120),
  contactRole: z.string().trim().max(120).optional(),
  contactEmail: z.string().trim().toLowerCase().email("Enter an email address we can reply to.").max(200),
  contactPhone: z.string().trim().max(40).optional(),
  staffCountEstimate: z.number().int().min(1).max(5000).optional(),
  currentMethod: z.string().trim().max(500).optional(),
  message: z.string().trim().max(2000).optional(),
  source: z.enum(["LANDING_PAGE", "PRICING_PAGE", "CONTACT_PAGE", "REFERRAL"]).optional(),
  // A field people never see. A bot fills it in.
  website: z.string().max(0).optional(),
});

function notifyList(): string[] {
  const raw = process.env.ACCESS_REQUEST_NOTIFY ?? "muslimfroko05@gmail.com";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

publicRouter.post("/access-requests", limiter, async (req, res) => {
  const input = parseOr400(accessInput, req.body, res);
  if (!input) return;
  const { website: _trap, ...data } = input;
  void _trap;
  const row = await prisma.accessRequest.create({ data: { ...data, source: data.source ?? "LANDING_PAGE" } });

  const summary = [
    `Facility: ${row.facilityName}${row.facilityType ? ` (${row.facilityType.toLowerCase().replace(/_/g, " ")})` : ""}`,
    `District and region: ${[row.district, row.region].filter(Boolean).join(", ") || "not given"}`,
    `Contact: ${row.contactName}${row.contactRole ? `, ${row.contactRole}` : ""}`,
    `Email: ${row.contactEmail}`,
    `Phone: ${row.contactPhone ?? "not given"}`,
    `Staff: ${row.staffCountEstimate ?? "not given"}`,
    `How the roster is done now: ${row.currentMethod ?? "not given"}`,
    `Message: ${row.message ?? "none"}`,
  ].join("\n");
  const link = appUrl(`/admin/requests/${row.id}`);
  // Telling PS Tech and acknowledging the requester are separate, so one failing does not stop the other.
  await Promise.allSettled([
    ...notifyList().map((to) => sendEmail({ to, subject: `New HealthFlow access request: ${row.facilityName}`, text: `${summary}\n\nOpen it in the console: ${link}\nPublished response time: ${RESPONSE_HOURS} hours.` })),
    sendEmail({
      to: row.contactEmail,
      subject: "We have your HealthFlow request",
      text: `Dear ${row.contactName},\n\nThank you for asking about HealthFlow for ${row.facilityName}. We will reply within ${RESPONSE_HOURS} hours, usually sooner.\n\nIf it is urgent, call 055 457 1800 or 024 618 7422.\n\nPS Tech, Wa, Upper West Region, Ghana`,
    }),
  ]);
  res.status(201).json({ ok: true, responseHours: RESPONSE_HOURS });
});

/** Plans a visitor can read. Only what has been entered and is active; nothing is assumed. */
publicRouter.get("/plans", async (_req, res) => {
  const plans = await prisma.plan.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { monthlyPriceGhs: "asc" }] });
  res.json({
    plans: plans.map((p) => ({ id: p.id, name: p.name, monthlyPriceGhs: p.monthlyPriceGhs, setupPriceGhs: p.setupPriceGhs, staffBandMin: p.staffBandMin, staffBandMax: p.staffBandMax, features: (p.features as string[] | null) ?? [] })),
  });
});
