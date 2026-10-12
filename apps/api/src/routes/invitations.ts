// Invitations: how a staff member gets a HealthFlow account.
//
// A facility admin invites someone already on the staff list, choosing
// their role. The link is emailed when email is set up, and always shown to
// the admin to pass on. Only a fingerprint of the link is stored, so the
// database never holds a working link. Links last 7 days; inviting the same
// person again cancels the earlier link.
//
// Accepting means reading and accepting the facility's current privacy
// notice (its version is recorded), choosing a password and, for roles that
// require it, setting up two-step sign-in before the first session starts.
import { Router } from "express";
import { z } from "zod";
import type { Role } from "@healthflow/db";
import { prisma } from "../lib/prisma.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { hashPassword } from "../lib/password.js";
import { checkPassword } from "../lib/passwordPolicy.js";
import { writeAuditLog } from "../lib/audit.js";
import { appUrl, sendEmail } from "../lib/email.js";
import { makeEnrolmentToken } from "../lib/signedTokens.js";
import { parseOr400, requiredText, optionalText } from "../lib/validate.js";
import { authAttemptLimiter } from "../middleware/rateLimit.js";
import { allowRoles, caller, ADMIN_ROLES } from "../middleware/facilityAccess.js";
import { currentNotice } from "./facility/privacy.js";

export const INVITATION_DAYS = 7;
const INVITABLE_ROLES = ["STAFF", "SUPERVISOR", "ROSTER_MANAGER", "FACILITY_ADMIN"] as const;
const ROLE_LABEL: Record<string, string> = {
  STAFF: "Staff",
  SUPERVISOR: "Supervisor",
  ROSTER_MANAGER: "Roster manager",
  FACILITY_ADMIN: "Facility admin",
};

// ------------------------------------------------------------- issuing an invitation

type Who = ReturnType<typeof caller>;
type StaffWithAccount = NonNullable<Awaited<ReturnType<typeof loadStaffForInvite>>>;

function loadStaffForInvite(facilityId: string, id: string) {
  return prisma.staff.findFirst({ where: { id, facilityId }, include: { userProfile: { select: { id: true } } } });
}

/**
 * Creates the link for one staff member (cancelling any earlier one) and
 * emails it when email is set up. Returns the reason in words when the
 * person cannot be invited.
 */
async function issueInvitation(
  who: Who,
  s: StaffWithAccount,
  role: (typeof INVITABLE_ROLES)[number]
): Promise<{ refuse: string } | { url: string; expiresAt: Date; emailed: boolean }> {
  if (s.userProfile) return { refuse: `${s.fullName} already has a HealthFlow account.` };
  if (!["ACTIVE", "ON_LEAVE", "PENDING"].includes(s.status)) return { refuse: `${s.fullName} is not a current staff member.` };
  if (!s.email) return { refuse: `Add an email address to ${s.fullName}'s record first. It is what they will sign in with.` };
  if (await prisma.userProfile.findUnique({ where: { userEmail: s.email }, select: { id: true } })) {
    return { refuse: `Another HealthFlow account already uses ${s.email}. Check the email on ${s.fullName}'s record.` };
  }
  const notice = await currentNotice(who.facilityId);
  if (!notice) {
    return { refuse: "Publish your facility's privacy notice first, under Privacy and data protection. New staff read and accept it when they join." };
  }

  const raw = randomToken(32);
  const expiresAt = new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.staffInvitation.updateMany({
      where: { facilityId: who.facilityId, staffId: s.id, status: "PENDING" },
      data: { status: "REVOKED" },
    }),
    prisma.staffInvitation.create({
      data: {
        facilityId: who.facilityId,
        staffId: s.id,
        email: s.email,
        phone: s.phone,
        token: sha256(raw),
        role: role as Role,
        sentAt: new Date(),
        expiresAt,
      },
    }),
  ]);

  const facility = await prisma.facility.findUniqueOrThrow({ where: { id: who.facilityId }, select: { name: true } });
  const url = appUrl(`/invite?token=${encodeURIComponent(raw)}`);
  const emailed = await sendEmail({
    to: s.email,
    subject: `Your HealthFlow account at ${facility.name}`,
    text:
      `${who.displayName} has invited you to HealthFlow at ${facility.name}, as ${ROLE_LABEL[role]}.\n\n` +
      `Open this link to create your account. It works for ${INVITATION_DAYS} days:\n${url}\n\n` +
      `You will choose a password and set up an authenticator app on your phone. The app gives you the code you need each time you sign in.\n\n` +
      `If you were not expecting this, you can ignore it.`,
  });
  await writeAuditLog({
    facilityId: who.facilityId,
    actorEmail: who.email,
    action: "invitation_sent",
    entityType: "Staff",
    entityId: s.id,
    summary: `${who.displayName} invited ${s.fullName} to HealthFlow as ${ROLE_LABEL[role]}${emailed ? `, by email to ${s.email}` : ""}.`,
  });
  return { url, expiresAt, emailed };
}

// ------------------------------------------------------------- admin side, per staff record (mounted on /api/facility/staff)

export const staffInvitationRouter = Router({ mergeParams: true });

const inviteInput = z.object({
  role: z.enum(INVITABLE_ROLES, { errorMap: () => ({ message: "Choose a role." }) }),
});

staffInvitationRouter.post("/:id/invite", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(inviteInput, req.body, res);
  if (!input) return;
  const s = await loadStaffForInvite(who.facilityId, String(req.params.id));
  if (!s) return res.status(404).json({ error: "not_found" });
  const result = await issueInvitation(who, s, input.role);
  if ("refuse" in result) return res.status(409).json({ error: "cannot_invite", message: result.refuse });
  res.status(201).json({ url: result.url, expiresAt: result.expiresAt, emailed: result.emailed });
});

staffInvitationRouter.post("/:id/invite/revoke", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const s = await prisma.staff.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!s) return res.status(404).json({ error: "not_found" });
  const result = await prisma.staffInvitation.updateMany({
    where: { facilityId: who.facilityId, staffId: s.id, status: "PENDING" },
    data: { status: "REVOKED" },
  });
  if (result.count) {
    await writeAuditLog({
      facilityId: who.facilityId,
      actorEmail: who.email,
      action: "invitation_revoked",
      entityType: "Staff",
      entityId: s.id,
      summary: `${who.displayName} cancelled ${s.fullName}'s invitation to HealthFlow.`,
    });
  }
  res.json({ ok: true });
});

// ------------------------------------------------------------- admin side, by email (mounted on /api/facility/invitations)

export const invitationAdminRouter = Router();

const newInvitationInput = z.object({
  fullName: requiredText(120, "Full name"),
  email: z
    .string({ required_error: "Email is required." })
    .trim()
    .toLowerCase()
    .email("Enter a valid email address.")
    .max(200),
  role: z.enum(INVITABLE_ROLES, { errorMap: () => ({ message: "Choose a role." }) }),
  staffNo: optionalText(30, "Staff number"),
  cadreId: z.string().nullish(),
  departmentId: z.string().nullish(),
});

/** Everyone invited: waiting, expired or joined. */
invitationAdminRouter.get("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  const rows = await prisma.staffInvitation.findMany({
    where: { facilityId, status: { in: ["PENDING", "ACCEPTED"] } },
    orderBy: { sentAt: "desc" },
    take: 100,
  });
  const staff = await prisma.staff.findMany({
    where: { id: { in: rows.map((r) => r.staffId).filter((x): x is string => Boolean(x)) } },
    select: { id: true, fullName: true },
  });
  const nameOf = new Map(staff.map((s) => [s.id, s.fullName]));
  const now = new Date();
  res.json({
    invitations: rows.map((r) => ({
      id: r.id,
      staffId: r.staffId,
      fullName: (r.staffId && nameOf.get(r.staffId)) || r.email,
      email: r.email,
      role: r.role,
      status: r.status === "ACCEPTED" ? "joined" : r.expiresAt < now ? "expired" : "waiting",
      sentAt: r.sentAt,
      expiresAt: r.expiresAt,
    })),
  });
});

/**
 * Invite someone by email. If the person is not on the staff list yet, a
 * staff record is created for them, which they and the admin can complete
 * later; an email already on the staff list is reused.
 */
invitationAdminRouter.post("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(newInvitationInput, req.body, res);
  if (!input) return;

  let staffRecord = await prisma.staff.findFirst({
    where: { facilityId: who.facilityId, email: { equals: input.email, mode: "insensitive" } },
  });
  let created = false;
  if (!staffRecord) {
    // Checked first so that nobody is added to the staff list by an invitation that cannot be sent.
    if (await prisma.userProfile.findUnique({ where: { userEmail: input.email }, select: { id: true } })) {
      return res.status(409).json({ error: "cannot_invite", message: `A HealthFlow account already uses ${input.email}.` });
    }
    if (!(await currentNotice(who.facilityId))) {
      return res.status(409).json({
        error: "cannot_invite",
        message: "Publish your facility's privacy notice first, under Privacy and data protection. New staff read and accept it when they join.",
      });
    }
    const fields: Record<string, string> = {};
    if (input.cadreId && !(await prisma.cadre.findFirst({ where: { id: input.cadreId, facilityId: who.facilityId }, select: { id: true } }))) {
      fields.cadreId = "Choose a cadre from your facility.";
    }
    if (input.departmentId && !(await prisma.department.findFirst({ where: { id: input.departmentId, facilityId: who.facilityId }, select: { id: true } }))) {
      fields.departmentId = "Choose a department from your facility.";
    }
    let staffNo = input.staffNo;
    if (staffNo) {
      if (await prisma.staff.findFirst({ where: { facilityId: who.facilityId, staffNo }, select: { id: true } })) {
        fields.staffNo = "Another staff member already has this staff number.";
      }
    } else {
      // No number yet: a placeholder the admin replaces on the staff record.
      const n = (await prisma.staff.count({ where: { facilityId: who.facilityId } })) + 1;
      staffNo = `TBC-${String(n).padStart(3, "0")}`;
      while (await prisma.staff.findFirst({ where: { facilityId: who.facilityId, staffNo }, select: { id: true } })) {
        staffNo = `TBC-${String(Math.floor(Math.random() * 900) + 100)}`;
      }
    }
    if (Object.keys(fields).length) return res.status(400).json({ error: "invalid_input", fields });
    staffRecord = await prisma.staff.create({
      data: {
        facilityId: who.facilityId,
        staffNo,
        fullName: input.fullName,
        email: input.email,
        cadreId: input.cadreId || null,
        departmentId: input.departmentId || null,
        status: "PENDING",
      },
    });
    created = true;
  }

  const s = await loadStaffForInvite(who.facilityId, staffRecord.id);
  if (!s) return res.status(404).json({ error: "not_found" });
  const result = await issueInvitation(who, s, input.role);
  if ("refuse" in result) return res.status(409).json({ error: "cannot_invite", message: result.refuse });
  if (created) {
    await writeAuditLog({
      facilityId: who.facilityId,
      actorEmail: who.email,
      action: "staff_created",
      entityType: "Staff",
      entityId: s.id,
      summary: `${who.displayName} added ${s.fullName} (staff no. ${s.staffNo}) to the staff list while inviting them.`,
    });
  }
  res.status(201).json({ url: result.url, expiresAt: result.expiresAt, emailed: result.emailed, staffId: s.id, name: s.fullName });
});

invitationAdminRouter.post("/:id/revoke", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const inv = await prisma.staffInvitation.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!inv) return res.status(404).json({ error: "not_found" });
  if (inv.status === "PENDING") {
    await prisma.staffInvitation.update({ where: { id: inv.id }, data: { status: "REVOKED" } });
    const name = inv.staffId ? (await prisma.staff.findUnique({ where: { id: inv.staffId }, select: { fullName: true } }))?.fullName : null;
    await writeAuditLog({
      facilityId: who.facilityId,
      actorEmail: who.email,
      action: "invitation_revoked",
      entityType: "Staff",
      entityId: inv.staffId,
      summary: `${who.displayName} cancelled ${name ?? inv.email}'s invitation to HealthFlow.`,
    });
  }
  res.json({ ok: true });
});

/** A fresh link for someone already invited. The old link stops working. */
invitationAdminRouter.post("/:id/resend", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const inv = await prisma.staffInvitation.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId } });
  if (!inv || !inv.staffId) return res.status(404).json({ error: "not_found" });
  const s = await loadStaffForInvite(who.facilityId, inv.staffId);
  if (!s) return res.status(404).json({ error: "not_found" });
  const role = INVITABLE_ROLES.find((r) => r === inv.role) ?? "STAFF";
  const result = await issueInvitation(who, s, role);
  if ("refuse" in result) return res.status(409).json({ error: "cannot_invite", message: result.refuse });
  res.status(201).json({ url: result.url, expiresAt: result.expiresAt, emailed: result.emailed, staffId: s.id, name: s.fullName });
});

// ------------------------------------------------------------- the invited person (public, /api/invitations)

export const invitationRouter = Router();

async function findInvitation(raw: string) {
  if (!raw) return { status: "invalid" as const };
  const inv = await prisma.staffInvitation.findUnique({ where: { token: sha256(raw) } });
  if (!inv) return { status: "invalid" as const };
  if (inv.status === "ACCEPTED") return { status: "used" as const };
  if (inv.status !== "PENDING") return { status: "invalid" as const };
  if (inv.expiresAt < new Date()) return { status: "expired" as const };
  return { status: "ok" as const, inv };
}

invitationRouter.get("/check", async (req, res) => {
  const found = await findInvitation(String(req.query.token ?? ""));
  if (found.status !== "ok") return res.json({ status: found.status });
  const { inv } = found;
  const [facility, staff, notice] = await Promise.all([
    prisma.facility.findUniqueOrThrow({ where: { id: inv.facilityId }, select: { name: true } }),
    inv.staffId ? prisma.staff.findUnique({ where: { id: inv.staffId }, select: { fullName: true } }) : null,
    currentNotice(inv.facilityId),
  ]);
  res.json({
    status: notice ? "ok" : "invalid",
    facilityName: facility.name,
    fullName: staff?.fullName ?? null,
    email: inv.email,
    role: inv.role,
    // Everyone invited sets up an authenticator app: the code it shows is
    // needed with their email and password at every sign-in.
    mfaRequired: true,
    notice: notice ? { version: notice.version, body: notice.body } : null,
  });
});

const acceptInput = z.object({
  token: z.string().min(1),
  password: z.string(),
  acceptedNoticeVersion: z.string().min(1, "Read and accept the privacy notice."),
});

invitationRouter.post("/accept", authAttemptLimiter, async (req, res) => {
  const input = parseOr400(acceptInput, req.body, res);
  if (!input) return;
  const found = await findInvitation(input.token);
  if (found.status !== "ok") {
    return res.status(400).json({
      error: `invitation_${found.status}`,
      message:
        found.status === "expired"
          ? "This invitation has expired. Ask your facility admin to send a new one."
          : found.status === "used"
            ? "This invitation has already been used. Sign in instead."
            : "This invitation is not valid. Ask your facility admin for a new one.",
    });
  }
  const { inv } = found;
  if (!inv.email || !inv.staffId) return res.status(400).json({ error: "invitation_invalid", message: "This invitation is not valid." });

  const notice = await currentNotice(inv.facilityId);
  if (!notice || notice.version !== input.acceptedNoticeVersion) {
    return res.status(409).json({
      error: "notice_changed",
      message: "The privacy notice was updated while you were reading. Read the new version and accept it.",
    });
  }
  const problem = checkPassword(input.password, inv.email);
  if (problem) return res.status(400).json({ error: "invalid_input", fields: { password: problem } });

  const staff = await prisma.staff.findUnique({ where: { id: inv.staffId } });
  if (!staff || !["ACTIVE", "ON_LEAVE", "PENDING"].includes(staff.status)) {
    return res.status(400).json({ error: "invitation_invalid", message: "This invitation is no longer valid. Ask your facility admin." });
  }
  if (await prisma.userProfile.findUnique({ where: { userEmail: inv.email }, select: { id: true } })) {
    return res.status(409).json({ error: "account_exists", message: "An account with this email already exists. Sign in instead." });
  }

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.userProfile.create({
      data: {
        userEmail: inv.email!,
        passwordHash: await hashPassword(input.password),
        role: inv.role,
        scopeType: "FACILITY",
        scopeId: inv.facilityId,
        facilityId: inv.facilityId,
        staffId: inv.staffId,
        privacyNoticeVersionAccepted: notice.version,
      },
    });
    await tx.staffInvitation.update({ where: { id: inv.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
    if (staff.status === "PENDING") await tx.staff.update({ where: { id: staff.id }, data: { status: "ACTIVE" } });
    return created;
  });

  await writeAuditLog({
    facilityId: inv.facilityId,
    actorEmail: user.userEmail,
    action: "invitation_accepted",
    entityType: "Staff",
    entityId: staff.id,
    summary: `${staff.fullName} accepted their invitation, agreed to version ${notice.version} of the privacy notice and created a HealthFlow account as ${ROLE_LABEL[inv.role]}.`,
  });

  return res.json({ next: "mfa_setup", enrolmentToken: makeEnrolmentToken(user.id) });
});
