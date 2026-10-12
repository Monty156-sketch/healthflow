// Staff records. Never deleted: a person who leaves gets a leaving status
// (Inactive, Transferred, Resigned, Retired), which keeps their history and
// immediately ends their access (Part 3, 0.3: "the most commonly missed
// control in systems of this kind").
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
    excludedFromNights: z.boolean().default(false),
    exclusionReason: optionalText(200, "Reason"),
    maxDutiesPerWeek: z
      .number({ invalid_type_error: "Maximum duties per week must be a number." })
      .int("Maximum duties per week must be a whole number.")
      .min(0, "Maximum duties per week cannot be negative.")
      .max(7, "Maximum duties per week cannot be more than 7.")
      .default(0),
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
  userProfile: { select: { role: true, active: true, lastSignInAt: true, mfaEnabled: true } },
} satisfies Prisma.StaffInclude;

type StaffRow = Prisma.StaffGetPayload<{ include: typeof staffInclude }>;

/** What the browser receives. Dates as YYYY-MM-DD; no photo or consent internals yet. */
function present(s: StaffRow) {
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
    excludedFromNights: s.excludedFromNights,
    exclusionReason: s.exclusionReason,
    maxDutiesPerWeek: s.maxDutiesPerWeek,
    account: s.userProfile
      ? {
          role: s.userProfile.role,
          active: s.userProfile.active,
          lastSignInAt: s.userProfile.lastSignInAt,
          mfaEnabled: s.userProfile.mfaEnabled,
        }
      : null,
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
  const { facilityId } = caller(req);
  const query = parseOr400(listQuery, req.query, res);
  if (!query) return;

  const where: Prisma.StaffWhereInput = {
    facilityId,
    ...(query.show === "current" ? { status: { in: CURRENT } } : {}),
    ...(query.show === "former" ? { status: { in: LEAVING } } : {}),
    ...(query.cadreId ? { cadreId: query.cadreId } : {}),
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
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
    orderBy: [{ fullName: "asc" }],
    take: 1000,
  });
  res.json({ staff: staff.map(present) });
});

// ---------------------------------------------------------------- one

staffRouter.get("/:id", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  const s = await prisma.staff.findFirst({
    where: { id: String(req.params.id), facilityId },
    include: staffInclude,
  });
  if (!s) return res.status(404).json({ error: "not_found" });
  res.json({ staff: present(s) });
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
      exclusionReason: input.excludedFromNights ? input.exclusionReason : null,
      maxDutiesPerWeek: input.maxDutiesPerWeek,
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
  exclusionReason: "night exclusion reason",
  maxDutiesPerWeek: "maximum duties per week",
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

  const s = await prisma.staff.update({
    where: { id: existing.id },
    data: {
      staffNo: input.staffNo,
      fullName: input.fullName,
      phone: input.phone,
      email: input.email,
      cadreId: input.cadreId,
      departmentId: input.departmentId,
      position: input.position,
      employmentStatus: input.employmentStatus,
      dateJoined: input.dateJoined,
      emergencyContactName: input.emergencyContactName,
      emergencyContactPhone: input.emergencyContactPhone,
      excludedFromNights: input.excludedFromNights,
      exclusionReason: input.excludedFromNights ? input.exclusionReason : null,
      maxDutiesPerWeek: input.maxDutiesPerWeek,
    },
    include: staffInclude,
  });

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
    if (k === "excludedFromNights") return b ? "excluded them from night duty" : "returned them to night duty";
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
    summary: `${who.displayName} changed ${existing.fullName}'s status from ${from} to ${to} on ${displayDate(new Date())}.${accessNote}`,
  });

  const s = await prisma.staff.findUniqueOrThrow({ where: { id: existing.id }, include: staffInclude });
  res.json({ staff: present(s) });
});
