// exportFacilityData: every entity the facility owns, as JSON, and any one of
// them as CSV. A facility administrator can do this at any time, without a fee
// and without asking. Credentials and secrets are never part of it.
import { prisma } from "./prisma.js";
import { csvCell } from "./csvSafe.js";

export async function exportFacilityData(facilityId: string) {
  const w = { facilityId };
  const [facility, departments, cadres, staff, shifts, rules, cycles, rosters, assignments, findings, leaveTypes, entitlements, leave, holidays, attendance, swaps, ledger, consents, requests, notices, retention, audit, users] = await Promise.all([
    prisma.facility.findUniqueOrThrow({ where: { id: facilityId } }),
    prisma.department.findMany({ where: w }),
    prisma.cadre.findMany({ where: w }),
    prisma.staff.findMany({ where: w }),
    prisma.shift.findMany({ where: w }),
    prisma.constraintRule.findMany({ where: w }),
    prisma.dutyCycleRule.findMany({ where: w }),
    prisma.roster.findMany({ where: w }),
    prisma.rosterAssignment.findMany({ where: w }),
    prisma.complianceFinding.findMany({ where: w }),
    prisma.leaveType.findMany({ where: w }),
    prisma.leaveEntitlement.findMany({ where: w }),
    prisma.leaveRequest.findMany({ where: w }),
    prisma.publicHoliday.findMany({ where: w }),
    prisma.attendance.findMany({ where: w }),
    prisma.dutySwap.findMany({ where: w }),
    prisma.dutyLedgerEntry.findMany({ where: w }),
    prisma.consentRecord.findMany({ where: w }),
    prisma.dataSubjectRequest.findMany({ where: w }),
    prisma.privacyNotice.findMany({ where: w }),
    prisma.retentionPolicy.findMany({ where: w }),
    prisma.auditLog.findMany({ where: w, orderBy: { createdAt: "asc" } }),
    prisma.userProfile.findMany({ where: w, select: { userEmail: true, role: true, staffId: true, active: true, lastSignInAt: true, privacyNoticeVersionAccepted: true } }),
  ]);
  return {
    exportedOn: new Date().toISOString(),
    facility: { id: facility.id, name: facility.name, facilityType: facility.facilityType, region: facility.region },
    note: "All of the facility's data. The facility may export it at any time. All data is deleted within 90 days of the agreement ending.",
    entities: { departments, cadres, staff, shifts, constraintRules: rules, dutyCycleRules: cycles, rosters, rosterAssignments: assignments, complianceFindings: findings, leaveTypes, leaveEntitlements: entitlements, leaveRequests: leave, publicHolidays: holidays, attendance, dutySwaps: swaps, dutyLedger: ledger, consents, dataSubjectRequests: requests, privacyNotices: notices, retentionPolicies: retention, auditLog: audit, userAccounts: users },
  };
}

const cell = (v: unknown) => csvCell(v instanceof Date ? v.toISOString() : v !== null && typeof v === "object" ? JSON.stringify(v) : v);

export function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "No records\n";
  const cols = Object.keys(rows[0]);
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}
