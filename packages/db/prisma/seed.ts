/**
 * Seeds one facility (Sombo Health Centre, from the build documentation's
 * own fixture) with a platform admin account, so Phase 0 can be checked
 * end to end: sign up is not required to prove the pipeline works.
 *
 * Run with: pnpm db:seed
 */
import { PrismaClient, Role, ScopeType, FacilityType } from "../generated/client";
import { hashPassword } from "../../../apps/api/src/lib/password";

const prisma = new PrismaClient();

async function main() {
  const facility = await prisma.facility.upsert({
    where: { id: "sombo-health-centre" },
    update: {},
    create: {
      id: "sombo-health-centre",
      name: "Sombo Health Centre",
      facilityType: FacilityType.HEALTH_CENTRE,
      region: "Upper West",
      subDistrict: "Nadowli-Kaleo",
      status: "TRIAL",
    },
  });

  const adminPasswordHash = await hashPassword(
    process.env.SEED_ADMIN_PASSWORD ?? "ChangeMeNow!2026"
  );

  await prisma.userProfile.upsert({
    where: { userEmail: "admin@healthflow.app" },
    update: {},
    create: {
      userEmail: "admin@healthflow.app",
      passwordHash: adminPasswordHash,
      role: Role.PLATFORM_ADMIN,
      scopeType: ScopeType.PLATFORM,
      active: true,
    },
  });

  console.log(`Seeded facility: ${facility.name} (${facility.id})`);
  console.log("Seeded platform admin: admin@healthflow.app");
  console.log(
    "Password is SEED_ADMIN_PASSWORD if set, else the placeholder in this file — change it immediately after first sign-in."
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
