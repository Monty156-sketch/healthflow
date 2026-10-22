// Hospitals have staff outside the wards: security, drivers and cleaners, who
// are rostered by the administrator, and administration, who are
// not rostered. Each gets a unit so staff can register into it. Added once;
// a unit the facility renamed away or switched off is not added again.
import { prisma } from "./prisma.js";
import { WARD_FACILITY_TYPES } from "../routes/facility/rosters.js";

const UNITS = [
  { name: "Security", kind: "SUPPORT", runsNights: true },
  { name: "Drivers", kind: "SUPPORT", runsNights: true },
  { name: "Cleaners", kind: "SUPPORT", runsNights: false },
  { name: "Administration", kind: "OFFICE", runsNights: false },
] as const;

export async function ensureSupportUnits(facilityId: string, facilityType?: string) {
  const type = facilityType ?? (await prisma.facility.findUnique({ where: { id: facilityId }, select: { facilityType: true } }))?.facilityType;
  if (!type || !WARD_FACILITY_TYPES.includes(type)) return;
  const have = await prisma.department.findMany({ where: { facilityId }, select: { name: true, kind: true } });
  // Done once: any non-ward unit means the facility has been set up (or set itself up).
  if (have.some((d) => d.kind !== "WARD")) return;
  const names = new Set(have.map((d) => d.name.toLowerCase()));
  for (const u of UNITS.filter((x) => names.has(x.name.toLowerCase()))) {
    await prisma.department.updateMany({ where: { facilityId, name: { equals: u.name, mode: "insensitive" } }, data: { kind: u.kind } });
  }
  const missing = UNITS.filter((u) => !names.has(u.name.toLowerCase()));
  if (missing.length) await prisma.department.createMany({ data: missing.map((u) => ({ facilityId, ...u })) });
}
