// Two kinds of token, deliberately different:
//
// - The ACCESS token is a signed JWT, short-lived (15 min), carried as an
//   Authorization header and never written to a cookie or localStorage. It
//   is stateless by design — any API instance can verify it without a
//   database round trip.
//
// - The REFRESH token is an opaque random string, stored only as a hash in
//   the RefreshToken table, set as an httpOnly/Secure/SameSite=Strict
//   cookie. Every refresh call checks the database row, not just the
//   token's own signature, which is what makes immediate revocation
//   possible: deactivating a staff member or signing out everywhere is a
//   single row update, and the very next refresh attempt fails. A JWT
//   alone cannot be revoked before it expires; this can.
import jwt from "jsonwebtoken";
import {
  ACCESS_TOKEN_TTL_MINUTES,
  REFRESH_TOKEN_TTL_DAYS,
  SESSION_IDLE_TIMEOUT_MINUTES,
} from "@healthflow/shared";
import type { Role, ScopeType } from "@healthflow/db";
import { prisma } from "./prisma.js";
import { randomToken, sha256 } from "./crypto.js";

export interface AccessTokenPayload {
  sub: string; // UserProfile.id
  email: string;
  role: Role;
  scopeType: ScopeType;
  scopeId: string | null;
  facilityId: string | null;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET is not set");
  return jwt.sign(payload, secret, { expiresIn: `${ACCESS_TOKEN_TTL_MINUTES}m` });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET is not set");
  return jwt.verify(token, secret) as AccessTokenPayload;
}

export async function issueRefreshToken(params: {
  userProfileId: string;
  facilityId: string | null;
  userAgent?: string;
  ipAddress?: string;
}): Promise<string> {
  const raw = randomToken(48);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: {
      userProfileId: params.userProfileId,
      facilityId: params.facilityId,
      tokenHash: sha256(raw),
      userAgent: params.userAgent,
      ipAddress: params.ipAddress,
      expiresAt,
    },
  });
  return raw;
}

export type RefreshOutcome =
  | { ok: true; userProfileId: string; facilityId: string | null; tokenRowId: string }
  | { ok: false; reason: "not_found" | "revoked" | "expired" | "idle_timeout" | "account_inactive" };

/**
 * Looks up the refresh token's own database row rather than trusting the
 * raw string, applies the 30-minute idle timeout, and checks the owning
 * account is still active — this is where "deactivation revokes access
 * immediately" actually happens, not in a signed token's exp claim.
 */
export async function consumeRefreshToken(rawToken: string): Promise<RefreshOutcome> {
  const tokenHash = sha256(rawToken);
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { userProfile: true },
  });

  if (!row) return { ok: false, reason: "not_found" };
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (row.expiresAt < new Date()) return { ok: false, reason: "expired" };
  if (!row.userProfile.active) return { ok: false, reason: "account_inactive" };

  const idleCutoff = new Date(Date.now() - SESSION_IDLE_TIMEOUT_MINUTES * 60 * 1000);
  if (row.lastUsedAt < idleCutoff) {
    await prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date(), revokedReason: "idle_timeout" },
    });
    return { ok: false, reason: "idle_timeout" };
  }

  await prisma.refreshToken.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    ok: true,
    userProfileId: row.userProfileId,
    facilityId: row.facilityId,
    tokenRowId: row.id,
  };
}

export async function revokeRefreshToken(rawToken: string, reason: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(rawToken) },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

/** Sign-out-everywhere, and the immediate-revocation-on-deactivation path. */
export async function revokeAllSessionsForUser(userProfileId: string, reason: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userProfileId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

export const REFRESH_COOKIE_NAME = "hf_refresh";

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/api/auth",
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}
