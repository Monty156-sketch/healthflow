/**
 * Puts a few sample licences and one handover note into a STAGING facility so the Licences and Shift handover
 * screens can be tried with something on them. Safe to run again: it skips what is already there.
 *
 * It refuses to run unless HEALTHFLOW_DB_ROLE=staging (see scripts/db-guard.mjs), so it cannot touch production.
 *
 * packages/db/.env:
 *   DATABASE_URL           the STAGING database
 *   SAMPLE_FACILITY_NAME   optional, defaults to the first facility
 *
 * Run with: pnpm --filter @healthflow/db seed:sample
 */
import { PrismaClient } from "../generated/client";
import { config as loadEnv } from "dotenv";
import path from "node:path";

loadEnv({ path: path.resolve(__dirname, "../.env"), override: true });

const DAY = 86_400_000;
const at = (offsetDays: number) => new Date(Math.floor((Date.now() + offsetDays * DAY) / DAY) * DAY);

async function main() {
  if (process.env.HEALTHFLOW_DB_ROLE !== "staging") throw new Error("Set HEALTHFLOW_DB_ROLE=staging to run this. It is for the staging database only.");
  const prisma = new PrismaClient();
  try {
    const name = process.env.SAMPLE_FACILITY_NAME;
    const facility = await prisma.facility.findFirst({ where: name ? { name } : {}, orderBy: { createdAt: "asc" } });
    if (!facility) throw new Error(name ? `No facility called "${name}".` : "There is no facility in this database.");
    const admin = await prisma.userProfile.findFirst({ where: { facilityId: facility.id, role: "FACILITY_ADMIN", active: true }, include: { staff: { select: { fullName: true } } } });
    const addedBy = admin?.userEmail ?? "sample-data";
    const staff = await prisma.staff.findMany({ where: { facilityId: facility.id, status: "ACTIVE" }, orderBy: { staffNo: "asc" }, take: 4 });
    if (staff.length === 0) throw new Error("The facility has no active staff to attach sample licences to.");

    // One of each state: in date, nearing the date, lapsed, and one that never lapses.
    const samples = [
      { kind: "Nursing and Midwifery Council licence", number: "RN-SAMPLE-001", issuer: "Nursing and Midwifery Council", expires: at(240) },
      { kind: "Basic life support", number: null, issuer: "Ghana Health Service", expires: at(21) },
      { kind: "Annual practising licence", number: "APL-SAMPLE-002", issuer: "Nursing and Midwifery Council", expires: at(-12) },
      { kind: "Fire safety training", number: null, issuer: null, expires: null },
    ];
    let made = 0;
    for (const [i, s] of samples.entries()) {
      const person = staff[i % staff.length];
      const exists = await prisma.staffCredential.findFirst({ where: { facilityId: facility.id, staffId: person.id, kind: s.kind, archivedAt: null } });
      if (exists) continue;
      await prisma.staffCredential.create({
        data: {
          facilityId: facility.id, staffId: person.id, kind: s.kind, number: s.number, issuer: s.issuer, expiresOn: s.expires, noExpiry: s.expires === null,
          addedBy, ...(i % 2 === 0 ? { verifiedBy: admin?.staff?.fullName ?? "Sample administrator", verifiedAt: new Date() } : {}),
        },
      });
      made++;
    }

    // One handover note for the first shift, today, with no patient names.
    const shift = await prisma.shift.findFirst({ where: { facilityId: facility.id, active: true, countsAsDuty: true }, orderBy: { sortOrder: "asc" } });
    let note = "skipped (no shift set up)";
    if (shift) {
      const ward = await prisma.department.findFirst({ where: { facilityId: facility.id, active: true, kind: "WARD" }, orderBy: { name: "asc" } });
      const exists = await prisma.handoverNote.findFirst({ where: { facilityId: facility.id, authorEmail: addedBy, summary: { startsWith: "Sample note" }, archivedAt: null } });
      if (!exists) {
        await prisma.handoverNote.create({
          data: {
            facilityId: facility.id, departmentId: ward?.id ?? null, shiftId: shift.id, dutyDate: at(0), authorEmail: addedBy, authorName: admin?.staff?.fullName ?? "Sample administrator",
            summary: "Sample note. Quiet shift. Bed 4 on a drip, bed 7 waiting for review.", pending: "Review bed 7 at 06:00. Restock the dressing trolley.", concerns: "Oxygen cylinder 2 is nearly empty.", urgent: false,
          },
        });
        note = "added";
      } else note = "already there";
    }
    console.log(`${facility.name}: ${made} sample licence(s) added, handover note ${note}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
