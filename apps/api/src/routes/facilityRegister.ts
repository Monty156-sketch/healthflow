// A facility registers itself. At the end it exists, has an administrator who
// can sign in, starter departments, cadres and rules, a starter privacy notice,
// and a staff access code ready to give out. It starts as a trial. Nothing is
// shared with a district until the facility grants that access itself, and the
// platform can suspend a facility that should not be here.
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
import { ensureStarterNotice, portfolioFor, seedChosen } from "../lib/facilitySetup.js";
import { makeEnrolmentToken } from "../lib/signedTokens.js";
import { ensureRules } from "./facility/rules.js";
import { writeAuditLog } from "../lib/audit.js";

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
  adminName: z.string().trim().min(2, "Enter your name.").max(120),
  adminEmail: z.string().trim().toLowerCase().email("Enter an email address you can open.").max(200),
  adminPhone: z.string().trim().min(1, "Enter your phone number."),
  /** The plan chosen. Required whenever the platform has active plans. */
  planId: z.string().trim().max(60).optional(),
  /** The departments and cadres the facility works with. Chosen from the lists, or typed. */
  departments: z.array(z.string().trim().min(1).max(80)).max(60),
  cadres: z.array(z.string().trim().min(1).max(80)).max(60),
  password: z.string(),
  acceptedTerms: z.literal(true, { message: "Agree to the Terms and the Privacy Policy to continue." }),
  website: z.string().max(0).optional(), // a field people never see; a bot fills it in
});

/** What the registration form offers: the usual departments and cadres, ticked by default, and the plans. */
facilityRegisterRouter.get("/options", async (req, res) => {
  const portfolio = portfolioFor(typeof req.query.type === "string" ? req.query.type : null);
  const plans = await prisma.plan.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { monthlyPriceGhs: "asc" }] });
  res.json({
    departments: portfolio.departments,
    cadres: portfolio.cadres,
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
  const same = await prisma.facility.findFirst({ where: { name: { equals: body.facilityName, mode: "insensitive" }, region: { equals: body.region, mode: "insensitive" } }, select: { id: true } });
  if (same) return res.status(409).json({ error: "facility_exists", message: "A facility with that name is already registered in that region. If you work there, ask your in-charge for the access code. Otherwise call 055 457 1800." });

  const plansExist = await prisma.plan.count({ where: { active: true } });
  const plan = body.planId ? await prisma.plan.findFirst({ where: { id: body.planId, active: true } }) : null;
  if (plansExist > 0 && !plan) return res.status(400).json({ error: "invalid_input", fields: { planId: "Choose a plan." } });
  if (body.departments.length === 0) return res.status(400).json({ error: "invalid_input", fields: { departments: "Choose at least one department." } });
  if (body.cadres.length === 0) return res.status(400).json({ error: "invalid_input", fields: { cadres: "Choose at least one cadre." } });

  const district = body.districtId ? await prisma.district.findFirst({ where: { id: body.districtId, status: "ACTIVE", active: true } }) : null;
  const passwordHash = await hashPassword(body.password);

  const facility = await prisma.facility.create({
    data: { name: body.facilityName, facilityType: body.facilityType, region: district?.region ?? body.region, districtId: district?.id ?? null, status: "TRIAL" },
  });
  await seedChosen(facility.id, body.departments, body.cadres);
  const trialEnds = new Date(Date.now() + 30 * 86_400_000);
  if (plan) {
    await prisma.subscription.create({ data: { facilityId: facility.id, planId: plan.id, status: "TRIAL", trialEndsAt: trialEnds, currentPeriodStart: new Date(), currentPeriodEnd: trialEnds } });
    await prisma.facility.update({ where: { id: facility.id }, data: { trialEndsAt: trialEnds } });
  }
  await ensureRules(facility.id);
  const { notice } = await ensureStarterNotice(facility.id, facility.name);
  await prisma.$transaction(async (tx) => {
    const staff = await tx.staff.create({ data: { facilityId: facility.id, staffNo: "ADMIN-001", fullName: body.adminName, email: body.adminEmail, phone, status: "ACTIVE" } });
    await tx.userProfile.create({
      data: { userEmail: body.adminEmail, passwordHash, role: "FACILITY_ADMIN", scopeType: "FACILITY", scopeId: facility.id, facilityId: facility.id, staffId: staff.id, active: true, privacyNoticeVersionAccepted: notice.version },
    });
  });
  const code = await issueCode(facility.id, body.adminEmail);
  const created = await prisma.userProfile.findUniqueOrThrow({ where: { userEmail: body.adminEmail }, select: { id: true } });
  await writeAuditLog({
    facilityId: facility.id, actorEmail: body.adminEmail, action: "facility_self_registered", entityType: "Facility", entityId: facility.id,
    summary: `${body.adminName} registered ${facility.name} on the ${plan?.name ?? "no"} plan (${body.region}${district ? `, ${district.name}` : body.districtText ? `, district given as ${body.districtText}` : ""}) and became its administrator. Access code ${code.code} was issued.`,
  });

  const notify = (process.env.ACCESS_REQUEST_NOTIFY ?? "muslimfroko05@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);
  await Promise.allSettled([
    ...notify.map((to) => sendEmail({ to, subject: `A facility registered: ${facility.name}`, text: `${facility.name}, ${body.region}${district ? `, ${district.name}` : body.districtText ? `, district: ${body.districtText}` : ""}\nAdministrator: ${body.adminName}, ${body.adminEmail}, ${body.adminPhone}\nPlan: ${plan?.name ?? "none chosen"}. Departments chosen: ${body.departments.length}. Cadres chosen: ${body.cadres.length}.\n\nIt is on a 30 day trial. See it in the console: ${appUrl("/platform")}` })),
    sendEmail({ to: body.adminEmail, subject: `${facility.name} is registered on HealthFlow`, text: `Dear ${body.adminName},\n\n${facility.name} is registered on HealthFlow.\n\nYour staff access code is ${code.code}. Give it to your staff. They open ${appUrl("/join")}, enter it, and you approve each person.\n\nSign in at ${appUrl("/login")} with this email address. You will set up an authenticator app the first time.\n\nPS Tech, Wa, Upper West Region, Ghana. 055 457 1800.` }),
  ]);
  res.status(201).json({ facilityName: facility.name, code: code.code, joinUrl: appUrl(`/join/${code.code}`), signInUrl: appUrl("/login"), enrolmentToken: makeEnrolmentToken(created.id) });
});
