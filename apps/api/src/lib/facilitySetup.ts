// Setting up a new facility: starting departments and cadres for its type,
// shifts and rules copied from an existing facility if the platform admin
// chooses, and the first administrator's invitation. No staff records are read
// or written by the platform; staff are imported by the facility itself.
import type { FacilityType } from "@healthflow/db";
import { prisma } from "./prisma.js";
import { ensureRules } from "../routes/facility/rules.js";
import { noticeTemplate } from "../routes/facility/privacy.js";
import { randomToken, sha256 } from "./crypto.js";
import { appUrl, sendEmail } from "./email.js";
import { INVITATION_DAYS } from "../routes/invitations.js";

const SMALL = { departments: ["General"], cadres: ["Community Health Nurse", "Enrolled Nurse", "Health Assistant"] };
const MEDIUM = { departments: ["Outpatient", "Maternity", "Laboratory", "Pharmacy", "Administration"], cadres: ["Medical Officer", "Physician Assistant", "Midwife", "Nurse", "Enrolled Nurse", "Pharmacist", "Laboratory Scientist", "Health Assistant"] };
const LARGE = { departments: ["Outpatient", "Maternity", "Surgery", "Medicine", "Paediatrics", "Emergency", "Theatre", "Laboratory", "Pharmacy", "Administration"], cadres: ["Medical Officer", "Specialist", "Physician Assistant", "Midwife", "Nurse", "Enrolled Nurse", "Anaesthetist", "Pharmacist", "Laboratory Scientist", "Radiographer", "Health Assistant"] };

export const SEEDS: Record<FacilityType, { departments: string[]; cadres: string[] }> = {
  CHPS_COMPOUND: SMALL,
  HEALTH_CENTRE: MEDIUM,
  CLINIC: MEDIUM,
  POLYCLINIC: MEDIUM,
  HOSPITAL: LARGE,
  PRIVATE_HOSPITAL: LARGE,
};

export async function seedGroups(facilityId: string, type: FacilityType) {
  const seed = SEEDS[type];
  const [deps, cads] = await Promise.all([prisma.department.count({ where: { facilityId } }), prisma.cadre.count({ where: { facilityId } })]);
  if (deps === 0) await prisma.department.createMany({ data: seed.departments.map((name) => ({ facilityId, name })) });
  if (cads === 0) await prisma.cadre.createMany({ data: seed.cadres.map((name, i) => ({ facilityId, name, sortOrder: i })) });
  return { departments: deps === 0 ? seed.departments.length : 0, cadres: cads === 0 ? seed.cadres.length : 0 };
}

/** Copies shifts and rule settings. Cadres in a shift's lists are matched by name. */
export async function copyConfiguration(fromId: string, toId: string) {
  const [shifts, srcCadres, dstCadres, rules] = await Promise.all([
    prisma.shift.findMany({ where: { facilityId: fromId, active: true } }),
    prisma.cadre.findMany({ where: { facilityId: fromId }, select: { id: true, name: true } }),
    prisma.cadre.findMany({ where: { facilityId: toId }, select: { id: true, name: true } }),
    prisma.constraintRule.findMany({ where: { facilityId: fromId } }),
  ]);
  const toNew = new Map<string, string>();
  for (const c of srcCadres) { const d = dstCadres.find((x) => x.name.toLowerCase() === c.name.toLowerCase()); if (d) toNew.set(c.id, d.id); }
  const have = new Set((await prisma.shift.findMany({ where: { facilityId: toId }, select: { code: true } })).map((s) => s.code));
  let copied = 0;
  for (const s of shifts) {
    if (have.has(s.code)) continue;
    const mins = Object.fromEntries(Object.entries((s.minByCadre ?? {}) as Record<string, number>).flatMap(([k, v]) => (toNew.has(k) ? [[toNew.get(k)!, v]] : [])));
    await prisma.shift.create({
      data: {
        facilityId: toId, name: s.name, code: s.code, startTime: s.startTime, endTime: s.endTime, durationHours: s.durationHours, isOvernight: s.isOvernight, isOnCall: s.isOnCall,
        onCallHoursFactor: s.onCallHoursFactor, onCallAdviceNote: s.onCallAdviceNote, minStaff: s.minStaff, minByCadre: mins, colour: s.colour, countsAsDuty: s.countsAsDuty, sortOrder: s.sortOrder,
        eligibleCadreIds: s.eligibleCadreIds.flatMap((id) => (toNew.has(id) ? [toNew.get(id)!] : [])),
      },
    });
    copied++;
  }
  await ensureRules(toId);
  for (const r of rules) {
    await prisma.constraintRule.updateMany({ where: { facilityId: toId, code: r.code }, data: { thresholdValue: r.thresholdValue, behaviour: r.behaviour, enabled: r.enabled } });
  }
  return { shifts: copied, rules: rules.length };
}

/**
 * The first administrator: a pending staff record and a seven day invitation.
 * A starter privacy notice is published if there is none, so the invitation
 * can be accepted. The administrator is told to read and edit it.
 */
export async function inviteFirstAdmin(facilityId: string, facilityName: string, name: string, email: string) {
  let notice = await prisma.privacyNotice.findFirst({ where: { facilityId, publishedAt: { not: null } } });
  let starterNotice = false;
  if (!notice) {
    notice = await prisma.privacyNotice.create({
      data: { facilityId, version: "1", body: noticeTemplate(facilityName).replace(/Data protection contact:.*$/m, "Data protection contact: the facility administrator."), publishedAt: new Date(), publishedBy: "PS Tech (starter notice)" },
    });
    starterNotice = true;
  }
  const n = (await prisma.staff.count({ where: { facilityId } })) + 1;
  const staff = await prisma.staff.create({ data: { facilityId, staffNo: `ADMIN-${String(n).padStart(3, "0")}`, fullName: name, email, status: "PENDING" } });
  const raw = randomToken(32);
  const expiresAt = new Date(Date.now() + INVITATION_DAYS * 86_400_000);
  await prisma.staffInvitation.create({ data: { facilityId, staffId: staff.id, email, token: sha256(raw), role: "FACILITY_ADMIN", sentAt: new Date(), expiresAt } });
  const url = appUrl(`/invite?token=${encodeURIComponent(raw)}`);
  const emailed = await sendEmail({
    to: email,
    subject: `Your HealthFlow account at ${facilityName}`,
    text: `PS Tech has set up ${facilityName} on HealthFlow and invited you as its administrator.\n\nOpen this link to create your account. It works for ${INVITATION_DAYS} days:\n${url}\n\nYou will choose a password and set up an authenticator app on your phone.\n\nIf you were not expecting this, you can ignore it.`,
  });
  return { url, expiresAt, emailed, starterNotice };
}
