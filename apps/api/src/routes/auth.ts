import { Router } from "express";
import { z } from "zod";
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
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import { writeAuditLog } from "../lib/audit.js";
import { authAttemptLimiter } from "../middleware/rateLimit.js";
import { clientIp } from "../lib/clientIp.js";
import { requireAuth } from "../middleware/auth.js";
import {
  LOCKOUT_AFTER_FAILED_ATTEMPTS,
  LOCKOUT_MINUTES,
  ROLES_REQUIRING_MFA,
} from "@healthflow/shared";

/** The only user fields the browser ever receives. */
function publicUser(user: {
  id: string;
  userEmail: string;
  role: string;
  scopeType: string;
  facilityId: string | null;
}) {
  return {
    id: user.id,
    email: user.userEmail,
    role: user.role,
    scopeType: user.scopeType,
    facilityId: user.facilityId,
  };
}

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp: z.string().optional(),
  recoveryCode: z.string().optional(),
});

/**
 * Login is a two-step conversation when MFA is enabled: a first call with
 * just email/password returns { mfaRequired: true } rather than a token
 * pair, and the client re-submits with `totp` (or `recoveryCode`) added.
 * Nothing issued before MFA passes.
 */
authRouter.post("/login", authAttemptLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });
  const { email, password, totp, recoveryCode } = parsed.data;

  const user = await prisma.userProfile.findUnique({ where: { userEmail: email } });

  // Same response shape whether the account exists or not, so login
  // cannot be used to enumerate registered emails.
  const genericFailure = () => res.status(401).json({ error: "invalid_credentials" });

  if (!user) return genericFailure();

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return res.status(423).json({
      error: "account_locked",
      lockedUntil: user.lockedUntil,
    });
  }

  const passwordOk = await verifyPassword(user.passwordHash, password);
  if (!passwordOk) {
    const failedAttempts = user.failedAttempts + 1;
    const lockingNow = failedAttempts >= LOCKOUT_AFTER_FAILED_ATTEMPTS;
    await prisma.userProfile.update({
      where: { id: user.id },
      data: {
        failedAttempts: lockingNow ? 0 : failedAttempts,
        lockedUntil: lockingNow
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
          : null,
      },
    });
    await writeAuditLog({
      facilityId: user.facilityId,
      actorEmail: email,
      action: "login_failed",
      entityType: "UserProfile",
      entityId: user.id,
      summary: `Failed sign-in attempt for ${email}${lockingNow ? " — account locked for " + LOCKOUT_MINUTES + " minutes" : ""}.`,
    });
    return genericFailure();
  }

  if (!user.active) {
    return res.status(403).json({ error: "account_inactive" });
  }

  if (user.mfaEnabled) {
    if (!totp && !recoveryCode) {
      return res.status(200).json({ mfaRequired: true });
    }
    let mfaOk = false;
    if (totp && user.mfaSecretEncrypted) {
      let secret: string;
      try {
        secret = decryptSecret(user.mfaSecretEncrypted);
      } catch {
        // Only happens when this server's MFA_ENCRYPTION_KEY differs from
        // the key the secret was encrypted with (e.g. seeded with another
        // .env). Say so plainly in the logs instead of a bare stack trace.
        req.log?.error(
          { userId: user.id },
          "MFA secret could not be decrypted: MFA_ENCRYPTION_KEY does not match the key used when this user's MFA was set up"
        );
        return res.status(500).json({ error: "mfa_key_mismatch" });
      }
      mfaOk = verifyTotp(secret, totp);
    } else if (recoveryCode) {
      const result = await consumeRecoveryCode(user.recoveryCodesHashed, recoveryCode);
      mfaOk = result.matched;
      if (mfaOk) {
        await prisma.userProfile.update({
          where: { id: user.id },
          data: { recoveryCodesHashed: result.remaining },
        });
      }
    }
    if (!mfaOk) {
      await writeAuditLog({
        facilityId: user.facilityId,
        actorEmail: email,
        action: "mfa_failed",
        entityType: "UserProfile",
        entityId: user.id,
        summary: `Failed MFA challenge for ${email}.`,
      });
      return res.status(401).json({ error: "invalid_mfa" });
    }
  } else if (ROLES_REQUIRING_MFA.includes(user.role)) {
    // Spec: MFA cannot be skipped for these roles. If it somehow isn't
    // set up yet, force setup before issuing tokens rather than letting
    // the role through unprotected.
    return res.status(403).json({ error: "mfa_setup_required" });
  }

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
    actorEmail: email,
    action: "login_succeeded",
    entityType: "UserProfile",
    entityId: user.id,
    summary: `${email} signed in.`,
  });

  res.json({ accessToken, user: publicUser(user) });
});

/** Rotates the refresh token on every use (reduces replay risk) and issues a fresh access token. */
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
  if (!user || !user.active) {
    return res.status(403).json({ error: "account_inactive" });
  }

  // Rotate: revoke the one just used, issue a new one.
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

  // The user is returned too: after a page reload the browser has nothing
  // but the cookie, and needs to know who is signed in, not just a token.
  res.json({ accessToken, user: publicUser(user) });
});

authRouter.post("/logout", async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE_NAME];
  if (raw) await revokeRefreshToken(raw, "logout");
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
  res.status(204).send();
});

/** "Sign out everywhere" — Part 8, section 2.3's account screen. */
authRouter.post("/logout-everywhere", requireAuth, async (req, res) => {
  await revokeAllSessionsForUser(req.auth!.sub, "sign_out_everywhere");
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
  await writeAuditLog({
    facilityId: req.auth!.facilityId,
    actorEmail: req.auth!.email,
    action: "logout_everywhere",
    entityType: "UserProfile",
    entityId: req.auth!.sub,
    summary: `${req.auth!.email} signed out of all sessions.`,
  });
  res.status(204).send();
});

/** Step 1 of MFA setup: generate a secret and QR, not yet enabled. */
authRouter.post("/mfa/setup", requireAuth, async (req, res) => {
  const secret = generateMfaSecret();
  const url = otpauthUrl(secret, req.auth!.email);
  // Stored encrypted but NOT marked enabled until the user proves they can
  // generate a valid code with it (verify step below) — otherwise a user
  // who abandons setup mid-way could be locked out by a secret nobody has.
  await prisma.userProfile.update({
    where: { id: req.auth!.sub },
    data: { mfaSecretEncrypted: encryptSecret(secret) },
  });
  res.json({ otpauthUrl: url });
});

const verifyMfaSchema = z.object({ totp: z.string().length(6) });

/** Step 2: proves the secret works, turns MFA on, and issues the ten recovery codes once. */
authRouter.post("/mfa/verify-setup", requireAuth, async (req, res) => {
  const parsed = verifyMfaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });

  const user = await prisma.userProfile.findUnique({ where: { id: req.auth!.sub } });
  if (!user?.mfaSecretEncrypted) return res.status(400).json({ error: "mfa_not_initiated" });

  const ok = verifyTotp(decryptSecret(user.mfaSecretEncrypted), parsed.data.totp);
  if (!ok) return res.status(401).json({ error: "invalid_code" });

  const recoveryCodes = generateRecoveryCodes();
  const hashed = await hashRecoveryCodes(recoveryCodes);

  await prisma.userProfile.update({
    where: { id: user.id },
    data: { mfaEnabled: true, recoveryCodesHashed: hashed },
  });

  await writeAuditLog({
    facilityId: user.facilityId,
    actorEmail: user.userEmail,
    action: "mfa_enabled",
    entityType: "UserProfile",
    entityId: user.id,
    summary: `${user.userEmail} enabled multi-factor authentication.`,
  });

  // Shown once — the client is responsible for prompting the user to save them.
  res.json({ recoveryCodes });
});
