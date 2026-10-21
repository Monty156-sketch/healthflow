// Staff register themselves with the facility's access code (spec Part 7, 4).
// Public. The code, their name and email, a password and the privacy notice:
// that is the whole of it. A facility that wants to approve each person first
// (the default) gets a pending account that cannot sign in; otherwise the
// person can sign in at once. The code is not a secret; approval is the control.
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../lib/password.js";
import { checkPassword } from "../lib/passwordPolicy.js";
import { writeAuditLog } from "../lib/audit.js";
import { clientIp } from "../lib/clientIp.js";
import { normalisePhone } from "../lib/sms.js";
import { codeProblem, normaliseCode } from "../lib/accessCode.js";
import { notifyDeciders, notifyWard } from "../lib/notify.js";
import { parseOr400, optionalText, requiredText } from "../lib/validate.js";
import { currentNotice } from "./facility/privacy.js";
import { unitForCadre } from "../lib/dutyPlan.js";
import { WARD_FACILITY_TYPES } from "./facility/rosters.js";
import { ensureSupportUnits } from "../lib/supportUnits.js";

export const joinRouter = Router();

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: process.env.NODE_ENV === "test" ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  message: { error: "too_many_attempts", message: "Too many attempts from this connection. Try again in an hour, or ask your in-charge." },
});
joinRouter.use(limiter);

const BAD_CODE = { error: "invalid_code", message: "That code is not valid. Check it with your in-charge." };

async function openCode(raw: string) {
  const code = await prisma.facilityAccessCode.findUnique({ where: { code: normaliseCode(raw) }, include: { facility: { select: { id: true, name: true, active: true, status: true, facilityType: true } } } });
  if (!code || !code.facility.active || code.facility.status === "SUSPENDED" || codeProblem(code)) return null;
  return code;
}

/** Step one: is this code real, and what does the facility offer to choose from? */
joinRouter.get("/:code", async (req, res) => {
  const code = await openCode(String(req.params.code));
  if (!code) return res.status(404).json(BAD_CODE);
  const [cadres, departments] = await Promise.all([
    prisma.cadre.findMany({ where: { facilityId: code.facilityId, active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    ensureSupportUnits(code.facilityId, code.facility.facilityType).then(() =>
      prisma.department.findMany({ where: { facilityId: code.facilityId, active: true, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true } })
    ),
  ]);
  // Hospitals roster by ward, so everyone names their ward and says whether they are its in-charge.
  res.json({ facilityName: code.facility.name, cadres, departments, byWard: WARD_FACILITY_TYPES.includes(code.facility.facilityType) });
});

joinRouter.get("/:code/notice", async (req, res) => {
  const code = await openCode(String(req.params.code));
  if (!code) return res.status(404).json(BAD_CODE);
  const notice = await currentNotice(code.facilityId);
  res.json({ notice: notice ? { version: notice.version, body: notice.body } : null });
});

const registerInput = z.object({
  code: z.string().min(1),
  fullName: requiredText(120, "Full name"),
  email: z.string().trim().toLowerCase().email("Enter an email address you can open.").max(200),
  password: z.string(),
  acceptedNoticeVersion: z.string().min(1, "Read and accept the privacy notice."),
  staffNo: optionalText(30, "Staff number"),
  phone: optionalText(30, "Phone number"),
  cadreId: z.string().trim().nullish().transform((v) => v || null),
  departmentId: z.string().trim().nullish().transform((v) => v || null),
  cadreText: optionalText(80, "Cadre"),
  departmentText: optionalText(80, "Department"),
  position: optionalText(80, "Position"),
  asInCharge: z.boolean().default(false),
});

/** Step two, and the last: create the account. */
joinRouter.post("/register", async (req, res) => {
  const input = parseOr400(registerInput, req.body, res);
  if (!input) return;
  const code = await openCode(input.code);
  if (!code) return res.status(404).json(BAD_CODE);
  const facilityId = code.facilityId;

  const fields: Record<string, string> = {};
  const phone = input.phone ? normalisePhone(input.phone) : null;
  if (input.phone && !phone) fields.phone = "Enter a Ghana mobile number, such as 024 123 4567, or leave it empty.";
  if (input.cadreId && !(await prisma.cadre.findFirst({ where: { id: input.cadreId, facilityId, active: true }, select: { id: true } }))) fields.cadreId = "Choose a cadre from the list.";
  const dept = input.departmentId ? await prisma.department.findFirst({ where: { id: input.departmentId, facilityId, active: true }, select: { id: true, kind: true } }) : null;
  if (input.departmentId && !dept) fields.departmentId = "Choose a department from the list.";
  const byWard = WARD_FACILITY_TYPES.includes(code.facility.facilityType);
  if (byWard && !input.departmentId && !input.departmentText) fields.departmentId = "Choose your ward or department.";
  // Only a ward has an in-charge; security, drivers and offices are run by the administrator.
  // A health centre rosters by unit: a nurse goes to Clinical Nurses, a midwife to Midwives, public health staff to Public Health.
  if (code.facility.facilityType === "HEALTH_CENTRE" && input.cadreId) {
    const cadre = await prisma.cadre.findFirst({ where: { id: input.cadreId, facilityId }, select: { name: true } });
    const unit = unitForCadre(cadre?.name);
    if (unit) {
      const have = await prisma.department.findFirst({ where: { facilityId, name: { equals: unit.name, mode: "insensitive" }, active: true }, select: { id: true } });
      const target = have ?? (await prisma.department.create({ data: { facilityId, name: unit.name, runsNights: unit.runsNights }, select: { id: true } }));
      input.departmentId = target.id;
      input.departmentText = null;
    }
  }
  const asInCharge = byWard && input.asInCharge && dept?.kind === "WARD";
  const problem = checkPassword(input.password, input.email);
  if (problem) fields.password = problem;
  if (Object.keys(fields).length) return res.status(400).json({ error: "invalid_input", fields });

  const notice = await currentNotice(facilityId);
  if (!notice) return res.status(409).json({ error: "no_notice", message: "This facility has not published its privacy notice yet. Ask your in-charge." });
  if (notice.version !== input.acceptedNoticeVersion) return res.status(409).json({ error: "notice_changed", message: "The privacy notice was updated while you were reading. Read the new version and accept it." });

  if (await prisma.userProfile.findUnique({ where: { userEmail: input.email }, select: { id: true } })) {
    return res.status(409).json({ error: "account_exists", message: "There is already an account for that email address. Sign in instead, or use the forgot password link." });
  }
  let staffNo = input.staffNo;
  if (staffNo) {
    if (await prisma.staff.findFirst({ where: { facilityId, staffNo: { equals: staffNo, mode: "insensitive" } }, select: { id: true } })) {
      return res.status(409).json({ error: "staff_number_taken", message: "That staff number is already registered at this facility. If this is you, sign in instead, or ask your in-charge to reset your password." });
    }
  } else {
    let n = (await prisma.staff.count({ where: { facilityId } })) + 1;
    while (await prisma.staff.findFirst({ where: { facilityId, staffNo: `S-${String(n).padStart(3, "0")}` }, select: { id: true } })) n++;
    staffNo = `S-${String(n).padStart(3, "0")}`;
  }

  // An in-charge gets a ward's rosters, so the administrator always decides, whatever the code allows.
  const waits = code.requiresApproval || asInCharge;
  const passwordHash = await hashPassword(input.password);
  const staff = await prisma.$transaction(async (tx) => {
    // The use is counted first, with the limit in the same statement, so two people cannot take the last place.
    const used = await tx.facilityAccessCode.updateMany({
      where: { id: code.id, active: true, revokedAt: null, ...(code.maxUses !== null ? { usesCount: { lt: code.maxUses } } : {}) },
      data: { usesCount: { increment: 1 } },
    });
    if (used.count === 0) return null;
    const s = await tx.staff.create({
      data: {
        facilityId, staffNo: staffNo!, fullName: input.fullName, phone, email: input.email, cadreId: input.cadreId, departmentId: input.departmentId, position: input.position,
        requestedCadre: input.cadreId ? null : input.cadreText, requestedDepartment: input.departmentId ? null : input.departmentText,
        status: waits ? "PENDING" : "ACTIVE", joinedVia: "CODE", requestedInCharge: asInCharge,
      },
    });
    await tx.userProfile.create({
      data: { userEmail: input.email, passwordHash, role: "STAFF", scopeType: "FACILITY", scopeId: facilityId, facilityId, staffId: s.id, active: !waits, privacyNoticeVersionAccepted: notice.version },
    });
    return s;
  });
  if (!staff) return res.status(404).json(BAD_CODE);

  await writeAuditLog({
    facilityId, actorEmail: input.email, action: "staff_joined_with_code", entityType: "Staff", entityId: staff.id,
    summary: `${staff.fullName} registered with the facility access code${asInCharge ? " as a ward in-charge" : ""} and agreed to version ${notice.version} of the privacy notice. ${waits ? "They are waiting for approval." : "They can sign in now."}`,
  });
  if (waits) {
    const note = { type: "join_pending", title: `${staff.fullName} is waiting for approval`, body: `${staff.fullName} registered with the access code${asInCharge ? " as a ward in-charge" : ""} and waits for approval.`, linkUrl: "/staff/access", severity: "INFO" as const };
    // In a hospital the ward's own in-charge approves its staff; an in-charge is approved by the administrator.
    if (byWard) await notifyWard(facilityId, asInCharge || dept?.kind !== "WARD" ? null : input.departmentId, note);
    else await notifyDeciders(facilityId, note);
  }
  res.status(201).json({ status: waits ? "pending" : "active", facilityName: code.facility.name });
});
