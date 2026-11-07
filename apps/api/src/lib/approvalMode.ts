// How rosters are approved at one facility.
//   none             the administrator approves and publishes, as before
//   nursing_manager  the nursing manager approves; then the roster can be published (the default once a nursing manager exists)
//   full             nursing manager, then administrator, then the medical superintendent, who publishes (the administrator switches this on)
// Only hospitals, polyclinics and teaching hospitals have these posts. Health centres, clinics and CHPS compounds never do.
import type { FacilityType } from "@healthflow/db";
import { prisma } from "./prisma.js";

export const APPROVAL_FACILITY_TYPES: FacilityType[] = ["HOSPITAL", "PRIVATE_HOSPITAL", "POLYCLINIC", "REGIONAL_HOSPITAL", "TEACHING_HOSPITAL"];
export type ApprovalMode = "none" | "nursing_manager" | "full";

export const hasApprovalPosts = (facilityType: FacilityType) => APPROVAL_FACILITY_TYPES.includes(facilityType);

export async function approvalModeOf(facilityId: string): Promise<{ eligible: boolean; mode: ApprovalMode; switchedOn: boolean }> {
  const f = await prisma.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { facilityType: true, rosterApprovalChain: true } });
  const eligible = hasApprovalPosts(f.facilityType);
  if (!eligible) return { eligible, mode: "none", switchedOn: false };
  const [nm, ms] = await Promise.all([
    prisma.userProfile.count({ where: { facilityId, active: true, role: "NURSING_MANAGER" } }),
    prisma.userProfile.count({ where: { facilityId, active: true, role: "MEDICAL_SUPERINTENDENT" } }),
  ]);
  const mode: ApprovalMode = nm === 0 ? "none" : f.rosterApprovalChain && ms > 0 ? "full" : "nursing_manager";
  return { eligible, mode, switchedOn: f.rosterApprovalChain };
}
