// The public front door: the plans and districts a visitor can read, the legal
// documents, and district registration. A facility registers itself in
// facilityRegister.ts.
import { AGENCY_CODES, AGENCY_MESSAGE, agencyName } from "../lib/agency.js";
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

function notifyList(): string[] {
  const raw = process.env.ACCESS_REQUEST_NOTIFY ?? "muslimfroko05@gmail.com";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

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
publicRouter.get("/districts", async (req, res) => {
  const agency = AGENCY_CODES.find((a) => a === req.query.agency);
  const districts = await prisma.district.findMany({ where: { status: "ACTIVE", active: true, level: "DISTRICT", ...(agency ? { agency } : {}) }, orderBy: [{ region: "asc" }, { name: "asc" }], select: { id: true, name: true, region: true, agency: true } });
  res.json({ districts });
});

/** The regional offices a district can report to. Only approved ones. */
publicRouter.get("/regions", async (req, res) => {
  const agency = AGENCY_CODES.find((a) => a === req.query.agency);
  const regions = await prisma.district.findMany({ where: { status: "ACTIVE", active: true, level: "REGION", ...(agency ? { agency } : {}) }, orderBy: { region: "asc" }, select: { id: true, name: true, region: true, agency: true } });
  res.json({ regions });
});

const districtInput = z.object({
  name: z.string().trim().min(2, "Enter the district name.").max(120),
  region: z.string().trim().min(2, "Enter the region.").max(120),
  agency: z.enum(AGENCY_CODES, { message: AGENCY_MESSAGE }).default("GHS"),
  contactName: z.string().trim().min(2, "Enter the officer's name.").max(120),
  contactRole: z.string().trim().max(120).optional(),
  contactEmail: z.string().trim().toLowerCase().email("Enter an email address for the officer.").max(200),
  contactPhone: z.string().trim().max(40).optional(),
  officeAddress: z.string().trim().max(300).optional(),
  /** The regional office this district reports to. It approves the registration. */
  regionOfficeId: z.string().trim().max(60).optional(),
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
  const regionOffice = input.regionOfficeId ? await prisma.district.findFirst({ where: { id: input.regionOfficeId, level: "REGION", status: "ACTIVE", active: true } }) : null;
  if (input.regionOfficeId && !regionOffice) return res.status(400).json({ error: "invalid_input", fields: { regionOfficeId: "Choose a regional office from the list." } });
  if (regionOffice && regionOffice.agency !== input.agency) return res.status(400).json({ error: "invalid_input", fields: { regionOfficeId: `That regional office is under ${agencyName(regionOffice.agency)}. Choose one under ${agencyName(input.agency)}.` } });
  const same = await prisma.district.findFirst({
    where: { name: { equals: input.name, mode: "insensitive" }, region: { equals: input.region, mode: "insensitive" }, agency: input.agency, level: "DISTRICT", status: { not: "DECLINED" } },
    select: { id: true },
  });
  if (same) return res.status(409).json({ error: "district_exists", message: "This district is already registered. If you are its officer, sign in. Otherwise call us on 055 457 1800." });

  const passwordHash = await hashPassword(input.password);
  const district = await prisma.$transaction(async (tx) => {
    const d = await tx.district.create({
      data: {
        name: input.name, region: regionOffice?.region ?? input.region, agency: input.agency, level: "DISTRICT", regionOfficeId: regionOffice?.id ?? null, status: "PENDING", active: false, registeredAt: new Date(),
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
    ...(regionOffice?.contactEmail ? [sendEmail({
      to: regionOffice.contactEmail,
      subject: `A district asks to report to ${regionOffice.name}: ${district.name}`,
      text: `${district.name} has registered on HealthFlow and chose ${regionOffice.name} as its regional office.\nOfficer: ${input.contactName}${input.contactRole ? `, ${input.contactRole}` : ""}\nEmail: ${input.contactEmail}\nPhone: ${input.contactPhone ?? "not given"}\n\nIt cannot sign in until you approve it. Review it here: ${appUrl("/district/districts")}`,
    })] : []),
    sendEmail({
      to: input.contactEmail,
      subject: "We have your HealthFlow district registration",
      text: `Dear ${input.contactName},\n\nThank you for registering ${district.name} on HealthFlow. ${regionOffice ? `Your regional office, ${regionOffice.name}, must approve ${district.name} first. ` : ""}We check each district before it goes live, usually within ${RESPONSE_HOURS} hours. You can sign in once it is approved. We will email you.\n\nIf it is urgent, call 055 457 1800 or 024 618 7422.\n\nPS Tech, Wa, Upper West Region, Ghana`,
    }),
  ]);
  res.status(201).json({ ok: true, responseHours: RESPONSE_HOURS });
});

export const GHANA_REGIONS = ["Ahafo", "Ashanti", "Bono", "Bono East", "Central", "Eastern", "Greater Accra", "North East", "Northern", "Oti", "Savannah", "Upper East", "Upper West", "Volta", "Western", "Western North"] as const;

const regionInput = z.object({
  agency: z.enum(AGENCY_CODES, { message: AGENCY_MESSAGE }),
  region: z.enum(GHANA_REGIONS, { message: "Choose the region." }),
  contactName: z.string().trim().min(2, "Enter the officer's name.").max(120),
  contactRole: z.string().trim().max(120).optional(),
  contactEmail: z.string().trim().toLowerCase().email("Enter an email address for the officer.").max(200),
  contactPhone: z.string().trim().max(40).optional(),
  officeAddress: z.string().trim().max(300).optional(),
  password: z.string().min(1, "Choose a password."),
  website: z.string().max(0).optional(),
});

/**
 * A regional office registers itself. It waits for PS Tech to approve it. Once
 * approved, districts under the same agency can choose it, and it approves them.
 */
publicRouter.post("/regions/register", limiter, async (req, res) => {
  const input = parseOr400(regionInput, req.body, res);
  if (!input) return;
  const problem = checkPassword(input.password, input.contactEmail);
  if (problem) return res.status(400).json({ error: "invalid_input", fields: { password: problem } });
  if (await prisma.userProfile.findUnique({ where: { userEmail: input.contactEmail }, select: { id: true } })) {
    return res.status(409).json({ error: "email_taken", message: "That email address already has an account. Sign in, or use a different address for the regional office." });
  }
  const same = await prisma.district.findFirst({ where: { level: "REGION", region: input.region, agency: input.agency, status: { not: "DECLINED" } }, select: { id: true } });
  if (same) return res.status(409).json({ error: "region_exists", message: `A regional office for ${input.region} under ${agencyName(input.agency)} is already registered. If you are its officer, sign in. Otherwise call us on 055 457 1800.` });

  const passwordHash = await hashPassword(input.password);
  const office = await prisma.$transaction(async (tx) => {
    const d = await tx.district.create({
      data: {
        name: `${input.region} Region (${agencyName(input.agency).replace(/ \(.*\)$/, "")})`, region: input.region, agency: input.agency, level: "REGION", status: "PENDING", active: false, registeredAt: new Date(),
        contactName: input.contactName, contactRole: input.contactRole || null, contactEmail: input.contactEmail,
        contactPhone: input.contactPhone || null, officeAddress: input.officeAddress || null,
      },
    });
    await tx.userProfile.create({ data: { userEmail: input.contactEmail, passwordHash, role: "DISTRICT_OFFICER", scopeType: "DISTRICT", scopeId: d.id, facilityId: null, active: false } });
    return d;
  });
  await Promise.allSettled([
    ...notifyList().map((to) => sendEmail({
      to,
      subject: `A regional office has registered: ${office.name}`,
      text: `${office.name}\nAgency: ${agencyName(input.agency)}\nOfficer: ${input.contactName}${input.contactRole ? `, ${input.contactRole}` : ""}\nEmail: ${input.contactEmail}\nPhone: ${input.contactPhone ?? "not given"}\nOffice: ${input.officeAddress ?? "not given"}\n\nApprove or decline it in the console: ${appUrl("/platform/districts")}`,
    })),
    sendEmail({
      to: input.contactEmail,
      subject: "We have your HealthFlow regional registration",
      text: `Dear ${input.contactName},\n\nThank you for registering the ${input.region} regional office on HealthFlow. We check each office before it goes live, usually within ${RESPONSE_HOURS} hours. You can sign in once it is approved. We will email you.\n\nIf it is urgent, call 055 457 1800 or 024 618 7422.\n\nPS Tech, Wa, Upper West Region, Ghana`,
    }),
  ]);
  res.status(201).json({ ok: true, responseHours: RESPONSE_HOURS });
});
