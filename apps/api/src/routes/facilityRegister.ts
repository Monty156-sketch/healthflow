// A facility registers itself. At the end it exists, has an administrator who
// can sign in, starter departments, cadres and rules, a starter privacy notice,
// and a staff access code ready to give out. It starts as a trial. Nothing is
// shared with a district until the facility grants that access itself, and the
// platform can suspend a facility that should not be here.
import { AGENCY_CODES, AGENCY_MESSAGE, agencyName } from "../lib/agency.js";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../lib/password.js";
import { checkPassword } from "../lib/passwordPolicy.js";
import { clientIp } from "../lib/clientIp.js";
import { appUrl, sendEmail } from "../lib/email.js";
import { parseOr400 } from "../lib/validate.js";
import { normalisePhone } from "../lib/sms.js";
import { issueCode } from "../lib/accessCode.js";
import { applyStandardSetup, ensureStarterNotice, hasFullPortfolio, portfolioFor, seedChosen } from "../lib/facilitySetup.js";
import { PUBLIC_HEALTH_UNITS } from "../lib/dutyPlan.js";
import { makeEnrolmentToken } from "../lib/signedTokens.js";
import { writeAuditLog } from "../lib/audit.js";
import { districtKey as nameKey } from "../lib/districtLink.js";


/** The registered district office that matches the district the person chose, if there is one. Choosing the district is enough to link the facility to it. */
async function districtNamed(region: string, name: string | undefined, agency: string) {
  if (!name) return null;
  const key = nameKey(name);
  if (!key) return null;
  const rows = await prisma.district.findMany({ where: { level: "DISTRICT", status: "ACTIVE", active: true, region: { equals: region, mode: "insensitive" } } });
  const hits = rows.filter((d) => nameKey(d.name) === key);
  return hits.find((d) => d.agency === agency) ?? null;
}

export const facilityRegisterRouter = Router();

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: process.env.NODE_ENV === "test" ? 1000 : 4,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  message: { error: "too_many_attempts", message: "Too many registrations from this connection. Try again in an hour, or call 055 457 1800." },
});

const TYPES = ["CHPS_COMPOUND", "HEALTH_CENTRE", "CLINIC", "POLYCLINIC", "HOSPITAL", "PRIVATE_HOSPITAL", "REGIONAL_HOSPITAL", "TEACHING_HOSPITAL"] as const;

const input = z.object({
  facilityName: z.string().trim().min(2, "Enter the facility name.").max(160),
  facilityType: z.enum(TYPES, { message: "Choose the type of facility." }),
  region: z.string().trim().min(2, "Enter the region.").max(120),
  districtId: z.string().trim().max(60).optional(),
  districtText: z.string().trim().max(120).optional(),
  agency: z.enum(AGENCY_CODES, { message: AGENCY_MESSAGE }).default("GHS"),
  adminName: z.string().trim().min(2, "Enter your name.").max(120),
  adminEmail: z.string().trim().toLowerCase().email("Enter an email address you can open.").max(200),
  adminPhone: z.string().trim().min(1, "Enter your phone number."),
  /** The plan chosen. Required whenever the platform has active plans. */
  planId: z.string().trim().max(60).optional(),
  /** The departments and cadres the facility works with. Chosen from the lists, or typed. */
  departments: z.array(z.string().trim().min(1).max(80)).max(60),
  cadres: z.array(z.string().trim().min(1).max(80)).max(60),
  /** The public health units chosen, when Public Health is one of the departments. Each becomes a department, with the cadres that work in it. */
  publicHealthUnits: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  password: z.string(),
  acceptedTerms: z.literal(true, { message: "Agree to the Terms and the Privacy Policy to continue." }),
  website: z.string().max(0).optional(), // a field people never see; a bot fills it in
});

/** What the registration form offers: the usual departments and cadres, ticked by default, and the plans. */
/** CHPS compounds and clinics share one plan, the smallest. */
const SMALL_TYPES = new Set(["CHPS_COMPOUND", "CLINIC"]);
const smallPlan = (name: string) => /^CHPS/i.test(name);

facilityRegisterRouter.get("/options", async (req, res) => {
  const type = typeof req.query.type === "string" ? req.query.type : null;
  const portfolio = portfolioFor(type);
  const all = await prisma.plan.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { monthlyPriceGhs: "asc" }] });
  const small = type && SMALL_TYPES.has(type) ? all.filter((p) => smallPlan(p.name)) : [];
  const plans = small.length ? small : all;
  res.json({
    // A hospital, polyclinic, regional or teaching hospital is given every ward and cadre: its administrator chooses none.
    auto: hasFullPortfolio(type),
    departments: portfolio.departments,
    cadres: portfolio.cadres,
    publicHealthUnits: PUBLIC_HEALTH_UNITS,
    plans: plans.map((p) => ({ id: p.id, name: p.name, monthlyPriceGhs: p.monthlyPriceGhs, setupPriceGhs: p.setupPriceGhs, staffBandMin: p.staffBandMin, staffBandMax: p.staffBandMax, features: (p.features as string[] | null) ?? [] })),
  });
});

facilityRegisterRouter.post("/", limiter, async (req, res) => {
  const body = parseOr400(input, req.body, res);
  if (!body) return;
  const phone = normalisePhone(body.adminPhone);
  if (!phone) return res.status(400).json({ error: "invalid_input", fields: { adminPhone: "Enter a Ghana mobile number, such as 024 123 4567." } });
  const problem = checkPassword(body.password, body.adminEmail);
  if (problem) return res.status(400).json({ error: "invalid_input", fields: { password: problem } });
  if (await prisma.userProfile.findUnique({ where: { userEmail: body.adminEmail }, select: { id: true } })) {
    return res.status(409).json({ error: "email_taken", message: "That email address already has an account. Sign in, or use a different address." });
  }

  const plansExist = await prisma.plan.count({ where: { active: true } });
  const plan = body.planId ? await prisma.plan.findFirst({ where: { id: body.planId, active: true } }) : null;
  if (plan && SMALL_TYPES.has(body.facilityType) && !smallPlan(plan.name) && (await prisma.plan.count({ where: { active: true, name: { startsWith: "CHPS", mode: "insensitive" } } })) > 0) {
    return res.status(400).json({ error: "invalid_input", fields: { planId: "CHPS compounds and clinics are on the CHPS and Clinic plan." } });
  }
  if (plansExist > 0 && !plan) return res.status(400).json({ error: "invalid_input", fields: { planId: "Choose a plan." } });
  const full = hasFullPortfolio(body.facilityType);
  if (!full && body.departments.length === 0) return res.status(400).json({ error: "invalid_input", fields: { departments: "Choose at least one department." } });
  if (!full && body.cadres.length === 0) return res.status(400).json({ error: "invalid_input", fields: { cadres: "Choose at least one cadre." } });
  // What the facility starts with: everything for a hospital type; for the rest, what was ticked, plus the public health units chosen and the cadres who work in them.
  const portfolio = portfolioFor(body.facilityType);
  const chosenUnits = PUBLIC_HEALTH_UNITS.filter((u) => (body.publicHealthUnits ?? []).some((n) => n.toLowerCase() === u.name.toLowerCase()));
  const startDepartments = [...(full ? portfolio.departments : []), ...body.departments, ...((body.publicHealthUnits ?? []).length ? ["Public Health", ...(body.publicHealthUnits ?? [])] : [])];
  const startCadres = [...(full ? portfolio.cadres : []), ...body.cadres, ...chosenUnits.flatMap((u) => u.cadres)];

  const district = body.districtId
    ? await prisma.district.findFirst({ where: { id: body.districtId, level: "DISTRICT", status: "ACTIVE", active: true } })
    : await districtNamed(body.region, body.districtText, body.agency);
  if (district && district.agency !== body.agency) {
    return res.status(400).json({ error: "invalid_input", fields: { districtId: `${district.name} is a ${agencyName(district.agency)} district. Choose a district under ${agencyName(body.agency)}.` } });
  }
  const passwordHash = await hashPassword(body.password);

  // The facility and its administrator are made together. If either fails (an email taken a moment ago,
  // say) nothing is left behind, so the same details can be sent again. The starter set-up follows.
  const facility = await prisma.$transaction(async (tx) => {
    const f = await tx.facility.create({
      data: { name: body.facilityName, facilityType: body.facilityType, agency: body.agency, region: district?.region ?? body.region, districtId: district?.id ?? null, districtName: body.districtText || district?.name || null, status: "PENDING" },
    });
    const staff = await tx.staff.create({ data: { facilityId: f.id, staffNo: "ADMIN-001", fullName: body.adminName, email: body.adminEmail, phone, status: "ACTIVE" } });
    await tx.userProfile.create({
      data: { userEmail: body.adminEmail, passwordHash, role: "FACILITY_ADMIN", scopeType: "FACILITY", scopeId: f.id, facilityId: f.id, staffId: staff.id, active: true },
    });
    return f;
  }).catch((e: { code?: string }) => {
    if (e?.code === "P2002") return null;
    throw e;
  });
  if (!facility) return res.status(409).json({ error: "email_taken", message: "That email address, or that facility, was registered a moment ago. Sign in, or check the details and try again." });
  // A health centre rosters by unit, so it always has the three, whatever was ticked.
  const units = body.facilityType === "HEALTH_CENTRE" ? ["OPD", "Maternity", "Public Health"] : [];
  const have = new Set(startDepartments.map((d) => d.trim().toLowerCase()));
  await seedChosen(facility.id, [...startDepartments, ...units.filter((u) => !have.has(u.toLowerCase()))], startCadres);
  // The 30 day trial starts when PS Tech approves the registration, not now.
  if (plan) await prisma.subscription.create({ data: { facilityId: facility.id, planId: plan.id, status: "TRIAL" } });
  await applyStandardSetup(facility.id, body.facilityType);
  const { notice } = await ensureStarterNotice(facility.id, facility.name);
  await prisma.userProfile.update({ where: { userEmail: body.adminEmail }, data: { privacyNoticeVersionAccepted: notice.version } });
  const code = await issueCode(facility.id, body.adminEmail);
  const created = await prisma.userProfile.findUniqueOrThrow({ where: { userEmail: body.adminEmail }, select: { id: true } });
  await writeAuditLog({
    facilityId: facility.id, actorEmail: body.adminEmail, action: "facility_self_registered", entityType: "Facility", entityId: facility.id,
    summary: `${body.adminName} registered ${facility.name} on the ${plan?.name ?? "no"} plan (${body.region}${district ? `, ${district.name}` : body.districtText ? `, district given as ${body.districtText}` : ""}) and became its administrator. Access code ${code.code} was issued.`,
  });

  const notify = (process.env.ACCESS_REQUEST_NOTIFY ?? "muslimfroko05@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);
  await Promise.allSettled([
    ...notify.map((to) => sendEmail({ to, subject: `A facility needs approval: ${facility.name}`, text: `${facility.name}, ${body.region}${district ? `, ${district.name}` : body.districtText ? `, district: ${body.districtText}` : ""}\nAdministrator: ${body.adminName}, ${body.adminEmail}, ${body.adminPhone}\nPlan: ${plan?.name ?? "none chosen"}. Departments: ${startDepartments.length}. Cadres: ${startCadres.length}.\n\nIt is waiting for your approval. Nothing opens for them until you approve it: ${appUrl("/platform/registrations")}` })),
    sendEmail({ to: body.adminEmail, subject: `${facility.name}: registration received`, text: `Dear ${body.adminName},\n\nWe have received the registration for ${facility.name}. PS Tech checks each new facility before it opens, and may telephone you on ${body.adminPhone}. You will get an email as soon as it is approved, and your 30 day trial starts then.\n\nYou can sign in at ${appUrl("/login")} with this email address to set up your authenticator app and see the status.\n\nPS Tech, Wa, Upper West Region, Ghana. 055 457 1800.` }),
  ]);
  res.status(201).json({ facilityName: facility.name, code: code.code, joinUrl: appUrl(`/join/${code.code}`), signInUrl: appUrl("/login"), enrolmentToken: makeEnrolmentToken(created.id) });
});
