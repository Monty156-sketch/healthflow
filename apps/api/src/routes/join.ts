// Staff register themselves with the facility's access code (spec Part 7, 4).
// Public. Five steps: the code, their details, a text to the phone they gave,
// a password, then waiting for the in-charge. Nothing is written to Staff until
// the last step, so abandoned registrations leave nothing behind. A pending
// account has no session and so sees nothing. The code is not a secret;
// approval is the control.
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { hashPassword } from "../lib/password.js";
import { checkPassword } from "../lib/passwordPolicy.js";
import { writeAuditLog } from "../lib/audit.js";
import { clientIp } from "../lib/clientIp.js";
import { normalisePhone, sendSms, smsConfigured } from "../lib/sms.js";
import { codeProblem, normaliseCode, phoneLogin } from "../lib/accessCode.js";
import { notifyDeciders } from "../lib/notify.js";
import { parseOr400, optionalEmail, optionalText, requiredText } from "../lib/validate.js";
import { currentNotice } from "./facility/privacy.js";

export const joinRouter = Router();

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: process.env.NODE_ENV === "test" ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  message: { error: "too_many_attempts", message: "Too many attempts from this connection. Try again in an hour, or ask your in-charge." },
});
joinRouter.use(limiter);

const BAD_CODE = { error: "invalid_code", message: "That code is not valid. Check it with your in-charge." };
const HOUR = 3_600_000;
const MIN = 60_000;
const PER_PHONE_PER_HOUR = process.env.NODE_ENV === "test" ? 50 : 5;
const MAX_CODE_TRIES = 3;
const MAX_SENDS = 3;

async function openCode(raw: string) {
  const code = await prisma.facilityAccessCode.findUnique({ where: { code: normaliseCode(raw) }, include: { facility: { select: { id: true, name: true, active: true, status: true } } } });
  if (!code || !code.facility.active || code.facility.status === "SUSPENDED" || codeProblem(code)) return null;
  return code;
}

// ------------------------------------------------------------- step 1: the code

joinRouter.get("/:code", async (req, res) => {
  const code = await openCode(String(req.params.code));
  if (!code) return res.status(404).json(BAD_CODE);
  const [cadres, departments] = await Promise.all([
    prisma.cadre.findMany({ where: { facilityId: code.facilityId, active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.department.findMany({ where: { facilityId: code.facilityId, active: true, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  res.json({ facilityName: code.facility.name, cadres, departments, phoneCheck: smsConfigured() });
});

// ------------------------------------------------------------- step 2 and 3: details, then a text

const startInput = z.object({
  code: z.string().min(1),
  fullName: requiredText(120, "Full name"),
  staffNo: requiredText(30, "Staff number"),
  phone: z.string().trim().min(1, "Enter your phone number."),
  email: optionalEmail("Email"),
  cadreId: z.string().trim().nullish().transform((v) => v || null),
  departmentId: z.string().trim().nullish().transform((v) => v || null),
  cadreText: optionalText(80, "Cadre"),
  departmentText: optionalText(80, "Department"),
  position: optionalText(80, "Position"),
});

const sixDigits = () => String(randomInt(100000, 1000000));

joinRouter.post("/", async (req, res) => {
  const input = parseOr400(startInput, req.body, res);
  if (!input) return;
  const code = await openCode(input.code);
  if (!code) return res.status(404).json(BAD_CODE);

  const phone = normalisePhone(input.phone);
  if (!phone) return res.status(400).json({ error: "invalid_input", fields: { phone: "Enter a Ghana mobile number, such as 024 123 4567." } });

  const fields: Record<string, string> = {};
  if (input.cadreId && !(await prisma.cadre.findFirst({ where: { id: input.cadreId, facilityId: code.facilityId, active: true }, select: { id: true } }))) fields.cadreId = "Choose a cadre from the list.";
  if (input.departmentId && !(await prisma.department.findFirst({ where: { id: input.departmentId, facilityId: code.facilityId, active: true }, select: { id: true } }))) fields.departmentId = "Choose a department from the list.";
  if (Object.keys(fields).length) return res.status(400).json({ error: "invalid_input", fields });

  if (await prisma.staff.findFirst({ where: { facilityId: code.facilityId, staffNo: input.staffNo }, select: { id: true } })) {
    return res.status(409).json({ error: "staff_number_taken", message: "That staff number is already registered at this facility. If this is you, sign in instead, or ask your in-charge to reset your password. If you think there is a mistake, ask your in-charge." });
  }
  const loginName = input.email ?? phoneLogin(phone);
  if (await prisma.userProfile.findUnique({ where: { userEmail: loginName }, select: { id: true } })) {
    return res.status(409).json({ error: "account_exists", message: "There is already an account for that phone number or email. Sign in instead." });
  }
  if ((await prisma.joinAttempt.count({ where: { phone, createdAt: { gte: new Date(Date.now() - HOUR) } } })) >= PER_PHONE_PER_HOUR) {
    return res.status(429).json({ error: "too_many_attempts", message: "Too many attempts for that number. Try again in an hour, or ask your in-charge." });
  }

  const method = smsConfigured() ? "SMS" : "NONE";
  const token = randomToken(24);
  const verifyCode = method === "SMS" ? sixDigits() : null;
  const attempt = await prisma.joinAttempt.create({
    data: {
      tokenHash: sha256(token), facilityId: code.facilityId, codeId: code.id, phone, verifyMethod: method, verifyCodeHash: verifyCode ? sha256(verifyCode) : null, sends: verifyCode ? 1 : 0,
      ip: clientIp(req), expiresAt: new Date(Date.now() + HOUR),
      details: { fullName: input.fullName, staffNo: input.staffNo, email: input.email, cadreId: input.cadreId, departmentId: input.departmentId, cadreText: input.cadreText, departmentText: input.departmentText, position: input.position },
    },
  });
  if (verifyCode) {
    const sent = await sendSms(phone, `Your HealthFlow code is ${verifyCode}. It works for 10 minutes. Do not share it.`);
    if (!sent.ok) {
      await prisma.joinAttempt.delete({ where: { id: attempt.id } });
      return res.status(502).json({ error: "sms_failed", message: "We could not send the code. Check the number and try again." });
    }
  }
  res.status(201).json({ token, verifyMethod: method, phoneEnding: phone.slice(-3) });
});

async function liveAttempt(token: string) {
  if (!token) return null;
  const a = await prisma.joinAttempt.findUnique({ where: { tokenHash: sha256(token) } });
  if (!a || a.completedAt || a.expiresAt < new Date()) return null;
  return a;
}
const EXPIRED = { error: "attempt_expired", message: "This took too long. Start again from the code." };

joinRouter.post("/resend", async (req, res) => {
  const input = parseOr400(z.object({ token: z.string() }), req.body, res);
  if (!input) return;
  const a = await liveAttempt(input.token);
  if (!a) return res.status(400).json(EXPIRED);
  if (a.verifyMethod !== "SMS") return res.status(400).json({ error: "invalid_input", message: "There is no code to send." });
  if (a.sends >= MAX_SENDS) return res.status(429).json({ error: "too_many_attempts", message: "The code has been sent three times. Start again, or ask your in-charge." });
  const verifyCode = sixDigits();
  const sent = await sendSms(a.phone, `Your HealthFlow code is ${verifyCode}. It works for 10 minutes. Do not share it.`);
  if (!sent.ok) return res.status(502).json({ error: "sms_failed", message: "We could not send the code. Try again in a minute." });
  await prisma.joinAttempt.update({ where: { id: a.id }, data: { verifyCodeHash: sha256(verifyCode), sends: { increment: 1 }, attempts: 0 } });
  res.json({ ok: true });
});

joinRouter.post("/verify", async (req, res) => {
  const input = parseOr400(z.object({ token: z.string(), code: z.string().trim().min(1, "Enter the code.") }), req.body, res);
  if (!input) return;
  const a = await liveAttempt(input.token);
  if (!a) return res.status(400).json(EXPIRED);
  if (a.lockedUntil && a.lockedUntil > new Date()) return res.status(423).json({ error: "locked", message: "Too many wrong codes. Try again in 15 minutes." });
  if (a.verifiedAt) return res.json({ verified: true });
  if (a.sends === 0 || !a.verifyCodeHash) return res.status(400).json({ error: "invalid_input", message: "There is no code to check." });
  const fresh = a.lockedUntil ? 0 : a.attempts; // a lock that has run out starts the count again
  if (sha256(input.code.replace(/\s+/g, "")) === a.verifyCodeHash) {
    await prisma.joinAttempt.update({ where: { id: a.id }, data: { verifiedAt: new Date(), attempts: 0, lockedUntil: null } });
    return res.json({ verified: true });
  }
  const attempts = fresh + 1;
  const lock = attempts >= MAX_CODE_TRIES;
  await prisma.joinAttempt.update({ where: { id: a.id }, data: { attempts: lock ? 0 : attempts, lockedUntil: lock ? new Date(Date.now() + 15 * MIN) : null } });
  if (lock) return res.status(423).json({ error: "locked", message: "Too many wrong codes. Try again in 15 minutes." });
  res.status(400).json({ error: "wrong_code", message: `That code did not match. ${MAX_CODE_TRIES - attempts} ${MAX_CODE_TRIES - attempts === 1 ? "try" : "tries"} left.` });
});

// ------------------------------------------------------------- step 4 and 5: a password, then waiting

joinRouter.get("/:code/notice", async (req, res) => {
  const code = await openCode(String(req.params.code));
  if (!code) return res.status(404).json(BAD_CODE);
  const notice = await currentNotice(code.facilityId);
  res.json({ notice: notice ? { version: notice.version, body: notice.body } : null });
});

const completeInput = z.object({ token: z.string(), password: z.string(), acceptedNoticeVersion: z.string().min(1, "Read and accept the privacy notice.") });

joinRouter.post("/complete", async (req, res) => {
  const input = parseOr400(completeInput, req.body, res);
  if (!input) return;
  const a = await liveAttempt(input.token);
  if (!a) return res.status(400).json(EXPIRED);
  if (a.verifyMethod === "SMS" && !a.verifiedAt) return res.status(400).json({ error: "not_verified", message: "Confirm your phone number first." });

  const code = await prisma.facilityAccessCode.findUnique({ where: { id: a.codeId }, include: { facility: { select: { id: true, name: true } } } });
  if (!code || codeProblem(code)) return res.status(404).json(BAD_CODE);
  const d = a.details as { fullName: string; staffNo: string; email: string | null; cadreId: string | null; departmentId: string | null; cadreText: string | null; departmentText: string | null; position: string | null };

  const notice = await currentNotice(a.facilityId);
  if (!notice) return res.status(409).json({ error: "no_notice", message: "This facility has not published its privacy notice yet. Ask your in-charge." });
  if (notice.version !== input.acceptedNoticeVersion) return res.status(409).json({ error: "notice_changed", message: "The privacy notice was updated while you were reading. Read the new version and accept it." });

  const loginName = d.email ?? phoneLogin(a.phone);
  const problem = checkPassword(input.password, loginName);
  if (problem) return res.status(400).json({ error: "invalid_input", fields: { password: problem } });
  if (await prisma.staff.findFirst({ where: { facilityId: a.facilityId, staffNo: d.staffNo }, select: { id: true } })) return res.status(409).json({ error: "staff_number_taken", message: "That staff number is already registered at this facility." });
  if (await prisma.userProfile.findUnique({ where: { userEmail: loginName }, select: { id: true } })) return res.status(409).json({ error: "account_exists", message: "There is already an account for that phone number or email. Sign in instead." });

  // A phone that could not be checked never skips approval, whatever the facility chose.
  const verified = Boolean(a.verifiedAt);
  const waits = code.requiresApproval || !verified;
  const passwordHash = await hashPassword(input.password);

  const staff = await prisma.$transaction(async (tx) => {
    // The use is counted first, with the limit in the same statement, so two people cannot take the last place.
    const used = await tx.facilityAccessCode.updateMany({
      where: { id: code.id, active: true, revokedAt: null, ...(code.maxUses !== null ? { usesCount: { lt: code.maxUses } } : {}) },
      data: { usesCount: { increment: 1 } },
    });
    if (used.count === 0) return null;
    const s = await tx.staff.create({
      data: {
        facilityId: a.facilityId, staffNo: d.staffNo, fullName: d.fullName, phone: a.phone, email: d.email, cadreId: d.cadreId, departmentId: d.departmentId, position: d.position,
        requestedCadre: d.cadreId ? null : d.cadreText, requestedDepartment: d.departmentId ? null : d.departmentText,
        status: waits ? "PENDING" : "ACTIVE", joinedVia: "CODE", phoneVerified: verified,
      },
    });
    await tx.userProfile.create({
      data: { userEmail: loginName, passwordHash, role: "STAFF", scopeType: "FACILITY", scopeId: a.facilityId, facilityId: a.facilityId, staffId: s.id, active: !waits, privacyNoticeVersionAccepted: notice.version },
    });
    await tx.joinAttempt.update({ where: { id: a.id }, data: { completedAt: new Date() } });
    return s;
  });
  if (!staff) return res.status(404).json(BAD_CODE);

  await writeAuditLog({
    facilityId: a.facilityId, actorEmail: loginName, action: "staff_joined_with_code", entityType: "Staff", entityId: staff.id,
    summary: `${staff.fullName} registered with the facility access code and agreed to version ${notice.version} of the privacy notice. ${waits ? "They are waiting for approval." : "They can sign in now."}${verified ? "" : " Their phone number could not be checked."}`,
  });
  if (waits) {
    await notifyDeciders(a.facilityId, { type: "join_pending", title: `${staff.fullName} is waiting for approval`, body: `${staff.fullName} registered with the access code and waits for you to approve their account.`, linkUrl: "/staff/access", severity: "INFO" });
  }
  res.status(201).json({ status: waits ? "pending" : "active", facilityName: code.facility.name, signInWith: d.email ? "your email" : "your phone number" });
});
