// Setting up a new facility: starting departments and cadres for its type,
// shifts and rules copied from an existing facility if the platform admin
// chooses, and the first administrator's invitation. No staff records are read
// or written by the platform; staff are imported by the facility itself.
import type { FacilityType } from "@healthflow/db";
import { prisma } from "./prisma.js";
import { cadreDefaults, defaultRunsNights } from "./dutyPlan.js";
import { ensureRules } from "../routes/facility/rules.js";
import { noticeTemplate } from "../routes/facility/privacy.js";
import { randomToken, sha256 } from "./crypto.js";
import { appUrl, sendEmail } from "./email.js";
import { INVITATION_DAYS } from "../routes/invitations.js";

/** Every cadre and department a health facility in Ghana is likely to have. Added to each facility, so staff imports are not turned away for a missing one. */
export const STANDARD_CADRES = ["Medical Officer", "Specialist", "Physician Assistant", "Midwife", "Nurse", "Enrolled Nurse", "Community Health Nurse", "Community Health Officer", "Nurse Anaesthetist", "Pharmacist", "Pharmacy Technician", "Laboratory Scientist", "Laboratory Technician", "Radiographer", "Physiotherapist", "Dietician", "Dental Surgeon", "Dental Therapist", "Disease Control Officer", "Health Information Officer", "Health Assistant", "Ward Assistant", "Orderly", "Accountant", "Administrator", "Driver", "Security", "Cleaner"];
export const STANDARD_DEPARTMENTS = ["Outpatient", "Maternity", "Antenatal and Postnatal", "Child Welfare", "Emergency", "Surgery", "Medicine", "Paediatrics", "Theatre", "Intensive Care", "Laboratory", "Pharmacy", "Radiology", "Dental", "Eye", "Physiotherapy", "Public Health", "Records", "Administration", "Accounts", "Stores", "Transport", "Mortuary", "Support Services"];

const SMALL_FACILITIES = ["CHPS_COMPOUND", "HEALTH_CENTRE", "CLINIC"];
const CHPS_CADRES = ["Community Health Officer", "Community Health Nurse", "Midwife", "Health Assistant", "Cleaner"];
const CHPS_DEPARTMENTS = ["Outpatient", "Maternity", "Antenatal and Postnatal", "Child Welfare", "Public Health", "Administration"];
const CENTRE_CADRES = ["Physician Assistant", "Midwife", "Nurse", "Enrolled Nurse", "Community Health Nurse", "Community Health Officer", "Pharmacy Technician", "Laboratory Technician", "Disease Control Officer", "Health Information Officer", "Health Assistant", "Ward Assistant", "Orderly", "Accountant", "Administrator", "Driver", "Security", "Cleaner"];
const CENTRE_DEPARTMENTS = ["Outpatient", "Maternity", "Antenatal and Postnatal", "Child Welfare", "Emergency", "Laboratory", "Pharmacy", "Public Health", "Records", "Administration", "Accounts", "Support Services"];

/**
 * The cadres and departments a facility of this type is offered at registration.
 * A CHPS compound or health centre does not have a surgeon, theatre or radiology, so they are not listed;
 * polyclinics, hospitals, regional and teaching hospitals get the full set. The administrator can add any.
 */
export function portfolioFor(type?: string | null): { cadres: string[]; departments: string[] } {
  if (type === "CHPS_COMPOUND") return { cadres: CHPS_CADRES, departments: CHPS_DEPARTMENTS };
  if (type && SMALL_FACILITIES.includes(type)) return { cadres: CENTRE_CADRES, departments: CENTRE_DEPARTMENTS };
  return { cadres: STANDARD_CADRES, departments: STANDARD_DEPARTMENTS };
}

/** Adds any standard cadre or department the facility does not already have, by name, leaving everything it has as it is. */
export async function seedGroups(facilityId: string, type?: FacilityType) {
  const portfolio = portfolioFor(type);
  const [deps, cads] = await Promise.all([
    prisma.department.findMany({ where: { facilityId }, select: { name: true } }),
    prisma.cadre.findMany({ where: { facilityId }, select: { name: true } }),
  ]);
  const haveDep = new Set(deps.map((d) => d.name.toLowerCase()));
  const haveCad = new Set(cads.map((c) => c.name.toLowerCase()));
  const newDeps = portfolio.departments.filter((n) => !haveDep.has(n.toLowerCase()));
  const newCads = portfolio.cadres.map((name, i) => ({ name, i })).filter((c) => !haveCad.has(c.name.toLowerCase()));
  if (newDeps.length) await prisma.department.createMany({ data: newDeps.map((name) => ({ facilityId, name, runsNights: defaultRunsNights(name) })) });
  if (newCads.length) await prisma.cadre.createMany({ data: newCads.map((c) => ({ facilityId, name: c.name, sortOrder: c.i, ...cadreDefaults(c.name) })) });
  return { departments: newDeps.length, cadres: newCads.length };
}

/** Adds exactly the departments and cadres the facility chose when it registered. The administrator can add more later. */
export async function seedChosen(facilityId: string, departments: string[], cadres: string[]) {
  const deps = [...new Map(departments.map((n) => [n.trim().toLowerCase(), n.trim()])).values()].filter(Boolean);
  const cads = [...new Map(cadres.map((n) => [n.trim().toLowerCase(), n.trim()])).values()].filter(Boolean);
  if (deps.length) await prisma.department.createMany({ data: deps.map((name) => ({ facilityId, name, runsNights: defaultRunsNights(name) })) });
  if (cads.length) await prisma.cadre.createMany({ data: cads.map((name, i) => ({ facilityId, name, sortOrder: i, ...cadreDefaults(name) })) });
  return { departments: deps.length, cadres: cads.length };
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
        onCallHoursFactor: s.onCallHoursFactor, onCallAdviceNote: s.onCallAdviceNote, minStaff: s.minStaff, minByCadre: mins, weekendMinStaff: s.weekendMinStaff, holidayMinStaff: s.holidayMinStaff, keepFull: s.keepFull, minLeads: s.minLeads, colour: s.colour, countsAsDuty: s.countsAsDuty, sortOrder: s.sortOrder,
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
export async function ensureStarterNotice(facilityId: string, facilityName: string) {
  const existing = await prisma.privacyNotice.findFirst({ where: { facilityId, publishedAt: { not: null } } });
  if (existing) return { notice: existing, starterNotice: false };
  const notice = await prisma.privacyNotice.create({
    data: { facilityId, version: "1", body: noticeTemplate(facilityName).replace(/Data protection contact:.*$/m, "Data protection contact: the facility administrator."), publishedAt: new Date(), publishedBy: "PS Tech (starter notice)" },
  });
  return { notice, starterNotice: true };
}

export async function inviteFirstAdmin(facilityId: string, facilityName: string, name: string, email: string) {
  const { starterNotice } = await ensureStarterNotice(facilityId, facilityName);
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
