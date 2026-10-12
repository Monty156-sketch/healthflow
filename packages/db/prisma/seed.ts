/**
 * Creates what HealthFlow needs to be usable, and leaves alone anything
 * that already exists, so running it again is safe:
 *
 *   - the Sombo Health Centre facility
 *   - the platform admin (PS Tech)
 *   - a facility admin for Sombo, linked to a staff record, if
 *     SEED_FACILITY_ADMIN_EMAIL is set (until invitations exist, this is how
 *     the first facility admin gets an account)
 *
 * A new account is created with two-step sign-in already enrolled, and its
 * authenticator secret and recovery codes are printed once. An existing
 * account keeps its password and authenticator, unless its email is listed
 * in SEED_RESET_ACCOUNTS.
 *
 * packages/db/.env:
 *   DATABASE_URL
 *   MFA_ENCRYPTION_KEY            same value as the live API (compare fingerprints)
 *   SEED_ADMIN_PASSWORD           platform admin, only used when creating or resetting
 *   SEED_FACILITY_ADMIN_EMAIL     optional
 *   SEED_FACILITY_ADMIN_NAME      their full name, as it should appear in audit entries
 *   SEED_FACILITY_ADMIN_PASSWORD  only used when creating or resetting
 *   SEED_FACILITY_ADMIN_STAFF_NO  optional, defaults to FA-001
 *   SEED_RESET_ACCOUNTS           optional, comma-separated emails to reset
 *
 * Run with: pnpm db:seed
 */
import { PrismaClient, Role, ScopeType, FacilityType } from "../generated/client";
import { hashPassword } from "../../../apps/api/src/lib/password";
import {
  generateMfaSecret,
  otpauthUrl,
  generateRecoveryCodes,
  hashRecoveryCodes,
} from "../../../apps/api/src/lib/mfa";
import { encryptSecret, mfaKeyFingerprint } from "../../../apps/api/src/lib/crypto";
import { config as loadEnv } from "dotenv";
import path from "node:path";

// packages/db/.env is the final word. Without override, a variable already
// set in the shell or in Windows' environment settings silently wins over
// the file, and the seed encrypts with a key the live API does not have.
const ENV_FILE = path.resolve(__dirname, "../.env");
const keyBefore = process.env.MFA_ENCRYPTION_KEY;
loadEnv({ path: ENV_FILE, override: true });
if (keyBefore && keyBefore !== process.env.MFA_ENCRYPTION_KEY) {
  console.warn(
    "WARNING: an MFA_ENCRYPTION_KEY from your system environment was overriding " +
      `${ENV_FILE}. Using the .env value. Remove the system variable to avoid confusion.`
  );
}

const prisma = new PrismaClient();

const PLATFORM_ADMIN_EMAIL = "admin@healthflow.app";
const FACILITY_ID = "sombo-health-centre";

const resetList = new Set(
  (process.env.SEED_RESET_ACCOUNTS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

function requirePassword(envName: string, who: string): string {
  const value = process.env[envName];
  if (!value || value.length < 12) {
    throw new Error(`Set ${envName} in packages/db/.env (at least 12 characters). It becomes ${who}'s password.`);
  }
  return value;
}

/** Fresh password hash plus a newly enrolled authenticator, printed once. */
async function credentials(email: string, password: string) {
  const mfaSecret = generateMfaSecret();
  const recoveryCodes = generateRecoveryCodes();
  return {
    fields: {
      passwordHash: await hashPassword(password),
      mfaEnabled: true,
      mfaSecretEncrypted: encryptSecret(mfaSecret),
      recoveryCodesHashed: await hashRecoveryCodes(recoveryCodes),
      failedAttempts: 0,
      lockedUntil: null,
      active: true,
    },
    print() {
      console.log(`  Add to your authenticator app (time-based):`);
      console.log(`    Account : ${email}`);
      console.log(`    Key     : ${mfaSecret}`);
      console.log(`    or URL  : ${otpauthUrl(mfaSecret, email)}`);
      console.log(`  Recovery codes (each works once; store them safely, never share them):`);
      console.log(`    ${recoveryCodes.join(" ")}`);
    },
  };
}

async function ensurePlatformAdmin() {
  const email = PLATFORM_ADMIN_EMAIL;
  const existing = await prisma.userProfile.findUnique({ where: { userEmail: email } });
  if (existing && !resetList.has(email)) {
    console.log(`Platform admin ${email}: already exists, left unchanged.`);
    return;
  }
  const creds = await credentials(email, requirePassword("SEED_ADMIN_PASSWORD", "the platform admin"));
  await prisma.userProfile.upsert({
    where: { userEmail: email },
    update: creds.fields,
    create: { userEmail: email, role: Role.PLATFORM_ADMIN, scopeType: ScopeType.PLATFORM, ...creds.fields },
  });
  console.log(`Platform admin ${email}: ${existing ? "password and authenticator reset" : "created"}.`);
  creds.print();
}

async function ensureFacilityAdmin() {
  const email = process.env.SEED_FACILITY_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) {
    console.log("Facility admin: SEED_FACILITY_ADMIN_EMAIL not set, skipped.");
    return;
  }
  const existing = await prisma.userProfile.findUnique({ where: { userEmail: email } });
  if (existing && !resetList.has(email)) {
    console.log(`Facility admin ${email}: already exists, left unchanged.`);
    return;
  }

  const name = process.env.SEED_FACILITY_ADMIN_NAME?.trim();
  if (!name) throw new Error("Set SEED_FACILITY_ADMIN_NAME: the facility admin's full name, as audit entries will show it.");
  const creds = await credentials(email, requirePassword("SEED_FACILITY_ADMIN_PASSWORD", "the facility admin"));

  // Link them to a staff record so audit sentences can name them.
  let staffId = existing?.staffId ?? null;
  if (!staffId) {
    const staffNo = process.env.SEED_FACILITY_ADMIN_STAFF_NO?.trim() || "FA-001";
    const staff = await prisma.staff.upsert({
      where: { facilityId_staffNo: { facilityId: FACILITY_ID, staffNo } },
      update: {},
      create: { facilityId: FACILITY_ID, staffNo, fullName: name, email, status: "ACTIVE" },
    });
    staffId = staff.id;
  }

  await prisma.userProfile.upsert({
    where: { userEmail: email },
    update: creds.fields,
    create: {
      userEmail: email,
      role: Role.FACILITY_ADMIN,
      scopeType: ScopeType.FACILITY,
      scopeId: FACILITY_ID,
      facilityId: FACILITY_ID,
      staffId,
      ...creds.fields,
    },
  });
  console.log(`Facility admin ${email} (${name}): ${existing ? "password and authenticator reset" : "created"}.`);
  creds.print();
}

async function main() {
  if (!process.env.MFA_ENCRYPTION_KEY) {
    throw new Error("MFA_ENCRYPTION_KEY is not set in packages/db/.env. Use the same value as the live API.");
  }
  console.log(`MFA key fingerprint: ${mfaKeyFingerprint()}  (must match the one in Render's logs)`);
  console.log("");

  // Created once; never overwritten, because its details are edited in the app.
  const facility = await prisma.facility.upsert({
    where: { id: FACILITY_ID },
    update: {},
    create: {
      id: FACILITY_ID,
      name: "Sombo Health Centre",
      facilityType: FacilityType.HEALTH_CENTRE,
      region: "Upper West",
      subDistrict: "Nadowli-Kaleo",
      status: "TRIAL",
    },
  });
  console.log(`Facility: ${facility.name}`);

  await ensurePlatformAdmin();
  await ensureFacilityAdmin();
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
