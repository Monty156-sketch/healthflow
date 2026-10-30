// How HealthFlow is working for the people who use it. Everyone signed in is asked for a rating and
// an optional comment: first a week after their account was made, then about once a month. "Not now"
// asks again in a week. The button in the menu lets anyone send feedback at any time.
// PS Tech reads all of it in the platform console.
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { parseOr400 } from "../../lib/validate.js";
import { caller } from "../../middleware/facilityAccess.js";
import { patientCheck } from "../../lib/patientData.js";
import { emailFeedback } from "../../lib/feedbackAlert.js";
import { knownNames } from "./handover.js";

export const feedbackRouter = Router();

const DAY = 86_400_000;
const FIRST_ASK_AFTER_DAYS = 7;
const AFTER_FEEDBACK_DAYS = 30;
const AFTER_LATER_DAYS = 7;

export const FEEDBACK_CATEGORIES = ["GENERAL", "IDEA", "PROBLEM", "PRAISE"] as const;

/** Words people use about HealthFlow itself, so "Roster Page" is not read as a name. */
const APP_WORDS = ["HealthFlow", "PS Tech", "Roster", "Page", "Leave", "Request", "Duty", "Swap", "Cover", "Ledger", "Days Off", "Attendance", "Handover", "Notes", "Staff", "List", "Report", "Billing", "Dashboard", "Log In", "Sign In", "Password", "Reset", "Link", "Email", "Phone", "App", "Screen", "Button", "Menu"];

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.caller?.userId ?? "unknown",
  message: { error: "too_many_requests", message: "You have sent several already. Try again in an hour." },
});

/** True when this person should be asked now. PS Tech support working inside a facility is never asked. */
feedbackRouter.get("/prompt", async (req, res) => {
  const who = caller(req);
  if (who.supportSessionId) return res.json({ due: false });
  const me = await prisma.userProfile.findUnique({ where: { id: who.userId }, select: { feedbackNextAt: true, createdAt: true } });
  if (!me) return res.json({ due: false });
  const when = me.feedbackNextAt ?? new Date(me.createdAt.getTime() + FIRST_ASK_AFTER_DAYS * DAY);
  res.json({ due: when.getTime() <= Date.now() });
});

const input = z
  .object({
    rating: z.number().int().min(1, "Choose a rating from 1 to 5.").max(5, "Choose a rating from 1 to 5."),
    category: z.enum(FEEDBACK_CATEGORIES).default("GENERAL"),
    message: z.string().trim().max(2000, "Keep it under 2000 characters.").optional().default(""),
    screen: z.string().trim().max(200).optional(),
    asked: z.boolean().optional().default(false),
    confirmNoPatientDetails: z.boolean().optional().default(false),
  })
  .superRefine((v, ctx) => {
    // A low score or a problem with nothing said cannot be acted on.
    if ((v.rating <= 2 || v.category === "PROBLEM" || v.category === "IDEA") && v.message.length < 5) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["message"], message: "Say a little about it, so we know what to improve." });
    }
  });

feedbackRouter.post("/", limiter, async (req, res) => {
  const who = caller(req);
  if (who.supportSessionId) return res.status(403).json({ error: "forbidden", message: "Feedback is sent by the facility's own users." });
  const body = parseOr400(input, req.body, res);
  if (!body) return;
  // Patient details must not reach PS Tech. Names the facility uses (wards, shifts, colleagues) are not mistaken for one.
  const { known, people } = await knownNames(who.facilityId);
  const check = patientCheck(body.message, [...known, ...APP_WORDS], people);
  if (check && !(check.canConfirm && body.confirmNoPatientDetails)) return res.status(400).json({ error: "invalid_input", fields: { message: check.problem }, canConfirm: check.canConfirm });
  await prisma.$transaction(async (tx) => {
    await tx.feedback.create({
      data: { facilityId: who.facilityId, userId: who.userId, role: who.role, rating: body.rating, category: body.category, message: body.message || null, screen: body.screen ?? null, asked: body.asked },
    });
    await tx.userProfile.update({ where: { id: who.userId }, data: { feedbackNextAt: new Date(Date.now() + AFTER_FEEDBACK_DAYS * DAY) } });
  });
  const facility = await prisma.facility.findUnique({ where: { id: who.facilityId }, select: { name: true } });
  emailFeedback({ rating: body.rating, category: body.category, message: body.message || null, facility: facility?.name ?? "", from: who.email, role: who.role, screen: body.screen ?? null });
  res.status(201).json({ ok: true });
});

/** "Not now": ask again in a week. */
feedbackRouter.post("/later", limiter, async (req, res) => {
  const who = caller(req);
  if (who.supportSessionId) return res.json({ ok: true });
  await prisma.userProfile.update({ where: { id: who.userId }, data: { feedbackNextAt: new Date(Date.now() + AFTER_LATER_DAYS * DAY) } });
  res.json({ ok: true });
});
