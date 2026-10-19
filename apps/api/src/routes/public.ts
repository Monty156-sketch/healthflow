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
import { hashPassword } from "../lib/password.js";
import { checkPassword } from "../lib/passwordPolicy.js";

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
  /** A district chosen from the registered ones. Wins over the free-text name. */
  districtId: z.string().trim().max(60).optional(),
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
  if (data.districtId) {
    const d = await prisma.district.findFirst({ where: { id: data.districtId, status: "ACTIVE", active: true }, select: { name: true, region: true } });
    if (!d) return res.status(400).json({ error: "invalid_input", fields: { districtId: "Choose a district from the list." } });
    data.district = d.name;
    data.region = data.region || d.region;
  }
  const row = await prisma.accessRequest.create({ data: { ...data, source: data.source ?? "LANDING_PAGE" } });

  const summary = [
    `Facility: ${row.facilityName}${row.facilityType ? ` (${row.facilityType.toLowerCase().replace(/_/g, " ")})` : ""}`,
    `District and region: ${[row.district, row.region].filter(Boolean).join(", ") || "not given"}${row.districtId ? " (a registered district)" : ""}`,
    `Contact: ${row.contactName}${row.contactRole ? `, ${row.contactRole}` : ""}`,
    `Email: ${row.contactEmail}`,
    `Phone: ${row.contactPhone ?? "not given"}`,
    `Staff: ${row.staffCountEstimate ?? "not given"}`,
    `How the roster is done now: ${row.currentMethod ?? "not given"}`,
    `Message: ${row.message ?? "none"}`,
  ].join("\n");
  const link = appUrl(`/platform/requests/${row.id}`);
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

// ------------------------------------------------------------- legal documents

/** The latest published version of a legal document, and its history. Pages fall back to the built-in draft when none is stored. */
publicRouter.get("/legal/:slug", async (req, res) => {
  const docs = await prisma.legalDocument.findMany({ where: { slug: String(req.params.slug), publishedAt: { not: null } }, orderBy: { publishedAt: "desc" } });
  if (docs.length === 0) return res.status(404).json({ error: "not_found" });
  const [cur] = docs;
  res.json({
    current: { title: cur.title, version: cur.version, body: cur.body, effectiveDate: cur.effectiveDate, publishedAt: cur.publishedAt, summaryOfChanges: cur.summaryOfChanges },
    history: docs.map((d) => ({ version: d.version, effectiveDate: d.effectiveDate, publishedAt: d.publishedAt, summaryOfChanges: d.summaryOfChanges })),
  });
});


// ------------------------------------------------------------- the district directory

/** Districts a facility can choose when it asks for access. Only approved ones. */
publicRouter.get("/districts", async (_req, res) => {
  const districts = await prisma.district.findMany({ where: { status: "ACTIVE", active: true }, orderBy: [{ region: "asc" }, { name: "asc" }], select: { id: true, name: true, region: true } });
  res.json({ districts });
});

const districtInput = z.object({
  name: z.string().trim().min(2, "Enter the district name.").max(120),
  region: z.string().trim().min(2, "Enter the region.").max(120),
  contactName: z.string().trim().min(2, "Enter the officer's name.").max(120),
  contactRole: z.string().trim().max(120).optional(),
  contactEmail: z.string().trim().toLowerCase().email("Enter an email address for the officer.").max(200),
  contactPhone: z.string().trim().max(40).optional(),
  officeAddress: z.string().trim().max(300).optional(),
  password: z.string().min(1, "Choose a password."),
  website: z.string().max(0).optional(),
});

/**
 * A district registers itself. It waits for approval: until PS Tech approves it
 * the district is not in the directory and the officer cannot sign in.
 */
publicRouter.post("/districts/register", limiter, async (req, res) => {
  const input = parseOr400(districtInput, req.body, res);
  if (!input) return;
  const problem = checkPassword(input.password, input.contactEmail);
  if (problem) return res.status(400).json({ error: "invalid_input", fields: { password: problem } });

  if (await prisma.userProfile.findUnique({ where: { userEmail: input.contactEmail }, select: { id: true } })) {
    return res.status(409).json({ error: "email_taken", message: "That email address already has an account. Sign in, or use a different address for the district." });
  }
  const same = await prisma.district.findFirst({
    where: { name: { equals: input.name, mode: "insensitive" }, region: { equals: input.region, mode: "insensitive" }, status: { not: "DECLINED" } },
    select: { id: true },
  });
  if (same) return res.status(409).json({ error: "district_exists", message: "This district is already registered. If you are its officer, sign in. Otherwise call us on 055 457 1800." });

  const passwordHash = await hashPassword(input.password);
  const district = await prisma.$transaction(async (tx) => {
    const d = await tx.district.create({
      data: {
        name: input.name, region: input.region, status: "PENDING", active: false, registeredAt: new Date(),
        contactName: input.contactName, contactRole: input.contactRole || null, contactEmail: input.contactEmail,
        contactPhone: input.contactPhone || null, officeAddress: input.officeAddress || null,
      },
    });
    await tx.userProfile.create({ data: { userEmail: input.contactEmail, passwordHash, role: "DISTRICT_OFFICER", scopeType: "DISTRICT", scopeId: d.id, facilityId: null, active: false } });
    return d;
  });

  const link = appUrl("/platform/districts");
  await Promise.allSettled([
    ...notifyList().map((to) => sendEmail({
      to,
      subject: `A district has registered: ${district.name}`,
      text: `${district.name}, ${district.region}\nOfficer: ${input.contactName}${input.contactRole ? `, ${input.contactRole}` : ""}\nEmail: ${input.contactEmail}\nPhone: ${input.contactPhone ?? "not given"}\nOffice: ${input.officeAddress ?? "not given"}\n\nApprove or decline it in the console: ${link}`,
    })),
    sendEmail({
      to: input.contactEmail,
      subject: "We have your HealthFlow district registration",
      text: `Dear ${input.contactName},\n\nThank you for registering ${district.name} on HealthFlow. We check each district before it goes live, usually within ${RESPONSE_HOURS} hours. You can sign in once it is approved. We will email you.\n\nIf it is urgent, call 055 457 1800 or 024 618 7422.\n\nPS Tech, Wa, Upper West Region, Ghana`,
    }),
  ]);
  res.status(201).json({ ok: true, responseHours: RESPONSE_HOURS });
});
