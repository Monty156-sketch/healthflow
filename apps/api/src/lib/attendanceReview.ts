// "Somebody either was or was not at work, and the roster does not overwrite
// that." When a duty changes after attendance was recorded, the record stays,
// loses its link to the old duty, and is flagged for review.
import type { Prisma } from "@healthflow/db";

/** Call before deleting assignments. Keeps their attendance and flags it. */
export async function detachAttendance(tx: Prisma.TransactionClient, assignmentWhere: Prisma.RosterAssignmentWhereInput) {
  const ids = (await tx.rosterAssignment.findMany({ where: assignmentWhere, select: { id: true } })).map((a) => a.id);
  if (ids.length === 0) return 0;
  const r = await tx.attendance.updateMany({ where: { rosterAssignmentId: { in: ids } }, data: { rosterAssignmentId: null, needsReview: true } });
  return r.count;
}

/**
 * Call after assignments are written again. A record whose person, date and
 * shift still match a duty goes back to it and is cleared; the rest stay
 * flagged. Returns the ones still needing review.
 */
export async function relinkAttendance(tx: Prisma.TransactionClient, rosterId: string) {
  const loose = await tx.attendance.findMany({ where: { rosterId, rosterAssignmentId: null, needsReview: true }, include: { staff: { select: { fullName: true } } } });
  const still: { id: string; name: string; date: Date }[] = [];
  for (const a of loose) {
    const match = await tx.rosterAssignment.findFirst({ where: { rosterId, staffId: a.staffId, dutyDate: a.dutyDate, shiftId: a.shiftId ?? undefined } });
    if (match) await tx.attendance.update({ where: { id: a.id }, data: { rosterAssignmentId: match.id, needsReview: false } });
    else still.push({ id: a.id, name: a.staff.fullName, date: a.dutyDate });
  }
  return still;
}
