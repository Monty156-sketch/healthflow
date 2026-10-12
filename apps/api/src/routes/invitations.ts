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
import { ROLES_REQUIRING_MFA } from "@healthflow/shared";
import { prisma } from "../lib/prisma.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { hashPassword } from "../lib/password.js";
import { checkPassword } from "../lib/passwordPolicy.js";
import { writeAuditLog } from "../lib/audit.js";
import { appUrl, sendEmail } from "../lib/email.js";
import { makeEnrolmentToken } from "../lib/signedTokens.js";
import { parseOr400 } from "../lib/validate.js";
import { authAttemptLimiter } from "../middleware/rateLimit.js";
import { allowRoles, caller, ADMIN_ROLES } from "../middleware/facilityAccess.js";
import { currentNotice } from "./facility/privacy.js";
import { publicUser, startSession } from "./auth.js";

export const INVITATION_DAYS = 7;
const INVITABLE_ROLES = ["STAFF", "SUPERVISOR", "ROSTER_MANAGER", "FACILITY_ADMIN"] as const;
const ROLE_LABEL: Record<string, string> = {
  STAFF: "Staff",
  SUPERVISOR: "Supervisor",
  ROSTER_MANAGER: "Roster manager",
  FACILITY_ADMIN: "Facility admin",
};

// ------------------------------------------------------------- admin side (mounted on /api/facility/staff)

export const staffInvitationRouter = Router({ mergeParams: true });

const inviteInput = z.object({
  role: z.enum(INVITABLE_ROLES, { errorMap: () => ({ message: "Choose a role." }) }),
});

staffInvitationRouter.post("/:id/invite", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(inviteInput, req.body, res);
  if (!input) return;

  const s = await prisma.staff.findFirst({
    where: { id: String(req.params.id), facilityId: who.facilityId },
    include: { userProfile: { select: { id: true } } },
  });
  if (!s) return res.status(404).json({ error: "not_found" });

  const refuse = (message: string) => res.status(409).json({ error: "cannot_invite", message });
  if (s.userProfile) return refuse(`${s.fullName} already has a HealthFlow account.`);
  if (!["ACTIVE", "ON_LEAVE", "PENDING"].includes(s.status)) return refuse(`${s.fullName} is not a current staff member.`);
  if (!s.email) return refuse(`Add an email address to ${s.fullName}'s record first. It is what they will sign in with.`);
  if (await prisma.userProfile.findUnique({ where: { userEmail: s.email }, select: { id: true } })) {
    return refuse(`Another HealthFlow account already uses ${s.email}. Check the email on ${s.fullName}'s record.`);
  }
  const notice = await currentNotice(who.facilityId);
  if (!notice) {
    return refuse("Publish your facility's privacy notice first, under Privacy and data protection. New staff read and accept it when they join.");
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
        role: input.role as Role,
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
      `${who.displayName} has invited you to HealthFlow at ${facility.name}, as ${ROLE_LABEL[input.role]}.\n\n` +
      `Open this link to create your account. It works for ${INVITATION_DAYS} days:\n${url}\n\n` +
      `If you were not expecting this, you can ignore it.`,
  });
  await writeAuditLog({
    facilityId: who.facilityId,
    actorEmail: who.email,
    action: "invitation_sent",
    entityType: "Staff",
    entityId: s.id,
    summary: `${who.displayName} invited ${s.fullName} to HealthFlow as ${ROLE_LABEL[input.role]}${emailed ? `, by email to ${s.email}` : ""}.`,
  });
  res.status(201).json({ url, expiresAt, emailed });
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
    mfaRequired: ROLES_REQUIRING_MFA.includes(inv.role),
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

  if (ROLES_REQUIRING_MFA.includes(user.role)) {
    return res.json({ next: "mfa_setup", enrolmentToken: makeEnrolmentToken(user.id) });
  }
  const accessToken = await startSession(req, res, user, "for the first time");
  res.json({ next: "signed_in", accessToken, user: publicUser(user) });
});
