// A ward in-charge works with their own ward's people. Their account carries the ward (departmentId);
// the administrator and every other role carry none, which means the whole facility.
import { prisma } from "./prisma.js";

type Who = { facilityId: string; departmentId?: string | null; staffId?: string | null };

/** Added to a staff query: nothing for the whole-facility roles, the ward for an in-charge. */
export const wardStaffFilter = (who: Who) => (who.departmentId ? { departmentId: who.departmentId } : {});

/** True when this person is in the caller's ward (or the caller has no ward limit, or it is the caller themselves). */
export async function staffInMyWard(who: Who, staffId: string): Promise<boolean> {
  if (!who.departmentId || staffId === who.staffId) return true;
  const hit = await prisma.staff.findFirst({ where: { id: staffId, facilityId: who.facilityId, departmentId: who.departmentId }, select: { id: true } });
  return Boolean(hit);
}

/** True when the duty belongs to someone in the caller's ward (or the caller has no ward limit). */
export async function assignmentInMyWard(who: Who, assignmentId: string): Promise<boolean> {
  if (!who.departmentId) return true;
  const a = await prisma.rosterAssignment.findFirst({ where: { id: assignmentId, facilityId: who.facilityId }, select: { staffId: true } });
  return Boolean(a) && (await staffInMyWard(who, a!.staffId));
}

/** Swap or ledger rows that involve someone in the caller's ward. Nothing added for the whole-facility roles. */
export const wardSwapFilter = (who: Who) =>
  who.departmentId ? { OR: [{ requesterStaff: { departmentId: who.departmentId } }, { targetStaff: { departmentId: who.departmentId } }] } : {};
