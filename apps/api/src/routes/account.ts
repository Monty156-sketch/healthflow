// The signed-in person's own account: password and two-step sign-in.
// Every change here asks for the current password again, so someone who
// finds an unlocked screen cannot take the account over. Wrong passwords
// count towards the same lockout as sign-in.
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import QRCode from "qrcode";
import { ROLES_REQUIRING_MFA, LOCKOUT_AFTER_FAILED_ATTEMPTS, LOCKOUT_MINUTES } from "@healthflow/shared";
import { prisma } from "../lib/prisma.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { encryptSecret, sha256 } from "../lib/crypto.js";
import { generateMfaSecret, otpauthUrl, verifyTotp, generateRecoveryCodes, hashRecoveryCodes } from "../lib/mfa.js";
import { sealPendingSecret, openPendingSecret } from "../lib/signedTokens.js";
import { checkPassword } from "../lib/passwordPolicy.js";
import { writeAuditLog } from "../lib/audit.js";
import { REFRESH_COOKIE_NAME } from "../lib/tokens.js";
import { requireAuth } from "../middleware/auth.js";
import { requireLiveUser, liveUser } from "../middleware/liveUser.js";
import { authAttemptLimiter } from "../middleware/rateLimit.js";

export const accountRouter = Router();
accountRouter.use(requireAuth, requireLiveUser);

/**
 * Checks the current password. On a mismatch it answers the request itself
 * (field error, or 423 once locked) and returns false.
 */
async function confirmPassword(req: Request, res: Response, given: unknown): Promise<boolean> {
  const me = liveUser(req);
  const user = await prisma.userProfile.findUniqueOrThrow({ where: { id: me.id } });
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    res.status(423).json({ error: "account_locked", message: `Too many wrong passwords. Try again in ${LOCKOUT_MINUTES} minutes.` });
    return false;
  }
  if (typeof given === "string" && given && (await verifyPassword(user.passwordHash, given))) {
    if (user.failedAttempts) await prisma.userProfile.update({ where: { id: user.id }, data: { failedAttempts: 0 } });
    return true;
  }
  const failedAttempts = user.failedAttempts + 1;
  const locking = failedAttempts >= LOCKOUT_AFTER_FAILED_ATTEMPTS;
  await prisma.userProfile.update({
    where: { id: user.id },
    data: {
      failedAttempts: locking ? 0 : failedAttempts,
      lockedUntil: locking ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null,
    },
  });
  res.status(400).json({ error: "invalid_input", fields: { currentPassword: "That is not your current password." } });
  return false;
}

// ------------------------------------------------------------- summary

accountRouter.get("/", async (req, res) => {
  const me = liveUser(req);
  const user = await prisma.userProfile.findUniqueOrThrow({ where: { id: me.id } });
  res.json({
    account: {
      email: user.userEmail,
      displayName: me.displayName,
      role: user.role,
      mfaEnabled: user.mfaEnabled,
      mfaRequired: ROLES_REQUIRING_MFA.includes(user.role),
      recoveryCodesLeft: user.mfaEnabled ? user.recoveryCodesHashed.length : 0,
      lastSignInAt: user.lastSignInAt,
    },
  });
});

// ------------------------------------------------------------- password

const passwordSchema = z.object({ currentPassword: z.string(), newPassword: z.string() });

/** Changes the password and signs out every other device. */
accountRouter.post("/password", authAttemptLimiter, async (req, res) => {
  const me = liveUser(req);
  const body = passwordSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_body" });
  if (!(await confirmPassword(req, res, body.data.currentPassword))) return;

  const problem = checkPassword(body.data.newPassword, me.email);
  if (problem) return res.status(400).json({ error: "invalid_input", fields: { newPassword: problem } });
  if (body.data.newPassword === body.data.currentPassword) {
    return res.status(400).json({ error: "invalid_input", fields: { newPassword: "Choose a password different from your current one." } });
  }

  await prisma.userProfile.update({ where: { id: me.id }, data: { passwordHash: await hashPassword(body.data.newPassword) } });
  const currentHash = req.cookies?.[REFRESH_COOKIE_NAME] ? sha256(req.cookies[REFRESH_COOKIE_NAME]) : "";
  const ended = await prisma.refreshToken.updateMany({
    where: { userProfileId: me.id, revokedAt: null, tokenHash: { not: currentHash } },
    data: { revokedAt: new Date(), revokedReason: "password_changed" },
  });
  await writeAuditLog({
    facilityId: me.facilityId,
    actorEmail: me.email,
    action: "password_changed",
    entityType: "UserProfile",
    entityId: me.id,
    summary: `${me.displayName} changed their password${ended.count ? " and was signed out on every other device" : ""}.`,
  });
  res.json({ ok: true, otherDevicesSignedOut: ended.count });
});

// ------------------------------------------------------------- two-step sign-in

const confirmSchema = z.object({ currentPassword: z.string() });

/**
 * Step 1 of setting up or replacing the authenticator. The new secret is not
 * saved yet: it travels sealed in setupToken until a code proves it works,
 * so abandoning here never breaks a working authenticator.
 */
accountRouter.post("/mfa/start", authAttemptLimiter, async (req, res) => {
  const me = liveUser(req);
  const body = confirmSchema.safeParse(req.body);
  if (!(await confirmPassword(req, res, body.success ? body.data.currentPassword : undefined))) return;
  const secret = generateMfaSecret();
  const url = otpauthUrl(secret, me.email);
  res.json({
    otpauthUrl: url,
    qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 220 }),
    secret,
    setupToken: sealPendingSecret(me.id, secret),
  });
});

const finishSchema = z.object({
  setupToken: z.string().min(1),
  totp: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your app."),
});

/** Step 2: a code from the new authenticator switches it on; new recovery codes are issued once. */
accountRouter.post("/mfa/finish", authAttemptLimiter, async (req, res) => {
  const me = liveUser(req);
  const body = finishSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_input", fields: { totp: "Enter the 6-digit code from your app." } });
  const secret = openPendingSecret(body.data.setupToken, me.id);
  if (!secret) return res.status(400).json({ error: "setup_expired", message: "Setup took too long. Start again." });
  if (!verifyTotp(secret, body.data.totp)) {
    return res.status(400).json({ error: "invalid_input", fields: { totp: "That code did not match. Check the time on your phone and try the newest code." } });
  }

  const wasEnabled = (await prisma.userProfile.findUniqueOrThrow({ where: { id: me.id } })).mfaEnabled;
  const recoveryCodes = generateRecoveryCodes();
  await prisma.userProfile.update({
    where: { id: me.id },
    data: { mfaEnabled: true, mfaSecretEncrypted: encryptSecret(secret), recoveryCodesHashed: await hashRecoveryCodes(recoveryCodes) },
  });
  await writeAuditLog({
    facilityId: me.facilityId,
    actorEmail: me.email,
    action: wasEnabled ? "mfa_replaced" : "mfa_enabled",
    entityType: "UserProfile",
    entityId: me.id,
    summary: wasEnabled
      ? `${me.displayName} moved two-step sign-in to a new authenticator. Their old recovery codes no longer work.`
      : `${me.displayName} set up two-step sign-in.`,
  });
  res.json({ recoveryCodes });
});

/** New recovery codes; the old ones stop working. */
accountRouter.post("/mfa/recovery-codes", authAttemptLimiter, async (req, res) => {
  const me = liveUser(req);
  const body = confirmSchema.safeParse(req.body);
  if (!(await confirmPassword(req, res, body.success ? body.data.currentPassword : undefined))) return;
  const user = await prisma.userProfile.findUniqueOrThrow({ where: { id: me.id } });
  if (!user.mfaEnabled) return res.status(409).json({ error: "mfa_off", message: "Two-step sign-in is not set up." });
  const recoveryCodes = generateRecoveryCodes();
  await prisma.userProfile.update({ where: { id: me.id }, data: { recoveryCodesHashed: await hashRecoveryCodes(recoveryCodes) } });
  await writeAuditLog({
    facilityId: me.facilityId,
    actorEmail: me.email,
    action: "recovery_codes_replaced",
    entityType: "UserProfile",
    entityId: me.id,
    summary: `${me.displayName} created new recovery codes. The previous ones no longer work.`,
  });
  res.json({ recoveryCodes });
});

/** Only for roles where it is optional; admins can never turn it off. */
accountRouter.post("/mfa/disable", authAttemptLimiter, async (req, res) => {
  const me = liveUser(req);
  if (ROLES_REQUIRING_MFA.includes(me.role)) {
    return res.status(403).json({ error: "mfa_required_for_role", message: "Your role requires two-step sign-in, so it cannot be turned off." });
  }
  const body = confirmSchema.safeParse(req.body);
  if (!(await confirmPassword(req, res, body.success ? body.data.currentPassword : undefined))) return;
  await prisma.userProfile.update({
    where: { id: me.id },
    data: { mfaEnabled: false, mfaSecretEncrypted: null, recoveryCodesHashed: [] },
  });
  await writeAuditLog({
    facilityId: me.facilityId,
    actorEmail: me.email,
    action: "mfa_disabled",
    entityType: "UserProfile",
    entityId: me.id,
    summary: `${me.displayName} turned off two-step sign-in.`,
  });
  res.json({ ok: true });
});
