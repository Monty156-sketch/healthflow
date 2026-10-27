// A health centre rosters by unit (Clinical Nurses marks it; Midwives is the old name of Maternity) (clinical nurses, maternity, public health). A unit's first roster starts
// from the usual numbers: clinical nurses 2 on mornings and 1 on afternoons and nights, maternity 1 on each,
// any other unit 1 on mornings. The in-charge can change them on the roster page.
import { prisma } from "./prisma.js";
import { unitMinimums } from "./dutyPlan.js";

export async function seedUnitDemand(facilityId: string, department: { id: string; name: string }) {
  if (await prisma.shiftDemand.count({ where: { departmentId: department.id } })) return;
  const shifts = await prisma.shift.findMany({ where: { facilityId, active: true, countsAsDuty: true, isOnCall: false } });
  const [m, a, n] = unitMinimums(department.name);
  const data = shifts.flatMap((s) => {
    const name = s.name.toLowerCase();
    const minStaff = s.isOvernight ? n : name.includes("morning") ? m : /afternoon|evening/.test(name) ? a : null;
    return minStaff === null ? [] : [{ facilityId, departmentId: department.id, shiftId: s.id, minStaff }];
  });
  if (data.length) await prisma.shiftDemand.createMany({ data, skipDuplicates: true });
}

/** Only a health centre rosters by unit (clinical nurses, midwives, public health); a hospital always rosters by ward. Clinics and CHPS compounds keep one roster. */
export async function rostersByUnit(facilityId: string, facilityType: string, hospitalTypes: string[]) {
  if (hospitalTypes.includes(facilityType)) return true;
  if (facilityType !== "HEALTH_CENTRE") return false;
  return Boolean(await prisma.department.findFirst({ where: { facilityId, active: true, name: { in: ["Clinical Nurses", "Midwives"] } }, select: { id: true } }));
}
