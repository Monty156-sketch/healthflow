// handleErasureRequest. Erasure is rarely absolute: duty, leave and attendance
// records are employment records the facility must keep for a period. The plan
// says what goes, what stays and why, and the staff member is told both.
import { prisma } from "./prisma.js";

export interface ErasurePlan {
  erase: { what: string }[];
  retain: { what: string; why: string }[];
}

export async function erasurePlan(staffId: string, facilityId: string): Promise<ErasurePlan> {
  const s = await prisma.staff.findFirstOrThrow({ where: { id: staffId, facilityId } });
  const [duties, leave, attendance] = await Promise.all([
    prisma.rosterAssignment.count({ where: { staffId, facilityId } }),
    prisma.leaveRequest.count({ where: { staffId, facilityId } }),
    prisma.attendance.count({ where: { staffId, facilityId } }),
  ]);
  const erase: ErasurePlan["erase"] = [];
  if (s.phone) erase.push({ what: "Telephone number" });
  if (s.email) erase.push({ what: "Email address held on the staff record" });
  if (s.emergencyContactName || s.emergencyContactPhone) erase.push({ what: "Emergency contact" });
  if (s.photoUrl) erase.push({ what: "Photograph" });
  erase.push({ what: "Notifications sent to you" });
  const why = "An employment record the facility must keep for the retention period it has approved.";
  const retain: ErasurePlan["retain"] = [];
  if (duties) retain.push({ what: `${duties} recorded duties`, why });
  if (leave) retain.push({ what: `${leave} leave requests and decisions`, why });
  if (attendance) retain.push({ what: `${attendance} attendance records`, why });
  retain.push({ what: "Your name and staff number", why: "They identify the records above." });
  retain.push({ what: "The audit trail", why: "It proves who changed what, and cannot be altered." });
  return { erase, retain };
}

export async function applyErasure(staffId: string, facilityId: string) {
  await prisma.staff.update({ where: { id: staffId }, data: { phone: null, email: null, emergencyContactName: null, emergencyContactPhone: null, photoUrl: null, photoConsentId: null } });
  await prisma.notification.deleteMany({ where: { recipientStaffId: staffId, facilityId } });
}

export const planSentence = (p: ErasurePlan) =>
  `Removed: ${p.erase.map((e) => e.what.toLowerCase()).join(", ")}. Kept: ${p.retain.map((r) => `${r.what.toLowerCase()} (${r.why.replace(/\.$/, "").toLowerCase()})`).join("; ")}.`;
