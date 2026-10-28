// Everything the facility holds about one person, in one place. It serves the
// right of access and the right to portability together, and it is
// self-service: no request, no waiting. It names no one else except by role
// (an approver is "the facility", a swap partner is "a colleague").
import { prisma } from "./prisma.js";
import { csvCell } from "./csvSafe.js";

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function exportMyData(staffId: string, facilityId: string) {
  const staff = await prisma.staff.findFirstOrThrow({
    where: { id: staffId, facilityId },
    include: { cadre: { select: { name: true } }, department: { select: { name: true } } },
  });
  const [assignments, leave, attendance, swaps, consents, requests, ledger, profile, clocks] = await Promise.all([
    prisma.rosterAssignment.findMany({ where: { staffId, facilityId }, include: { shift: { select: { name: true, startTime: true, endTime: true } }, roster: { select: { year: true, month: true, status: true } } }, orderBy: { dutyDate: "asc" } }),
    prisma.leaveRequest.findMany({ where: { staffId, facilityId }, include: { leaveType: { select: { name: true } } }, orderBy: { startDate: "asc" } }),
    prisma.attendance.findMany({ where: { staffId, facilityId }, orderBy: { dutyDate: "asc" } }),
    prisma.dutySwap.findMany({ where: { facilityId, OR: [{ requesterStaffId: staffId }, { targetStaffId: staffId }] }, orderBy: { id: "asc" } }),
    prisma.consentRecord.findMany({ where: { staffId, facilityId }, orderBy: { grantedAt: "asc" } }),
    prisma.dataSubjectRequest.findMany({ where: { staffId, facilityId }, orderBy: { receivedAt: "asc" } }),
    prisma.dutyLedgerEntry.findMany({ where: { staffId, facilityId }, orderBy: { id: "asc" } }),
    prisma.userProfile.findUnique({ where: { staffId }, select: { userEmail: true, role: true, lastSignInAt: true, privacyNoticeVersionAccepted: true, mfaEnabled: true } }),
    prisma.clockEvent.findMany({ where: { staffId, facilityId }, orderBy: { at: "asc" } }),
  ]);
  // Not the duties' ids: a cover duty keeps its id when it moves to the next person, and its audit sentences
  // name the people who declined it and quote their reasons.
  const ids = [staffId, ...leave.map((l) => l.id), ...swaps.map((s) => s.id), ...requests.map((r) => r.id)];
  const audit = await prisma.auditLog.findMany({ where: { facilityId, entityId: { in: ids } }, orderBy: { createdAt: "asc" }, select: { createdAt: true, action: true, entityType: true, summary: true } });

  return {
    exportedOn: new Date().toISOString(),
    about: "Everything this facility holds about you in HealthFlow. It is yours to keep.",
    details: {
      staffNumber: staff.staffNo, fullName: staff.fullName, phone: staff.phone, email: staff.email, position: staff.position,
      cadre: staff.cadre?.name ?? null, department: staff.department?.name ?? null, employmentStatus: staff.employmentStatus, status: staff.status,
      dateJoined: day(staff.dateJoined), emergencyContactName: staff.emergencyContactName, emergencyContactPhone: staff.emergencyContactPhone,
      hasPhotograph: Boolean(staff.photoUrl), excludedFromNights: staff.excludedFromNights, willingForExtraDuties: staff.willingForExtraDuties, maxDutiesPerWeek: staff.maxDutiesPerWeek,
    },
    account: profile && { signInEmail: profile.userEmail, role: profile.role, lastSignInAt: profile.lastSignInAt, privacyNoticeVersionAccepted: profile.privacyNoticeVersionAccepted, twoStepSignIn: profile.mfaEnabled },
    duties: assignments.map((a) => ({ date: day(a.dutyDate), shift: a.shift.name, start: a.shift.startTime, end: a.shift.endTime, rosterMonth: `${a.roster.year}-${String(a.roster.month).padStart(2, "0")}`, rosterStatus: a.roster.status, cover: a.isCover })),
    leave: leave.map((l) => ({ type: l.leaveType.name, from: day(l.startDate), to: day(l.endDate), days: l.daysDeducted, status: l.status, reason: l.reason, submittedAt: l.submittedAt, decidedAt: l.decidedAt, decisionNote: l.decisionNote })),
    attendance: attendance.map((a) => ({ date: day(a.dutyDate), status: a.status, minutesLate: a.minutesLate, note: a.note, recordedAt: a.recordedAt, originalStatus: a.originalStatus, correctedAt: a.correctedAt, correctionReason: a.correctionReason })),
    clockedAtTheFacility: clocks.map((c) => ({ when: c.at, kind: c.kind === "IN" ? "clocked in" : "clocked out", metresFromCentre: c.distanceM })),
    swaps: swaps.map((s) => ({ type: s.swapType, yourRole: s.requesterStaffId === staffId ? "asked" : "asked of you", status: s.status, reason: s.reason, response: s.responseNote, decidedAt: s.decidedAt, decisionNote: s.decisionNote })),
    dutyBalance: ledger.map((e) => ({ type: e.entryType, duties: e.duties, settled: e.dutiesSettled, status: e.status, reason: e.reason, description: e.description })),
    consents: consents.map((c) => ({ purpose: c.consentType, granted: c.granted, grantedAt: c.grantedAt, withdrawnAt: c.withdrawnAt })),
    dataRequests: requests.map((r) => ({ type: r.requestType, status: r.status, received: r.receivedAt, due: r.dueAt, completed: r.completedAt, description: r.description, outcome: r.outcomeNote })),
    historyOfChanges: audit.map((a) => ({ when: a.createdAt, what: a.summary })),
  };
}

const cell = (v: unknown) => csvCell(v instanceof Date ? v.toISOString() : v !== null && typeof v === "object" ? JSON.stringify(v) : v);

/** The same export as one readable CSV: a block per section, each with its own heading row. */
export function exportToCsv(data: Awaited<ReturnType<typeof exportMyData>>): string {
  const out: string[] = [`Your data from HealthFlow,exported ${data.exportedOn}`, ""];
  for (const [key, val] of Object.entries(data)) {
    if (key === "exportedOn" || key === "about" || val === null) continue;
    out.push(key.replace(/([A-Z])/g, " $1").toUpperCase());
    const rows = Array.isArray(val) ? (val as Record<string, unknown>[]) : [val as Record<string, unknown>];
    if (rows.length === 0) { out.push("Nothing recorded", ""); continue; }
    out.push(Object.keys(rows[0]).join(","));
    for (const r of rows) out.push(Object.values(r).map(cell).join(","));
    out.push("");
  }
  return out.join("\n");
}
