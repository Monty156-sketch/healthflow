// Signing in and out, sessions, two-step sign-in enrolment at sign-in, and
// password reset. The session cookie is scoped to /api/auth, which is why
// everything that needs it lives here.
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import QRCode from "qrcode";
import type { UserProfile } from "@healthflow/db";
import { prisma } from "../lib/prisma.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import {
  signAccessToken,
  issueRefreshToken,
  consumeRefreshToken,
  revokeRefreshToken,
  revokeAllSessionsForUser,
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
} from "../lib/tokens.js";
import {
  generateMfaSecret,
  otpauthUrl,
  verifyTotp,
  generateRecoveryCodes,
  hashRecoveryCodes,
  consumeRecoveryCode,
} from "../lib/mfa.js";
import { decryptSecret, encryptSecret, sha256 } from "../lib/crypto.js";
import { writeAuditLog } from "../lib/audit.js";
import { authAttemptLimiter } from "../middleware/rateLimit.js";
import { clientIp } from "../lib/clientIp.js";
import { requireAuth } from "../middleware/auth.js";
import { requireLiveUser, liveUser } from "../middleware/liveUser.js";
import { checkPassword } from "../lib/passwordPolicy.js";
import {
  makeEnrolmentToken,
  readEnrolmentToken,
  makeResetToken,
  parseResetToken,
  verifyResetToken,
  sealPendingSecret,
  openPendingSecret,
  RESET_LINK_MINUTES,
} from "../lib/signedTokens.js";
import { appUrl, sendEmail } from "../lib/email.js";
import { describeDevice } from "../lib/userAgent.js";
import { displayDate } from "../lib/labels.js";
import {
  LOCKOUT_AFTER_FAILED_ATTEMPTS,
  LOCKOUT_MINUTES,
  ROLES_REQUIRING_MFA,
  SESSION_IDLE_TIMEOUT_MINUTES,
} from "@healthflow/shared";

export const authRouter = Router();

// ------------------------------------------------------------- helpers

/** The only user fields the browser ever receives. */
export function publicUser(user: Pick<UserProfile, "id" | "userEmail" | "role" | "scopeType" | "facilityId">) {
  return {
    id: user.id,
    email: user.userEmail,
    role: user.role,
    scopeType: user.scopeType,
    facilityId: user.facilityId,
  };
}

/** How a person appears in audit sentences: their staff name when linked. */
async function nameOf(user: Pick<UserProfile, "staffId" | "userEmail">): Promise<string> {
  if (!user.staffId) return user.userEmail;
  const staff = await prisma.staff.findUnique({ where: { id: user.staffId }, select: { fullName: true } });
  return staff?.fullName ?? user.userEmail;
}

/** Wrong passwords and wrong codes both count towards the lockout. */
async function recordFailure(user: UserProfile, what: "password" | "code") {
  const failedAttempts = user.failedAttempts + 1;
  const lockingNow = failedAttempts >= LOCKOUT_AFTER_FAILED_ATTEMPTS;
  await prisma.userProfile.update({
    where: { id: user.id },
    data: {
      failedAttempts: lockingNow ? 0 : failedAttempts,
      lockedUntil: lockingNow ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null,
    },
  });
  await writeAuditLog({
    facilityId: user.facilityId,
    actorEmail: user.userEmail,
    action: what === "password" ? "login_failed" : "mfa_failed",
    entityType: "UserProfile",
    entityId: user.id,
    summary: `A sign-in to ${user.userEmail} failed: wrong ${what === "password" ? "password" : "authentication code"}.${
      lockingNow ? ` The account is locked for ${LOCKOUT_MINUTES} minutes.` : ""
    }`,
  });
}

/** Issues the access token and the session cookie, and records the sign-in. */
export async function startSession(req: Request, res: Response, user: UserProfile, how: string) {
  await prisma.userProfile.update({
    where: { id: user.id },
    data: { failedAttempts: 0, lockedUntil: null, lastSignInAt: new Date() },
  });
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.userEmail,
    role: user.role,
    scopeType: user.scopeType,
    scopeId: user.scopeId,
    facilityId: user.facilityId,
  });
  const refreshToken = await issueRefreshToken({
    userProfileId: user.id,
    facilityId: user.facilityId,
    userAgent: req.headers["user-agent"],
    ipAddress: clientIp(req),
  });
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
  await writeAuditLog({
    facilityId: user.facilityId,
    actorEmail: user.userEmail,
    action: "login_succeeded",
    entityType: "UserProfile",
    entityId: user.id,
    summary: `${await nameOf(user)} signed in${how ? ` ${how}` : ""} on ${describeDevice(req.headers["user-agent"])}.`,
  });
  return accessToken;
}

const normaliseEmail = (e: string) => e.trim().toLowerCase();

// ------------------------------------------------------------- sign in

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  totp: z.string().trim().optional(),
  recoveryCode: z.string().trim().optional(),
});

/**
 * Two steps when two-step sign-in is on: email and password first, which
 * answers { mfaRequired: true }, then the same again with a code. Nothing
 * is issued until both pass. A role that requires two-step sign-in but has
 * none set up gets a 10-minute enrolment token instead of a session.
 */
authRouter.post("/login", authAttemptLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });
  const { password, totp, recoveryCode } = parsed.data;
  const email = normaliseEmail(parsed.data.email);

  const user = await prisma.userProfile.findUnique({ where: { userEmail: email } });
  // The same answer whether or not the account exists.
  if (!user) return res.status(401).json({ error: "invalid_credentials" });

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return res.status(423).json({ error: "account_locked", lockedUntil: user.lockedUntil });
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    await recordFailure(user, "password");
    return res.status(401).json({ error: "invalid_credentials" });
  }

  if (!user.active) return res.status(403).json({ error: "account_inactive" });

  if (user.mfaEnabled) {
    if (!totp && !recoveryCode) return res.status(200).json({ mfaRequired: true });

    let mfaOk = false;
    if (totp && user.mfaSecretEncrypted) {
      let secret: string;
      try {
        secret = decryptSecret(user.mfaSecretEncrypted);
      } catch {
        req.log?.error(
          { userId: user.id },
          "MFA secret could not be decrypted: MFA_ENCRYPTION_KEY does not match the key used when this user's MFA was set up"
        );
        return res.status(500).json({ error: "mfa_key_mismatch" });
      }
      mfaOk = verifyTotp(secret, totp);
    } else if (recoveryCode) {
      const result = await consumeRecoveryCode(user.recoveryCodesHashed, recoveryCode.toUpperCase());
      mfaOk = result.matched;
      if (mfaOk) {
        await prisma.userProfile.update({ where: { id: user.id }, data: { recoveryCodesHashed: result.remaining } });
      }
    }
    if (!mfaOk) {
      await recordFailure(user, "code");
      return res.status(401).json({ error: "invalid_mfa" });
    }
  } else if (ROLES_REQUIRING_MFA.includes(user.role)) {
    // MFA cannot be skipped for this role, so the only thing this person may
    // do now is set it up.
    return res.status(403).json({ error: "mfa_setup_required", enrolmentToken: makeEnrolmentToken(user.id) });
  }

  const accessToken = await startSession(req, res, user, recoveryCode ? "with a recovery code" : "");
  res.json({ accessToken, user: publicUser(user) });
});

// ------------------------------------------------------------- enrolment at sign-in

const enrolStartSchema = z.object({ enrolmentToken: z.string().min(1) });

authRouter.post("/mfa/enrol/start", authAttemptLimiter, async (req, res) => {
  const parsed = enrolStartSchema.safeParse(req.body);
  const userId = parsed.success ? readEnrolmentToken(parsed.data.enrolmentToken) : null;
  if (!userId) return res.status(401).json({ error: "enrolment_expired" });
  const user = await prisma.userProfile.findUnique({ where: { id: userId } });
  if (!user || !user.active || user.mfaEnabled) return res.status(401).json({ error: "enrolment_expired" });

  const secret = generateMfaSecret();
  const url = otpauthUrl(secret, user.userEmail);
  res.json({
    otpauthUrl: url,
    qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 220 }),
    secret,
    setupToken: sealPendingSecret(user.id, secret),
  });
});

const enrolFinishSchema = z.object({
  enrolmentToken: z.string().min(1),
  setupToken: z.string().min(1),
  totp: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code."),
});

authRouter.post("/mfa/enrol/finish", authAttemptLimiter, async (req, res) => {
  const parsed = enrolFinishSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });
  const userId = readEnrolmentToken(parsed.data.enrolmentToken);
  if (!userId) return res.status(401).json({ error: "enrolment_expired" });
  const user = await prisma.userProfile.findUnique({ where: { id: userId } });
  if (!user || !user.active || user.mfaEnabled) return res.status(401).json({ error: "enrolment_expired" });

  const secret = openPendingSecret(parsed.data.setupToken, user.id);
  if (!secret) return res.status(401).json({ error: "enrolment_expired" });
  if (!verifyTotp(secret, parsed.data.totp)) return res.status(401).json({ error: "invalid_code" });

  const recoveryCodes = generateRecoveryCodes();
  const updated = await prisma.userProfile.update({
    where: { id: user.id },
    data: {
      mfaEnabled: true,
      mfaSecretEncrypted: encryptSecret(secret),
      recoveryCodesHashed: await hashRecoveryCodes(recoveryCodes),
    },
  });
  await writeAuditLog({
    facilityId: user.facilityId,
    actorEmail: user.userEmail,
    action: "mfa_enabled",
    entityType: "UserProfile",
    entityId: user.id,
    summary: `${await nameOf(user)} set up two-step sign-in.`,
  });

  const accessToken = await startSession(req, res, updated, "for the first time with two-step sign-in");
  // Shown once. The screen asks the person to save them before continuing.
  res.json({ accessToken, user: publicUser(updated), recoveryCodes });
});

// ------------------------------------------------------------- refresh and sign out

/** Rotates the session cookie on every use and issues a fresh access token. */
authRouter.post("/refresh", async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!raw) return res.status(401).json({ error: "no_refresh_token" });

  const outcome = await consumeRefreshToken(raw);
  if (!outcome.ok) {
    res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
    const status = outcome.reason === "account_inactive" ? 403 : 401;
    return res.status(status).json({ error: outcome.reason });
  }

  const user = await prisma.userProfile.findUnique({ where: { id: outcome.userProfileId } });
  if (!user || !user.active) return res.status(403).json({ error: "account_inactive" });

  await revokeRefreshToken(raw, "rotated");
  const refreshToken = await issueRefreshToken({
    userProfileId: user.id,
    facilityId: user.facilityId,
    userAgent: req.headers["user-agent"],
    ipAddress: clientIp(req),
  });
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());

  const accessToken = signAccessToken({
    sub: user.id,
    email: user.userEmail,
    role: user.role,
    scopeType: user.scopeType,
    scopeId: user.scopeId,
    facilityId: user.facilityId,
  });
  // After a page reload the browser has only the cookie, so it needs to
  // know who is signed in, not just a token.
  res.json({ accessToken, user: publicUser(user) });
});

authRouter.post("/logout", async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE_NAME];
  if (raw) await revokeRefreshToken(raw, "logout");
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
  res.status(204).send();
});

// ------------------------------------------------------------- sessions

/** Live sessions: not revoked, not expired, used within the idle window. */
function liveSessionWhere(userProfileId: string) {
  return {
    userProfileId,
    revokedAt: null,
    expiresAt: { gt: new Date() },
    lastUsedAt: { gt: new Date(Date.now() - SESSION_IDLE_TIMEOUT_MINUTES * 60 * 1000) },
  };
}

authRouter.get("/sessions", requireAuth, requireLiveUser, async (req, res) => {
  const me = liveUser(req);
  const currentHash = req.cookies?.[REFRESH_COOKIE_NAME] ? sha256(req.cookies[REFRESH_COOKIE_NAME]) : null;
  const rows = await prisma.refreshToken.findMany({
    where: liveSessionWhere(me.id),
    orderBy: { lastUsedAt: "desc" },
  });
  res.json({
    sessions: rows.map((r) => ({
      id: r.id,
      device: describeDevice(r.userAgent),
      lastActiveAt: r.lastUsedAt,
      current: r.tokenHash === currentHash,
    })),
  });
});

authRouter.post("/sessions/:id/revoke", requireAuth, requireLiveUser, async (req, res) => {
  const me = liveUser(req);
  const row = await prisma.refreshToken.findFirst({ where: { id: String(req.params.id), userProfileId: me.id } });
  if (!row) return res.status(404).json({ error: "not_found" });
  await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date(), revokedReason: "signed_out_by_user" } });
  await writeAuditLog({
    facilityId: me.facilityId,
    actorEmail: me.email,
    action: "session_revoked",
    entityType: "UserProfile",
    entityId: me.id,
    summary: `${me.displayName} signed out their session on ${describeDevice(row.userAgent)}.`,
  });
  res.status(204).send();
});

/** Every other device; this one stays signed in. */
authRouter.post("/sessions/revoke-others", requireAuth, requireLiveUser, async (req, res) => {
  const me = liveUser(req);
  const currentHash = req.cookies?.[REFRESH_COOKIE_NAME] ? sha256(req.cookies[REFRESH_COOKIE_NAME]) : "";
  const result = await prisma.refreshToken.updateMany({
    where: { userProfileId: me.id, revokedAt: null, tokenHash: { not: currentHash } },
    data: { revokedAt: new Date(), revokedReason: "signed_out_other_devices" },
  });
  await writeAuditLog({
    facilityId: me.facilityId,
    actorEmail: me.email,
    action: "sessions_revoked",
    entityType: "UserProfile",
    entityId: me.id,
    summary: `${me.displayName} signed out of every other device.`,
  });
  res.json({ signedOut: result.count });
});

/** Every device, including this one. */
authRouter.post("/logout-everywhere", requireAuth, requireLiveUser, async (req, res) => {
  const me = liveUser(req);
  await revokeAllSessionsForUser(me.id, "sign_out_everywhere");
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
  await writeAuditLog({
    facilityId: me.facilityId,
    actorEmail: me.email,
    action: "logout_everywhere",
    entityType: "UserProfile",
    entityId: me.id,
    summary: `${me.displayName} signed out on every device.`,
  });
  res.status(204).send();
});

// ------------------------------------------------------------- password reset

const forgotSchema = z.object({ email: z.string().trim().email() });

/**
 * Always answers the same way, whether or not the email has an account, so
 * this cannot be used to find out who uses HealthFlow.
 */
authRouter.post("/forgot-password", authAttemptLimiter, async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", fields: { email: "Enter your email address." } });
  const email = normaliseEmail(parsed.data.email);

  const user = await prisma.userProfile.findUnique({ where: { userEmail: email } });
  if (user && user.active) {
    const { token } = makeResetToken(user.id, user.passwordHash);
    const link = appUrl(`/reset-password?token=${encodeURIComponent(token)}`);
    const sent = await sendEmail({
      to: user.userEmail,
      subject: "Reset your HealthFlow password",
      text:
        `Someone asked to reset the password for ${user.userEmail} on HealthFlow.\n\n` +
        `To choose a new password, open this link. It works once, for the next ${RESET_LINK_MINUTES} minutes:\n${link}\n\n` +
        `If this was not you, ignore this email. Your password stays the same.`,
    });
    await writeAuditLog({
      facilityId: user.facilityId,
      actorEmail: user.userEmail,
      action: "password_reset_requested",
      entityType: "UserProfile",
      entityId: user.id,
      summary: sent
        ? `A password reset link was emailed to ${user.userEmail}.`
        : `A password reset was requested for ${user.userEmail}, but email is not set up, so no link was sent.`,
    });
  }
  res.status(202).json({ ok: true });
});

/** Lets the reset screen say "this link has expired" before anyone types a password. */
authRouter.get("/reset-password/check", async (req, res) => {
  const parsed = parseResetToken(String(req.query.token ?? ""));
  if (!parsed) return res.json({ status: "invalid" });
  const user = await prisma.userProfile.findUnique({ where: { id: parsed.userId } });
  if (!user || !user.active) return res.json({ status: "invalid" });
  res.json({ status: verifyResetToken(parsed, user.passwordHash) });
});

const resetSchema = z.object({ token: z.string().min(1), password: z.string() });

authRouter.post("/reset-password", authAttemptLimiter, async (req, res) => {
  const body = resetSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_body" });
  const parsed = parseResetToken(body.data.token);
  const user = parsed ? await prisma.userProfile.findUnique({ where: { id: parsed.userId } }) : null;
  const status = parsed && user && user.active ? verifyResetToken(parsed, user.passwordHash) : "invalid";
  if (status !== "ok" || !user) {
    return res.status(400).json({
      error: status === "expired" ? "link_expired" : "link_invalid",
      message:
        status === "expired"
          ? "This link has expired. Ask for a new one."
          : "This link is not valid. It may already have been used. Ask for a new one.",
    });
  }

  const problem = checkPassword(body.data.password, user.userEmail);
  if (problem) return res.status(400).json({ error: "invalid_input", fields: { password: problem } });

  await prisma.userProfile.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(body.data.password), failedAttempts: 0, lockedUntil: null },
  });
  // Spec: a reset invalidates every existing session.
  await revokeAllSessionsForUser(user.id, "password_reset");
  await writeAuditLog({
    facilityId: user.facilityId,
    actorEmail: user.userEmail,
    action: "password_reset",
    entityType: "UserProfile",
    entityId: user.id,
    summary: `${await nameOf(user)} reset their password on ${displayDate(new Date())}. They were signed out on every device.`,
  });
  res.json({ ok: true, minutes: RESET_LINK_MINUTES });
});
