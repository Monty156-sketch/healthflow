// Staff records. Never deleted: a person who leaves gets a leaving status
// (Inactive, Transferred, Resigned, Retired), which keeps their history and
// immediately ends their access (Part 3, 0.3: "the most commonly missed
// control in systems of this kind").
import { isInCharge } from "../../lib/dutyPlan.js";
import { Router } from "express";
import { z } from "zod";
import type { Prisma, StaffStatus } from "@healthflow/db";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { revokeAllSessionsForUser } from "../../lib/tokens.js";
import {
  parseOr400,
  requiredText,
  optionalText,
  optionalDate,
  optionalPhone,
  optionalEmail,
} from "../../lib/validate.js";
import {
  STAFF_STATUS_LABEL,
  EMPLOYMENT_STATUS_LABEL,
  displayDate,
  isoDate,
  listSentence,
} from "../../lib/labels.js";
import { allowRoles, caller, ADMIN_ROLES, READ_ROLES } from "../../middleware/facilityAccess.js";
import { makeResetToken, RESET_LINK_MINUTES } from "../../lib/signedTokens.js";
import { transferToday } from "./transfers.js";
import { appUrl } from "../../lib/email.js";

export const staffRouter = Router();

const CURRENT: StaffStatus[] = ["ACTIVE", "ON_LEAVE", "PENDING"];
const LEAVING: StaffStatus[] = ["INACTIVE", "TRANSFERRED", "RESIGNED", "RETIRED"];
const EMPLOYMENT = ["PERMANENT", "CONTRACT", "NATIONAL_SERVICE", "LOCUM"] as const;
const ALL_STATUSES = ["PENDING", "ACTIVE", "INACTIVE", "ON_LEAVE", "TRANSFERRED", "RESIGNED", "RETIRED"] as const;

const staffInput = z
  .object({
    staffNo: requiredText(30, "Staff number"),
    fullName: requiredText(120, "Full name"),
    phone: optionalPhone("Phone"),
    email: optionalEmail("Email"),
    cadreId: z.string().trim().nullish().transform((v) => v || null),
    departmentId: z.string().trim().nullish().transform((v) => v || null),
    position: optionalText(80, "Position"),
    employmentStatus: z.enum(EMPLOYMENT, { errorMap: () => ({ message: "Choose an employment type." }) }),
    dateJoined: optionalDate("Date joined"),
    emergencyContactName: optionalText(120, "Emergency contact name"),
    emergencyContactPhone: optionalPhone("Emergency contact phone"),
    eligibleShiftIds: z.array(z.string()).max(50).default([]),
    excludedFromNights: z.boolean().default(false),
    morningOnly: z.boolean().optional(),
    smsOptOut: z.boolean().optional(),
    willingForExtraDuties: z.boolean().default(false),
    exclusionReason: optionalText(200, "Reason"),
    maxDutiesPerWeek: z
      .number({ invalid_type_error: "Maximum duties per week must be a number." })
      .int("Maximum duties per week must be a whole number.")
      .min(0, "Maximum duties per week cannot be negative.")
      .max(7, "Maximum duties per week cannot be more than 7.")
      .default(0),
    /** Can take charge of a shift. */
    canLead: z.boolean().optional(),
    /** 0 means no limit. */
    maxNightsPerMonth: z.number({ invalid_type_error: "Most nights in a month must be a number." }).int("Most nights in a month must be a whole number.").min(0, "Most nights in a month cannot be negative.").max(31, "Most nights in a month is too high.").optional(),
    maxHoursPerMonth: z.number({ invalid_type_error: "Most hours in a month must be a number." }).int("Most hours in a month must be a whole number.").min(0, "Most hours in a month cannot be negative.").max(744, "Most hours in a month is too high.").optional(),
  })
  .superRefine((v, ctx) => {
    if (v.excludedFromNights && !v.exclusionReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exclusionReason"],
        message: "Give an operational reason, for example \"Breastfeeding mother\" or \"Studying\". Never a medical reason.",
      });
    }
  });

type StaffInput = z.infer<typeof staffInput>;

/** Cadre and department must be this facility's and currently active. */
async function checkGroups(facilityId: string, input: StaffInput, current?: { cadreId: string | null; departmentId: string | null }) {
  const fields: Record<string, string> = {};
  if (input.cadreId && input.cadreId !== current?.cadreId) {
    const ok = await prisma.cadre.findFirst({ where: { id: input.cadreId, facilityId, active: true }, select: { id: true } });
    if (!ok) fields.cadreId = "Choose an active cadre.";
  }
  if (input.departmentId && input.departmentId !== current?.departmentId) {
    const ok = await prisma.department.findFirst({ where: { id: input.departmentId, facilityId, active: true }, select: { id: true } });
    if (!ok) fields.departmentId = "Choose an active department.";
  }
  if (input.eligibleShiftIds.length) {
    const ids = [...new Set(input.eligibleShiftIds)];
    const shifts = await prisma.shift.findMany({ where: { id: { in: ids }, facilityId, active: true, countsAsDuty: true }, select: { id: true, name: true, eligibleCadreIds: true } });
    if (shifts.length !== ids.length) fields.eligibleShiftIds = "Choose only active duty shifts from your own list.";
    else {
      const cadreId = input.cadreId;
      const shut = shifts.filter((sh) => sh.eligibleCadreIds.length > 0 && (!cadreId || !sh.eligibleCadreIds.includes(cadreId)));
      if (shut.length) fields.eligibleShiftIds = `${shut.map((x) => x.name).join(", ")} ${shut.length === 1 ? "is" : "are"} not open to this person's cadre, so ${shut.length === 1 ? "it" : "they"} cannot be on their list.`;
    }
  }
  return fields;
}

async function staffNoTaken(facilityId: string, staffNo: string, exceptId?: string) {
  const clash = await prisma.staff.findFirst({
    where: {
      facilityId,
      staffNo: { equals: staffNo, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(clash);
}

const staffInclude = {
  cadre: { select: { id: true, name: true, code: true } },
  department: { select: { id: true, name: true, code: true } },
  eligibleForShifts: { select: { id: true, name: true, code: true }, orderBy: { sortOrder: "asc" as const } },
  userProfile: {
    select: { role: true, active: true, lastSignInAt: true, mfaEnabled: true, privacyNoticeVersionAccepted: true, departmentId: true },
  },
} satisfies Prisma.StaffInclude;

type StaffRow = Prisma.StaffGetPayload<{ include: typeof staffInclude }>;

/** What the browser receives. Dates as YYYY-MM-DD. The photo itself only on the detail route. */
function present(s: Omit<StaffRow, "photoUrl"> & { photoUrl?: string | null }) {
  return {
    id: s.id,
    staffNo: s.staffNo,
    fullName: s.fullName,
    phone: s.phone,
    email: s.email,
    cadre: s.cadre,
    department: s.department,
    position: s.position,
    employmentStatus: s.employmentStatus,
    status: s.status,
    dateJoined: isoDate(s.dateJoined),
    emergencyContactName: s.emergencyContactName,
    emergencyContactPhone: s.emergencyContactPhone,
    eligibleShifts: s.eligibleForShifts,
    excludedFromNights: s.excludedFromNights,
    morningOnly: s.morningOnly,
    smsOptOut: s.smsOptOut,
    willingForExtraDuties: s.willingForExtraDuties,
    exclusionReason: s.exclusionReason,
    maxDutiesPerWeek: s.maxDutiesPerWeek,
    canLead: s.canLead,
    maxNightsPerMonth: s.maxNightsPerMonth,
    maxHoursPerMonth: s.maxHoursPerMonth,
    account: s.userProfile
      ? {
          role: s.userProfile.role,
          active: s.userProfile.active,
          lastSignInAt: s.userProfile.lastSignInAt,
          mfaEnabled: s.userProfile.mfaEnabled,
          privacyNoticeVersionAccepted: s.userProfile.privacyNoticeVersionAccepted,
          wardDepartmentId: s.userProfile.departmentId,
        }
      : null,
    hasPhoto: Boolean(s.photoUrl),
    updatedAt: s.updatedAt,
  };
}

// ---------------------------------------------------------------- list

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  show: z.enum(["current", "former", "all"]).default("current"),
  cadreId: z.string().optional(),
  departmentId: z.string().optional(),
});

staffRouter.get("/", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId, departmentId: ward } = caller(req);
  const query = parseOr400(listQuery, req.query, res);
  if (!query) return;

  const where: Prisma.StaffWhereInput = {
    facilityId,
    ...(query.show === "current" ? { status: { in: CURRENT } } : {}),
    ...(query.show === "former" ? { status: { in: LEAVING } } : {}),
    ...(query.cadreId ? { cadreId: query.cadreId } : {}),
    // A ward in-charge sees their own ward's people.
    ...(ward ? { departmentId: ward } : query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.q
      ? {
          OR: [
            { fullName: { contains: query.q, mode: "insensitive" } },
            { staffNo: { contains: query.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const staff = await prisma.staff.findMany({
    where,
    include: staffInclude,
    omit: { photoUrl: true },
    orderBy: [{ fullName: "asc" }],
    take: 1000,
  });
  res.json({ staff: staff.map(present) });
});

// ---------------------------------------------------------------- one

staffRouter.get("/:id", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId, departmentId: ward } = caller(req);
  const s = await prisma.staff.findFirst({
    where: { id: String(req.params.id), facilityId, ...(ward ? { departmentId: ward } : {}) },
    include: staffInclude,
  });
  if (!s) return res.status(404).json({ error: "not_found" });
  const invitation = await prisma.staffInvitation.findFirst({
    where: { facilityId, staffId: s.id, status: "PENDING", expiresAt: { gt: new Date() } },
    orderBy: { sentAt: "desc" },
    select: { id: true, role: true, email: true, sentAt: true, expiresAt: true },
  });
  res.json({ staff: { ...present(s), photo: s.photoUrl }, invitation });
});

// ---------------------------------------------------------------- create

staffRouter.post("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(staffInput, req.body, res);
  if (!input) return;

  const fields = await checkGroups(who.facilityId, input);
  if (await staffNoTaken(who.facilityId, input.staffNo)) {
    fields.staffNo = "Another staff member already has this staff number.";
  }
  if (Object.keys(fields).length) return res.status(400).json({ error: "invalid_input", fields });

  const s = await prisma.staff.create({
    data: {
      facilityId: who.facilityId,
      staffNo: input.staffNo,
      fullName: input.fullName,
      phone: input.phone,
      email: input.email,
      cadreId: input.cadreId,
      departmentId: input.departmentId,
      position: input.position,
      employmentStatus: input.employmentStatus,
      status: "ACTIVE",
      dateJoined: input.dateJoined,
      emergencyContactName: input.emergencyContactName,
      emergencyContactPhone: input.emergencyContactPhone,
      excludedFromNights: input.excludedFromNights,
      morningOnly: input.morningOnly ?? isInCharge(input.position),
      willingForExtraDuties: input.willingForExtraDuties,
      exclusionReason: input.excludedFromNights ? input.exclusionReason : null,
      maxDutiesPerWeek: input.maxDutiesPerWeek,
      canLead: input.canLead ?? false,
      maxNightsPerMonth: input.maxNightsPerMonth ?? 0,
      maxHoursPerMonth: input.maxHoursPerMonth ?? 0,
      eligibleForShifts: { connect: [...new Set(input.eligibleShiftIds)].map((id) => ({ id })) },
    },
    include: staffInclude,
  });

  await writeAuditLog({
    facilityId: who.facilityId,
    actorEmail: who.email,
    action: "staff_created",
    entityType: "Staff",
    entityId: s.id,
    after: { staffNo: s.staffNo, fullName: s.fullName, cadre: s.cadre?.name, department: s.department?.name },
    summary: `${who.displayName} added ${s.fullName} (staff no. ${s.staffNo})${
      s.cadre ? ` as ${s.cadre.name}` : ""
    }${s.department ? ` in ${s.department.name}` : ""}.`,
  });
  res.status(201).json({ staff: present(s) });
});

// ---------------------------------------------------------------- update

const FIELD_LABEL: Record<string, string> = {
  staffNo: "staff number",
  fullName: "name",
  phone: "phone",
  email: "email",
  position: "position",
  employmentStatus: "employment type",
  dateJoined: "date joined",
  emergencyContactName: "emergency contact name",
  emergencyContactPhone: "emergency contact phone",
  excludedFromNights: "night duty exclusion",
  morningOnly: "weekday mornings only",
  smsOptOut: "text messages",
  willingForExtraDuties: "willingness to cover extra duties",
  exclusionReason: "night exclusion reason",
  maxDutiesPerWeek: "maximum duties per week",
  canLead: "who can lead a shift",
  maxNightsPerMonth: "most nights in a month",
  maxHoursPerMonth: "most hours in a month",
  eligibleShifts: "shifts they may work",
  cadre: "cadre",
  department: "department",
};

staffRouter.patch("/:id", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(staffInput, req.body, res);
  if (!input) return;

  const existing = await prisma.staff.findFirst({
    where: { id: String(req.params.id), facilityId: who.facilityId },
    include: staffInclude,
  });
  if (!existing) return res.status(404).json({ error: "not_found" });

  const fields = await checkGroups(who.facilityId, input, existing);
  if (await staffNoTaken(who.facilityId, input.staffNo, existing.id)) {
    fields.staffNo = "Another staff member already has this staff number.";
  }
  if (Object.keys(fields).length) return res.status(400).json({ error: "invalid_input", fields });
  // Moving someone already in a ward to another one is a transfer: recorded, and the rosters follow.
  const moving = Boolean(existing.departmentId && input.departmentId && input.departmentId !== existing.departmentId && ["ACTIVE", "ON_LEAVE"].includes(existing.status));
  if (moving && (await prisma.wardTransfer.findFirst({ where: { staffId: existing.id, appliedAt: null, cancelledAt: null }, select: { id: true } }))) {
    return res.status(409).json({ error: "transfer_open", fields: { departmentId: "This person has a transfer waiting. Cancel it on the Ward transfers page first." } });
  }

  let s = await prisma.staff.update({
    where: { id: existing.id },
    data: {
      staffNo: input.staffNo,
      fullName: input.fullName,
      phone: input.phone,
      email: input.email,
      cadreId: input.cadreId,
      departmentId: moving ? existing.departmentId : input.departmentId,
      position: input.position,
      employmentStatus: input.employmentStatus,
      dateJoined: input.dateJoined,
      emergencyContactName: input.emergencyContactName,
      emergencyContactPhone: input.emergencyContactPhone,
      excludedFromNights: input.excludedFromNights,
      ...(input.morningOnly !== undefined ? { morningOnly: input.morningOnly } : {}),
      ...(input.smsOptOut !== undefined ? { smsOptOut: input.smsOptOut } : {}),
      willingForExtraDuties: input.willingForExtraDuties,
      exclusionReason: input.excludedFromNights ? input.exclusionReason : null,
      maxDutiesPerWeek: input.maxDutiesPerWeek,
      ...(input.canLead !== undefined ? { canLead: input.canLead } : {}),
      ...(input.maxNightsPerMonth !== undefined ? { maxNightsPerMonth: input.maxNightsPerMonth } : {}),
      ...(input.maxHoursPerMonth !== undefined ? { maxHoursPerMonth: input.maxHoursPerMonth } : {}),
      eligibleForShifts: { set: [...new Set(input.eligibleShiftIds)].map((id) => ({ id })) },
    },
    include: staffInclude,
  });
  if (moving) {
    await transferToday(who.facilityId, existing.id, input.departmentId!, who.email);
    s = await prisma.staff.findUniqueOrThrow({ where: { id: existing.id }, include: staffInclude });
  }

  // Name each changed field in words. Values are kept out of the sentence
  // for contact details and the exclusion reason; they stay in before/after.
  const before = present(existing);
  const after = present(s);
  const changed: string[] = [];
  const compare = {
    ...before,
    cadre: before.cadre?.name ?? null,
    department: before.department?.name ?? null,
  } as Record<string, unknown>;
  const compareAfter = {
    ...after,
    cadre: after.cadre?.name ?? null,
    department: after.department?.name ?? null,
  } as Record<string, unknown>;
  const describe = (k: string) => {
    const a = compare[k];
    const b = compareAfter[k];
    if (k === "cadre" || k === "department" || k === "position" || k === "fullName" || k === "staffNo") {
      return `${FIELD_LABEL[k]} from ${a ?? "none"} to ${b ?? "none"}`;
    }
    if (k === "employmentStatus") {
      return `${FIELD_LABEL[k]} from ${EMPLOYMENT_STATUS_LABEL[String(a)]} to ${EMPLOYMENT_STATUS_LABEL[String(b)]}`;
    }
    if (k === "dateJoined") {
      const fmt = (v: unknown) => (v ? displayDate(new Date(`${v}T00:00:00Z`)) : "none");
      return `${FIELD_LABEL[k]} from ${fmt(a)} to ${fmt(b)}`;
    }
    if (k === "eligibleShifts") {
      const names = (v: unknown) => ((v as { name: string }[]) ?? []).map((x) => x.name);
      const fmt = (v: unknown) => (names(v).length ? names(v).join(", ") : "every shift their cadre allows");
      return `${FIELD_LABEL[k]} from ${fmt(a)} to ${fmt(b)}`;
    }
    if (k === "willingForExtraDuties") return b ? "marked them willing to cover extra duties" : "marked them not available for extra duties";
    if (k === "smsOptOut") return b ? "stopped text messages to them" : "turned text messages to them back on";
    if (k === "morningOnly") return b ? "set them to weekday mornings only" : "returned them to the full duty cycle";
    if (k === "excludedFromNights") return b ? "excluded them from night duty" : "returned them to night duty";
    if (k === "canLead") return b ? "marked them able to lead a shift" : "marked them as not leading shifts";
    if (k === "maxNightsPerMonth" || k === "maxHoursPerMonth") {
      const fmt = (v: unknown) => (v === 0 ? "no limit" : String(v));
      return `${FIELD_LABEL[k]} from ${fmt(a)} to ${fmt(b)}`;
    }
    if (k === "maxDutiesPerWeek") {
      const fmt = (v: unknown) => (v === 0 ? "no limit" : String(v));
      return `${FIELD_LABEL[k]} from ${fmt(a)} to ${fmt(b)}`;
    }
    return FIELD_LABEL[k];
  };
  for (const k of Object.keys(FIELD_LABEL)) {
    if (JSON.stringify(compare[k]) !== JSON.stringify(compareAfter[k])) changed.push(describe(k));
  }

  if (changed.length) {
    await writeAuditLog({
      facilityId: who.facilityId,
      actorEmail: who.email,
      action: "staff_updated",
      entityType: "Staff",
      entityId: s.id,
      before,
      after,
      summary: `${who.displayName} updated ${existing.fullName}'s record: changed ${listSentence(changed)}.`,
    });
  }
  res.json({ staff: after });
});

// ---------------------------------------------------------------- status

const statusInput = z.object({
  status: z.enum(ALL_STATUSES, { errorMap: () => ({ message: "Choose a status." }) }),
  reason: z.string().trim().min(5, "Say why, in a few words.").max(300),
});

staffRouter.patch("/:id/status", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(statusInput, req.body, res);
  if (!input) return;

  const existing = await prisma.staff.findFirst({
    where: { id: String(req.params.id), facilityId: who.facilityId },
    include: { userProfile: { select: { id: true, active: true } } },
  });
  if (!existing) return res.status(404).json({ error: "not_found" });
  if (existing.status === input.status) {
    const s = await prisma.staff.findUniqueOrThrow({ where: { id: existing.id }, include: staffInclude });
    return res.json({ staff: present(s) });
  }
  if (existing.userProfile?.id === who.userId && LEAVING.includes(input.status)) {
    return res.status(409).json({
      error: "cannot_remove_self",
      message: "You cannot end your own access. Ask another facility admin to do it.",
    });
  }

  const leaving = LEAVING.includes(input.status);
  const profile = existing.userProfile;

  await prisma.$transaction(async (tx) => {
    await tx.staff.update({
      where: { id: existing.id },
      data: { status: input.status, archivedAt: leaving ? new Date() : null },
    });
    if (profile) {
      await tx.userProfile.update({ where: { id: profile.id }, data: { active: !leaving } });
    }
  });

  // Ends every session for this person now, not when their token expires.
  if (leaving && profile) {
    await revokeAllSessionsForUser(profile.id, `staff_status_${input.status.toLowerCase()}`);
  }

  const from = STAFF_STATUS_LABEL[existing.status];
  const to = STAFF_STATUS_LABEL[input.status];
  const accessNote = profile
    ? leaving
      ? " Their access was revoked and their sessions ended immediately."
      : profile.active
        ? ""
        : " Their access was restored."
    : "";
  await writeAuditLog({
    facilityId: who.facilityId,
    actorEmail: who.email,
    action: "staff_status_changed",
    entityType: "Staff",
    entityId: existing.id,
    before: { status: existing.status },
    after: { status: input.status },
    reason: input.reason,
    summary: `${who.displayName} changed ${existing.fullName}'s status from ${from} to ${to} on ${displayDate(new Date())}.${accessNote} Reason: ${input.reason}`,
  });

  const s = await prisma.staff.findUniqueOrThrow({ where: { id: existing.id }, include: staffInclude });
  res.json({ staff: present(s) });
});

// ---------------------------------------------------------------- ward

/** Limits a roster manager to one ward or department's rosters, or lifts the limit. */
staffRouter.put("/:id/ward", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(z.object({ departmentId: z.string().trim().nullish().transform((v) => v || null) }), req.body, res);
  if (!input) return;
  const s = await prisma.staff.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId }, include: { userProfile: { select: { id: true, role: true } } } });
  if (!s) return res.status(404).json({ error: "not_found" });
  if (!s.userProfile || !["ROSTER_MANAGER", "SUPERVISOR"].includes(s.userProfile.role)) {
    return res.status(409).json({ error: "not_a_manager", message: `${s.fullName} needs a roster manager or supervisor account before they can be limited to a ward.` });
  }
  const dept = input.departmentId ? await prisma.department.findFirst({ where: { id: input.departmentId, facilityId: who.facilityId }, select: { id: true, name: true } }) : null;
  if (input.departmentId && !dept) return res.status(400).json({ error: "invalid_input", message: "That department was not found." });
  await prisma.userProfile.update({ where: { id: s.userProfile.id }, data: { departmentId: dept?.id ?? null } });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "ward_manager_set", entityType: "Staff", entityId: s.id,
    summary: dept ? `${who.displayName} limited ${s.fullName} to the ${dept.name} rosters.` : `${who.displayName} let ${s.fullName} work on every roster again.`,
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- reset link

/**
 * For staff who cannot receive email (Part 3, 0.3): the admin gets a one-use
 * link, valid 60 minutes, to hand over in person or by message. It is
 * written to the audit log. Admins reset their own password from their
 * account screen instead.
 */
staffRouter.post("/:id/reset-link", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const s = await prisma.staff.findFirst({
    where: { id: String(req.params.id), facilityId: who.facilityId },
    include: { userProfile: { select: { id: true, active: true, passwordHash: true } } },
  });
  if (!s) return res.status(404).json({ error: "not_found" });
  if (!s.userProfile) {
    return res.status(409).json({ error: "no_account", message: `${s.fullName} has no HealthFlow account yet.` });
  }
  if (!s.userProfile.active) {
    return res.status(409).json({ error: "account_disabled", message: `${s.fullName}'s account is disabled, so a reset link cannot be issued.` });
  }
  if (s.userProfile.id === who.userId) {
    return res.status(409).json({ error: "own_account", message: "Change your own password from My account." });
  }

  const { token, expiresAt } = makeResetToken(s.userProfile.id, s.userProfile.passwordHash);
  await writeAuditLog({
    facilityId: who.facilityId,
    actorEmail: who.email,
    action: "password_reset_link_issued",
    entityType: "Staff",
    entityId: s.id,
    summary: `${who.displayName} issued a password reset link for ${s.fullName}, valid for ${RESET_LINK_MINUTES} minutes.`,
  });
  res.json({ url: appUrl(`/reset-password?token=${encodeURIComponent(token)}`), expiresAt });
});

// ---------------------------------------------------------------- consent

/**
 * One consent per purpose, each recorded and withdrawn separately (Part 3,
 * 0.5). A record is never edited: withdrawing stamps it, and consenting
 * again makes a new record, so the history stays visible.
 */
const CONSENT_TYPES = ["PHOTOGRAPH", "CASE_STUDY", "REFERENCE", "MARKETING"] as const;
const CONSENT_LABEL: Record<string, string> = {
  PHOTOGRAPH: "a photograph on their record",
  CASE_STUDY: "being named in a case study",
  REFERENCE: "being contacted as a reference",
  MARKETING: "appearing in PS Tech marketing",
};

staffRouter.get("/:id/consents", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  const s = await prisma.staff.findFirst({ where: { id: String(req.params.id), facilityId }, select: { id: true } });
  if (!s) return res.status(404).json({ error: "not_found" });
  const records = await prisma.consentRecord.findMany({
    where: { staffId: s.id, facilityId },
    orderBy: { grantedAt: "desc" },
  });
  res.json({
    consents: CONSENT_TYPES.map((type) => {
      const latest = records.find((r) => r.consentType === type);
      return {
        consentType: type,
        active: Boolean(latest && latest.granted && !latest.withdrawnAt),
        latest: latest
          ? { id: latest.id, grantedAt: latest.grantedAt, withdrawnAt: latest.withdrawnAt, recordedBy: latest.recordedBy, notes: latest.notes }
          : null,
      };
    }),
  });
});

const consentInput = z.object({
  consentType: z.enum(CONSENT_TYPES),
  notes: optionalText(300, "Notes"),
});

staffRouter.post("/:id/consents", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(consentInput, req.body, res);
  if (!input) return;
  const s = await prisma.staff.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!s) return res.status(404).json({ error: "not_found" });
  const active = await prisma.consentRecord.findFirst({
    where: { staffId: s.id, consentType: input.consentType, granted: true, withdrawnAt: null },
  });
  if (active) return res.status(409).json({ error: "already_given", message: "This consent is already recorded." });
  const record = await prisma.consentRecord.create({
    data: {
      facilityId: who.facilityId,
      staffId: s.id,
      consentType: input.consentType,
      granted: true,
      grantedAt: new Date(),
      recordedBy: who.email,
      notes: input.notes,
    },
  });
  await writeAuditLog({
    facilityId: who.facilityId,
    actorEmail: who.email,
    action: "consent_recorded",
    entityType: "Staff",
    entityId: s.id,
    summary: `${who.displayName} recorded ${s.fullName}'s consent to ${CONSENT_LABEL[input.consentType]}.`,
  });
  res.status(201).json({ consent: record });
});

/** Withdrawing photograph consent deletes the photograph at once (Part 3, 0.5). */
staffRouter.post("/:id/consents/:consentId/withdraw", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const s = await prisma.staff.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!s) return res.status(404).json({ error: "not_found" });
  const record = await prisma.consentRecord.findFirst({
    where: { id: String(req.params.consentId), staffId: s.id, facilityId: who.facilityId },
  });
  if (!record) return res.status(404).json({ error: "not_found" });
  if (record.withdrawnAt) return res.json({ ok: true });

  const isPhoto = record.consentType === "PHOTOGRAPH";
  const hadPhoto = isPhoto && Boolean(s.photoUrl);
  await prisma.$transaction([
    prisma.consentRecord.update({ where: { id: record.id }, data: { withdrawnAt: new Date() } }),
    ...(isPhoto ? [prisma.staff.update({ where: { id: s.id }, data: { photoUrl: null, photoConsentId: null } })] : []),
  ]);
  await writeAuditLog({
    facilityId: who.facilityId,
    actorEmail: who.email,
    action: "consent_withdrawn",
    entityType: "Staff",
    entityId: s.id,
    summary: `${who.displayName} recorded that ${s.fullName} withdrew consent to ${CONSENT_LABEL[record.consentType]}.${
      hadPhoto ? " The photograph was deleted." : ""
    }`,
  });
  res.json({ ok: true, photoDeleted: hadPhoto });
});

// ---------------------------------------------------------------- photograph

// Resized in the browser before upload; anything bigger is refused.
const MAX_PHOTO_CHARS = 90_000; // under the 100 KB request limit
const photoInput = z.object({
  dataUrl: z
    .string()
    .max(MAX_PHOTO_CHARS, "The photograph is too large. Choose a smaller image.")
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, "Choose a JPEG, PNG or WebP image."),
});

/** A photograph cannot be saved without an active photograph consent. */
staffRouter.put("/:id/photo", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(photoInput, req.body, res);
  if (!input) return;
  const s = await prisma.staff.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!s) return res.status(404).json({ error: "not_found" });
  const consent = await prisma.consentRecord.findFirst({
    where: { staffId: s.id, consentType: "PHOTOGRAPH", granted: true, withdrawnAt: null },
  });
  if (!consent) {
    return res.status(409).json({
      error: "no_photo_consent",
      message: `Record ${s.fullName}'s consent to a photograph before adding one.`,
    });
  }
  await prisma.staff.update({ where: { id: s.id }, data: { photoUrl: input.dataUrl, photoConsentId: consent.id } });
  await writeAuditLog({
    facilityId: who.facilityId,
    actorEmail: who.email,
    action: "photo_added",
    entityType: "Staff",
    entityId: s.id,
    summary: `${who.displayName} ${s.photoUrl ? "replaced" : "added"} ${s.fullName}'s photograph.`,
  });
  res.json({ ok: true });
});

staffRouter.delete("/:id/photo", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const s = await prisma.staff.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!s) return res.status(404).json({ error: "not_found" });
  if (!s.photoUrl) return res.status(204).send();
  await prisma.staff.update({ where: { id: s.id }, data: { photoUrl: null, photoConsentId: null } });
  await writeAuditLog({
    facilityId: who.facilityId,
    actorEmail: who.email,
    action: "photo_removed",
    entityType: "Staff",
    entityId: s.id,
    summary: `${who.displayName} removed ${s.fullName}'s photograph.`,
  });
  res.status(204).send();
});
