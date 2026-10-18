// /api/facility: everything about the caller's own facility.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { requireAuth } from "../../middleware/auth.js";
import {
  requireFacilityUser,
  allowRoles,
  caller,
  ADMIN_ROLES,
  READ_ROLES,
} from "../../middleware/facilityAccess.js";
import { parseOr400, requiredText, optionalText, optionalDate, optionalEmail } from "../../lib/validate.js";
import {
  FACILITY_TYPE_LABEL,
  weekdayLabel,
  monthLabel,
  displayDate,
  isoDate,
  listSentence,
} from "../../lib/labels.js";
import { departmentsRouter } from "./departments.js";
import { cadresRouter } from "./cadres.js";
import { staffRouter } from "./staff.js";
import { auditRouter } from "./audit.js";
import { privacyRouter } from "./privacy.js";
import { shiftsRouter } from "./shifts.js";
import { rulesRouter } from "./rules.js";
import { cyclesRouter } from "./cycles.js";
import { rotationsRouter } from "./rotations.js";
import { rostersRouter } from "./rosters.js";
import { leaveRouter } from "./leave.js";
import { attendanceRouter } from "./attendance.js";
import { notificationsRouter } from "./notifications.js";
import { myDutiesRouter } from "./myDuties.js";
import { swapsRouter } from "./swaps.js";
import { coverRouter, ledgerRouter } from "./cover.js";
import { reportsRouter } from "./reports.js";
import { leaveSettingsRouter } from "./leaveSettings.js";
import { noticesRouter } from "./platformNotices.js";
import { billingRouter } from "./billing.js";
import { staffImportRouter } from "./staffImport.js";
import { coverageRouter } from "./coverage.js";
import { requireFlag, flagsFor } from "../../lib/flags.js";
import { dashboardRouter } from "./dashboard.js";
import { meRouter } from "./me.js";
import { directorateRouter } from "./directorate.js";
import { staffInvitationRouter, invitationAdminRouter } from "../invitations.js";

export const facilityRouter = Router();

facilityRouter.use(requireAuth, requireFacilityUser);
facilityRouter.use("/departments", departmentsRouter);
facilityRouter.use("/cadres", cadresRouter);
facilityRouter.use("/staff-import", staffImportRouter);
facilityRouter.use("/staff", staffRouter);
facilityRouter.use("/staff", staffInvitationRouter);
facilityRouter.use("/invitations", invitationAdminRouter);
facilityRouter.use("/privacy", privacyRouter);
facilityRouter.use("/shifts", shiftsRouter);
facilityRouter.use("/rules", rulesRouter);
facilityRouter.use("/cycles", cyclesRouter);
facilityRouter.use("/rotations", rotationsRouter);
facilityRouter.use("/rosters", rostersRouter);
facilityRouter.use("/leave", leaveRouter);
facilityRouter.use("/attendance", attendanceRouter);
facilityRouter.use("/notifications", notificationsRouter);
facilityRouter.use("/my-duties", myDutiesRouter);
facilityRouter.use("/swaps", swapsRouter);
facilityRouter.use("/cover", coverRouter);
facilityRouter.use("/directorate", requireFlag("district.oversight"), directorateRouter);
facilityRouter.use("/dashboard", dashboardRouter);
facilityRouter.use("/me", meRouter);
facilityRouter.use("/billing", billingRouter);
facilityRouter.use("/notices", noticesRouter);
facilityRouter.use("/coverage", coverageRouter);
facilityRouter.use("/ledger", ledgerRouter);
facilityRouter.use("/reports", reportsRouter);
facilityRouter.use("/", leaveSettingsRouter);
facilityRouter.use("/audit-log", auditRouter);

const FACILITY_TYPES = ["CHPS_COMPOUND", "HEALTH_CENTRE", "CLINIC", "POLYCLINIC", "HOSPITAL", "PRIVATE_HOSPITAL"] as const;

function presentFacility(f: Awaited<ReturnType<typeof prisma.facility.findUniqueOrThrow>>) {
  return {
    id: f.id,
    name: f.name,
    facilityType: f.facilityType,
    ghsFacilityCode: f.ghsFacilityCode,
    region: f.region,
    subDistrict: f.subDistrict,
    weekStartsOn: f.weekStartsOn,
    referencePeriodWeeks: f.referencePeriodWeeks,
    leaveYearStartMonth: f.leaveYearStartMonth,
    allowNegativeLeaveBalance: f.allowNegativeLeaveBalance,
    attendanceCutoffDays: f.attendanceCutoffDays,
    swapCutoffHours: f.swapCutoffHours,
    dpcRegistrationNumber: f.dpcRegistrationNumber,
    dpcRegistrationExpiry: isoDate(f.dpcRegistrationExpiry),
    dataProtectionContactName: f.dataProtectionContactName,
    dataProtectionContactEmail: f.dataProtectionContactEmail,
    status: f.status,
  };
}

/** The facility, plus how far its set-up has got (drives the set-up checklist). */
facilityRouter.get("/", allowRoles(...READ_ROLES, "STAFF"), async (req, res) => {
  const { facilityId, role, displayName } = caller(req);
  // Staff get the facility's name and settings so their own screens work, and none of the set-up counts.
  if (role === "STAFF") {
    const facility = await prisma.facility.findUniqueOrThrow({ where: { id: facilityId } });
    return res.json({ facility: presentFacility(facility), setup: { departments: 0, cadres: 0, staff: 0 }, me: { role, displayName }, flags: await flagsFor(facilityId) });
  }
  const [facility, departments, cadres, staff] = await Promise.all([
    prisma.facility.findUniqueOrThrow({ where: { id: facilityId } }),
    prisma.department.count({ where: { facilityId, active: true } }),
    prisma.cadre.count({ where: { facilityId, active: true } }),
    prisma.staff.count({ where: { facilityId, status: { in: ["ACTIVE", "ON_LEAVE", "PENDING"] } } }),
  ]);
  res.json({
    facility: presentFacility(facility),
    setup: { departments, cadres, staff },
    me: { role, displayName },
    flags: await flagsFor(facilityId),
  });
});

const int = (label: string, min: number, max: number) =>
  z
    .number({ invalid_type_error: `${label} must be a number.`, required_error: `${label} is required.` })
    .int(`${label} must be a whole number.`)
    .min(min, `${label} must be at least ${min}.`)
    .max(max, `${label} must be at most ${max}.`);

const facilityInput = z.object({
  name: requiredText(120, "Facility name"),
  facilityType: z.enum(FACILITY_TYPES, { errorMap: () => ({ message: "Choose a facility type." }) }),
  ghsFacilityCode: optionalText(30, "GHS facility code"),
  region: optionalText(60, "Region"),
  subDistrict: optionalText(80, "Sub-district"),
  weekStartsOn: z.union([z.literal(0), z.literal(1)], { errorMap: () => ({ message: "Choose Sunday or Monday." }) }),
  referencePeriodWeeks: int("Reference period", 1, 26),
  leaveYearStartMonth: int("Leave year start month", 1, 12),
  allowNegativeLeaveBalance: z.boolean(),
  attendanceCutoffDays: int("Attendance correction window", 0, 31),
  swapCutoffHours: int("Swap request cut-off", 0, 168),
  dpcRegistrationNumber: optionalText(40, "DPC registration number"),
  dpcRegistrationExpiry: optionalDate("DPC registration expiry"),
  dataProtectionContactName: optionalText(120, "Data protection contact name"),
  dataProtectionContactEmail: optionalEmail("Data protection contact email"),
});

/** Turns each changed setting into words for the audit sentence. */
function describeChanges(before: ReturnType<typeof presentFacility>, after: ReturnType<typeof presentFacility>) {
  const out: string[] = [];
  const add = (label: string, a: unknown, b: unknown, fmt: (v: unknown) => string = (v) => (v === null || v === "" ? "none" : String(v))) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${label} from ${fmt(a)} to ${fmt(b)}`);
  };
  add("name", before.name, after.name);
  add("type", before.facilityType, after.facilityType, (v) => FACILITY_TYPE_LABEL[String(v)] ?? String(v));
  add("GHS facility code", before.ghsFacilityCode, after.ghsFacilityCode);
  add("region", before.region, after.region);
  add("sub-district", before.subDistrict, after.subDistrict);
  add("week start", before.weekStartsOn, after.weekStartsOn, (v) => weekdayLabel(Number(v)));
  add("reference period", before.referencePeriodWeeks, after.referencePeriodWeeks, (v) => `${v} weeks`);
  add("leave year start", before.leaveYearStartMonth, after.leaveYearStartMonth, (v) => monthLabel(Number(v)));
  add("negative leave balances", before.allowNegativeLeaveBalance, after.allowNegativeLeaveBalance, (v) => (v ? "allowed" : "not allowed"));
  add("attendance correction window", before.attendanceCutoffDays, after.attendanceCutoffDays, (v) => `${v} days`);
  add("swap request cut-off", before.swapCutoffHours, after.swapCutoffHours, (v) => `${v} hours`);
  add("DPC registration number", before.dpcRegistrationNumber, after.dpcRegistrationNumber);
  add("DPC registration expiry", before.dpcRegistrationExpiry, after.dpcRegistrationExpiry, (v) =>
    v ? displayDate(new Date(`${v}T00:00:00Z`)) : "none"
  );
  add("data protection contact", before.dataProtectionContactName, after.dataProtectionContactName);
  add("data protection contact email", before.dataProtectionContactEmail, after.dataProtectionContactEmail);
  return out;
}

facilityRouter.patch("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(facilityInput, req.body, res);
  if (!input) return;

  const existing = await prisma.facility.findUniqueOrThrow({ where: { id: who.facilityId } });
  const updated = await prisma.facility.update({ where: { id: who.facilityId }, data: input });

  const before = presentFacility(existing);
  const after = presentFacility(updated);
  const changes = describeChanges(before, after);
  if (changes.length) {
    await writeAuditLog({
      facilityId: who.facilityId,
      actorEmail: who.email,
      action: "facility_updated",
      entityType: "Facility",
      entityId: who.facilityId,
      before,
      after,
      summary: `${who.displayName} changed the facility's ${listSentence(changes)}.`,
    });
  }
  res.json({ facility: after });
});
