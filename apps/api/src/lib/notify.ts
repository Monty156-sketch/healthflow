// In-app notifications. Plain sentences, one recipient each. Email is not
// sent from here; the notification list is the record.
import type { NotificationSeverity, Role } from "@healthflow/db";
import { prisma } from "./prisma.js";
import { categoryOf, mutedFrom } from "./notificationPrefs.js";
import { textStaff } from "./sms.js";

/** The notices worth a text: the ones that change a person's duties or ask them for something. */
const SMS_TYPES = new Set(["roster_published", "duty_moved", "reinstated", "cover_asked", "cover_arranged", "swap_requested", "swap_decided", "leave_decided", "return_due", "deployment_assigned", "credential_expiry"]);

export interface NoteContent {
  type: string;
  title: string;
  body: string;
  linkUrl?: string;
  severity?: NotificationSeverity;
}

const DECIDER_ROLES: Role[] = ["FACILITY_ADMIN", "ROSTER_MANAGER", "SUPERVISOR"];

async function send(facilityId: string, everyone: { email: string; staffId: string | null }[], n: NoteContent) {
  // People can switch off a few kinds of notification; the rest always arrive.
  let people = everyone;
  const category = categoryOf(n.type);
  if (category && everyone.length) {
    const prefs = await prisma.userProfile.findMany({ where: { facilityId, userEmail: { in: everyone.map((p) => p.email) } }, select: { userEmail: true, notificationPreferences: true } });
    const off = new Set(prefs.filter((p) => mutedFrom(p.notificationPreferences).includes(category)).map((p) => p.userEmail));
    people = everyone.filter((p) => !off.has(p.email));
  }
  if (people.length === 0) return;
  await prisma.notification.createMany({
    data: people.map((p) => ({
      facilityId, recipientEmail: p.email, recipientStaffId: p.staffId, type: n.type, title: n.title, body: n.body, linkUrl: n.linkUrl ?? null, severity: n.severity ?? "INFO",
    })),
  });
  if (SMS_TYPES.has(n.type)) {
    await Promise.allSettled(people.filter((p) => p.staffId).map((p) => textStaff(facilityId, p.staffId!, n.type, n.body)));
  }
}

/** Everyone who runs rosters here: facility admins, roster managers and supervisors. */
export async function notifyDeciders(facilityId: string, n: NoteContent, exceptEmail?: string) {
  const users = await prisma.userProfile.findMany({ where: { facilityId, active: true, role: { in: DECIDER_ROLES } }, select: { userEmail: true, staffId: true } });
  await send(facilityId, users.filter((u) => u.userEmail !== exceptEmail).map((u) => ({ email: u.userEmail, staffId: u.staffId })), n);
}

/** The account linked to one staff record, if they have one. */
export async function notifyStaff(facilityId: string, staffId: string, n: NoteContent) {
  const user = await prisma.userProfile.findFirst({ where: { facilityId, staffId, active: true }, select: { userEmail: true, staffId: true } });
  if (user) return send(facilityId, [{ email: user.userEmail, staffId: user.staffId }], n);
  // A member of staff with no login still gets the notices that change their duties, by text, if they have a number and have not opted out.
  if (SMS_TYPES.has(n.type)) await textStaff(facilityId, staffId, n.type, n.body);
}

/** The facility administrators only. */
export async function notifyAdmins(facilityId: string, n: NoteContent) {
  const users = await prisma.userProfile.findMany({ where: { facilityId, active: true, role: "FACILITY_ADMIN" }, select: { userEmail: true, staffId: true } });
  await send(facilityId, users.map((u) => ({ email: u.userEmail, staffId: u.staffId })), n);
}

/** The facility administrators, plus the in-charges of one ward when a ward is given. */
export async function notifyWard(facilityId: string, departmentId: string | null, n: NoteContent) {
  // A ward with an in-charge decides for its own staff, so the administrator is not told. With no in-charge yet, the administrator is.
  const managers = departmentId
    ? await prisma.userProfile.findMany({ where: { facilityId, active: true, role: { in: ["ROSTER_MANAGER", "SUPERVISOR"] as Role[] }, departmentId }, select: { userEmail: true, staffId: true } })
    : [];
  const users = managers.length
    ? managers
    : await prisma.userProfile.findMany({ where: { facilityId, active: true, role: "FACILITY_ADMIN" }, select: { userEmail: true, staffId: true } });
  await send(facilityId, users.map((u) => ({ email: u.userEmail, staffId: u.staffId })), n);
}
