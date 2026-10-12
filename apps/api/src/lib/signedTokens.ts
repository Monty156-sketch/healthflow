// Short-lived tokens that need no database table.
//
// Password reset (60 minutes, single use): the signature covers the
// account's current password hash, so the link stops working the moment the
// password changes. Using it once changes the password, which spends it.
//
// MFA enrolment (10 minutes): lets someone who passed their password, but
// whose role requires two-step sign-in they have not set up, do only that.
// Signed with its own derived key so it can never pass as an access token.
//
// Pending authenticator: a new MFA secret is not saved to the account until
// the person proves it works. Until then it travels sealed (AES-GCM) in a
// token, so abandoning setup never replaces a working authenticator.
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { decryptSecret, encryptSecret } from "./crypto.js";

function baseSecret(): string {
  const s = process.env.JWT_ACCESS_SECRET;
  if (!s) throw new Error("JWT_ACCESS_SECRET is not set");
  return s;
}

/** A key per purpose, so a token made for one job is useless for another. */
function derivedKey(purpose: string): Buffer {
  return crypto.createHmac("sha256", baseSecret()).update(`healthflow:${purpose}`).digest();
}

// ------------------------------------------------------------- password reset

export const RESET_LINK_MINUTES = 60;

function resetSignature(userId: string, expires: number, passwordHash: string): string {
  return crypto
    .createHmac("sha256", derivedKey("password-reset"))
    .update(`${userId}|${expires}|${passwordHash}`)
    .digest("base64url");
}

export function makeResetToken(userId: string, passwordHash: string): { token: string; expiresAt: Date } {
  const expires = Date.now() + RESET_LINK_MINUTES * 60 * 1000;
  const token = `${userId}.${expires}.${resetSignature(userId, expires, passwordHash)}`;
  return { token, expiresAt: new Date(expires) };
}

/** Reads a reset token without trusting it: the caller must call verifyResetToken. */
export function parseResetToken(token: string): { userId: string; expires: number; sig: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const expires = Number(parts[1]);
  if (!parts[0] || !Number.isFinite(expires) || !parts[2]) return null;
  return { userId: parts[0], expires, sig: parts[2] };
}

export function verifyResetToken(
  parsed: { userId: string; expires: number; sig: string },
  passwordHash: string
): "ok" | "expired" | "invalid" {
  const expected = Buffer.from(resetSignature(parsed.userId, parsed.expires, passwordHash));
  const given = Buffer.from(parsed.sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return "invalid";
  if (parsed.expires < Date.now()) return "expired";
  return "ok";
}

// ------------------------------------------------------------- MFA enrolment at sign-in

export function makeEnrolmentToken(userId: string): string {
  return jwt.sign({ purpose: "mfa_enrolment" }, derivedKey("mfa-enrolment"), { subject: userId, expiresIn: "10m" });
}

export function readEnrolmentToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, derivedKey("mfa-enrolment")) as jwt.JwtPayload;
    return payload.purpose === "mfa_enrolment" && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- pending authenticator

const SETUP_MINUTES = 15;

export function sealPendingSecret(userId: string, secret: string): string {
  return encryptSecret(JSON.stringify({ u: userId, s: secret, e: Date.now() + SETUP_MINUTES * 60 * 1000 }));
}

export function openPendingSecret(token: string, userId: string): string | null {
  try {
    const { u, s, e } = JSON.parse(decryptSecret(token)) as { u: string; s: string; e: number };
    if (u !== userId || e < Date.now() || typeof s !== "string") return null;
    return s;
  } catch {
    return null;
  }
}
