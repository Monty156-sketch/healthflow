// Prints a facility's roster settings as JSON so they can be made the
// standard for new facilities. READ ONLY: it changes nothing, and it holds no
// names, phone numbers or other personal data, only shifts, cycles, rotations,
// rule numbers and unit minimums.
//
//   pnpm --filter @healthflow/api exec tsx scripts/export-facility-config.ts "Sombo Health Centre"
import { prisma } from "../src/lib/prisma.js";

const name = process.argv[2];
if (!name) { console.error('Usage: tsx scripts/export-facility-config.ts "Facility name"'); process.exit(1); }

const strip = <T extends Record<string, unknown>>(r: T) => { const { facilityId: _f, ...rest } = r; return rest; };

(async () => {
  const f = await prisma.facility.findFirst({ where: { name }, select: { id: true, name: true, facilityType: true } });
  if (!f) throw new Error(`No facility is named "${name}".`);
  const where = { facilityId: f.id };
  const [shifts, cycles, rotations, rules, departments, cadres] = await Promise.all([
    prisma.shift.findMany({ where, orderBy: { sortOrder: "asc" } }),
    prisma.dutyCycleRule.findMany({ where, include: { countingShifts: { select: { code: true } } } }),
    prisma.shiftRotation.findMany({ where, include: { sequence: { select: { code: true } } } }),
    prisma.constraintRule.findMany({ where, orderBy: { code: "asc" } }),
    prisma.department.findMany({ where, orderBy: { name: "asc" } }),
    prisma.cadre.findMany({ where, orderBy: { sortOrder: "asc" } }),
  ]);
  const demand = await prisma.shiftDemand.findMany({ where }).catch(() => []);
  console.log(JSON.stringify({ facility: { name: f.name, type: f.facilityType }, shifts: shifts.map(strip), cycles: cycles.map(strip), rotations: rotations.map(strip), rules: rules.map(strip), departments: departments.map(strip), cadres: cadres.map(strip), shiftDemand: demand.map(strip) }, null, 2));
})().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
