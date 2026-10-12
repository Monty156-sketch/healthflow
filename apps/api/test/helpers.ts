// Shared set-up for the integration tests: a clean database, people with
// known roles, and signed access tokens for them.
import request from "supertest";
import { authenticator } from "otplib";
import type { Role } from "@healthflow/db";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/password.js";
import { encryptSecret } from "../src/lib/crypto.js";
import { signAccessToken } from "../src/lib/tokens.js";

export const app = createApp();
export { prisma };

/** Empties every table, keeping the migration history. */
export async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
  }
}

let counter = 0;
const next = () => ++counter;

export async function makeFacility(name = `Facility ${next()}`) {
  return prisma.facility.create({ data: { name, facilityType: "HEALTH_CENTRE" } });
}

export const PASSWORD = "correct horse battery staple";

/**
 * A person who can sign in. Facility-scoped unless role is PLATFORM_ADMIN.
 * With withStaff, they also get a linked Staff record (so their name shows
 * in audit sentences and their status can be changed).
 */
export async function makeUser(opts: {
  role: Role;
  facilityId?: string;
  withStaff?: { fullName: string };
  mfa?: boolean;
}) {
  const n = next();
  const mfaSecret = authenticator.generateSecret();
  const staff =
    opts.withStaff && opts.facilityId
      ? await prisma.staff.create({
          data: {
            facilityId: opts.facilityId,
            staffNo: `T${n}`,
            fullName: opts.withStaff.fullName,
            status: "ACTIVE",
          },
        })
      : null;
  const platform = opts.role === "PLATFORM_ADMIN";
  const user = await prisma.userProfile.create({
    data: {
      userEmail: `user${n}@example.test`,
      passwordHash: await hashPassword(PASSWORD),
      role: opts.role,
      scopeType: platform ? "PLATFORM" : "FACILITY",
      scopeId: platform ? null : opts.facilityId,
      facilityId: platform ? null : opts.facilityId,
      staffId: staff?.id,
      mfaEnabled: opts.mfa ?? false,
      mfaSecretEncrypted: opts.mfa ? encryptSecret(mfaSecret) : null,
    },
  });
  return { user, staff, mfaSecret };
}

export function tokenFor(user: {
  id: string;
  userEmail: string;
  role: Role;
  scopeType: "FACILITY" | "DISTRICT" | "PLATFORM";
  scopeId: string | null;
  facilityId: string | null;
}) {
  return signAccessToken({
    sub: user.id,
    email: user.userEmail,
    role: user.role,
    scopeType: user.scopeType,
    scopeId: user.scopeId,
    facilityId: user.facilityId,
  });
}

/** An authenticated request helper bound to one person. */
export function as(user: Parameters<typeof tokenFor>[0]) {
  const auth = `Bearer ${tokenFor(user)}`;
  return {
    get: (url: string) => request(app).get(url).set("Authorization", auth),
    post: (url: string, body?: object) => request(app).post(url).set("Authorization", auth).send(body ?? {}),
    patch: (url: string, body?: object) => request(app).patch(url).set("Authorization", auth).send(body ?? {}),
    delete: (url: string) => request(app).delete(url).set("Authorization", auth),
  };
}

/** A fresh client IP per call, so the 5-per-hour login limit never trips across tests. */
let ip = 0;
export function freshIp() {
  ip += 1;
  return `10.0.${Math.floor(ip / 250)}.${ip % 250}`;
}

export function totp(secret: string) {
  return authenticator.generate(secret);
}
