/**
 * Seeds one facility (Sombo Health Centre) with a platform admin account,
 * MFA secret and recovery codes, so Phase 0 can be checked end to end.
 *
 * PLATFORM_ADMIN is in ROLES_REQUIRING_MFA, so the admin must be seeded
 * with MFA already enrolled or login returns 403 mfa_setup_required.
 *
 * Requires in packages/db/.env:
 *   DATABASE_URL
 *   MFA_ENCRYPTION_KEY   (must match apps/api/.env exactly)
 *   SEED_ADMIN_PASSWORD
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
import { encryptSecret } from "../../../apps/api/src/lib/crypto";

const prisma = new PrismaClient();

const ADMIN_EMAIL = "admin@healthflow.app";

async function main() {
  if (!process.env.MFA_ENCRYPTION_KEY) {
    throw new Error(
      "MFA_ENCRYPTION_KEY is not set. Add it to packages/db/.env with the " +
        "same value as apps/api/.env, or the seeded MFA secret will not decrypt."
    );
  }

  const facility = await prisma.facility.upsert({
    where: { id: "sombo-health-centre" },
    update: {
      name: "Sombo Health Centre",
      facilityType: FacilityType.HEALTH_CENTRE,
      region: "Upper West",
      subDistrict: "Nadowli-Kaleo",
    },
    create: {
      id: "sombo-health-centre",
      name: "Sombo Health Centre",
      facilityType: FacilityType.HEALTH_CENTRE,
      region: "Upper West",
      subDistrict: "Nadowli-Kaleo",
      status: "TRIAL",
    },
  });

  // No fallback: a default password committed to git is a password anyone
  // reading the repo knows.
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword || adminPassword.length < 12) {
    throw new Error(
      "Set SEED_ADMIN_PASSWORD in packages/db/.env (at least 12 characters). " +
        "This becomes the admin's password in the database."
    );
  }
  const adminPasswordHash = await hashPassword(adminPassword);

  const mfaSecret = generateMfaSecret();
  const recoveryCodes = generateRecoveryCodes();
  const recoveryCodesHashed = await hashRecoveryCodes(recoveryCodes);

  const adminFields = {
    passwordHash: adminPasswordHash,
    role: Role.PLATFORM_ADMIN,
    scopeType: ScopeType.PLATFORM,
    active: true,
    mfaEnabled: true,
    mfaSecretEncrypted: encryptSecret(mfaSecret),
    recoveryCodesHashed,
    failedAttempts: 0,
    lockedUntil: null,
  };

  await prisma.userProfile.upsert({
    where: { userEmail: ADMIN_EMAIL },
    update: adminFields,
    create: { userEmail: ADMIN_EMAIL, ...adminFields },
  });

  console.log(`Seeded facility: ${facility.name} (${facility.id})`);
  console.log(`Seeded platform admin: ${ADMIN_EMAIL}`);
  console.log("");
  console.log("MFA is mandatory for PLATFORM_ADMIN. Enrol with either:");
  console.log("  TOTP secret   :", mfaSecret);
  console.log("  otpauth URL   :", otpauthUrl(mfaSecret, ADMIN_EMAIL));
  console.log("  Recovery codes:", recoveryCodes.join(" "));
  console.log("");
  console.log(
    "Every seed run replaces the MFA secret: delete any older HealthFlow " +
      "entry in your authenticator app and add this one."
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });