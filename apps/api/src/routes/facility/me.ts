// A member of staff's own screens: Today, what is held about them, and their
// data rights. The staff id always comes from the account, never the request.
// Nothing here names another member of staff.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { caller } from "../../middleware/facilityAccess.js";
import { notifyDeciders } from "../../lib/notify.js";
import { exportMyData, exportToCsv } from "../../lib/exportMyData.js";
import { sayDay } from "../../engine/time.js";
import { insideArea, metresBetween } from "../../lib/geofence.js";
import { ALWAYS_SENT, NOTE_CATEGORIES, mutedFrom } from "../../lib/notificationPrefs.js";

export const meRouter = Router();

const DAY = 86_400_000;
const MIN = 60_000;

function needStaff(req: Parameters<typeof caller>[0]) {
  const who = caller(req);
  return who.staffId ? { ...who, staffId: who.staffId } : null;
}

const clock = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = (s: string | null) => (s ? s.slice(0, 5) : null);

// ------------------------------------------------------------- today

meRouter.get("/today", async (req, res) => {
  const who = needStaff(req);
  if (!who) return res.json({ linked: false });
  const now = Date.now();
  const d0 = Math.floor(now / DAY);
  const [rows, staff, swaps, entitlements] = await Promise.all([
    prisma.rosterAssignment.findMany({
      where: { staffId: who.staffId, facilityId: who.facilityId, roster: { status: "PUBLISHED" }, dutyDate: { gte: new Date((d0 - 14) * DAY), lte: new Date((d0 + 8) * DAY) }, shift: { countsAsDuty: true } },
      include: { shift: { select: { name: true, code: true, startTime: true, endTime: true, isOvernight: true } } },
      orderBy: { dutyDate: "asc" },
    }),
    prisma.staff.findUniqueOrThrow({ where: { id: who.staffId }, select: { cadreId: true } }),
    prisma.dutySwap.findMany({ where: { facilityId: who.facilityId, status: { in: ["REQUESTED", "ACCEPTED"] }, OR: [{ requesterStaffId: who.staffId }, { targetStaffId: who.staffId }] }, select: { id: true, status: true, requesterStaffId: true, requesterAssignmentId: true } }),
    prisma.leaveEntitlement.findMany({ where: { staffId: who.staffId, leaveYear: new Date().getUTCFullYear(), leaveType: { countsAgainstEntitlement: true, active: true } }, include: { leaveType: { select: { id: true, name: true, code: true } } } }),
  ]);

  const timed = rows.filter((r) => r.shift.startTime && r.shift.endTime).map((r) => {
    const base = Math.floor(r.dutyDate.getTime() / DAY) * DAY;
    const s = base + clock(r.shift.startTime!) * MIN;
    let e = base + clock(r.shift.endTime!) * MIN;
    if (r.shift.isOvernight || e <= s) e += DAY;
    return { id: r.id, day: Math.floor(base / DAY), date: r.dutyDate.toISOString().slice(0, 10), shift: r.shift.name, code: r.shift.code, start: hhmm(r.shift.startTime), end: hhmm(r.shift.endTime), startsAt: s, endsAt: e };
  });
  const upcoming = timed.filter((t) => t.endsAt > now);
  const next = upcoming[0];
  const onDutyNow = Boolean(next && next.startsAt <= now);
  const week = upcoming.filter((t) => t.day <= d0 + 6).map(({ id, date, shift, code, start, end }) => ({ id, date, label: sayDay(Math.floor(Date.parse(date) / DAY)), shift, code, start, end }));

  // Days in a row on duty up to today, against the facility's cycle rule for this cadre.
  const dutyDays = new Set(rows.map((r) => Math.floor(r.dutyDate.getTime() / DAY)));
  let run = 0;
  for (let d = dutyDays.has(d0) ? d0 : d0 - 1; dutyDays.has(d); d--) run++;
  const rules = await prisma.dutyCycleRule.findMany({ where: { facilityId: who.facilityId, active: true }, orderBy: { priority: "asc" } });
  const rule = rules.find((r) => r.applicableCadreIds.length === 0 || (staff.cadreId && r.applicableCadreIds.includes(staff.cadreId)));
  const offDays: number[] = [];
  for (let d = d0; d <= d0 + 8 && offDays.length < 2; d++) if (!dutyDays.has(d) && d >= (dutyDays.has(d0) ? d0 + 1 : d0)) offDays.push(d);
  const yearStart = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  const leave = await Promise.all(entitlements.map(async (e) => {
    // Partial leave comes out of the annual days.
    const ids = e.leaveType.code === "L" ? [e.leaveTypeId, ...(await prisma.leaveType.findMany({ where: { facilityId: who.facilityId, code: "PART" }, select: { id: true } })).map((t) => t.id)] : [e.leaveTypeId];
    const taken = await prisma.leaveRequest.aggregate({ where: { staffId: who.staffId, leaveTypeId: { in: ids }, status: "APPROVED", startDate: { gte: yearStart } }, _sum: { daysDeducted: true } });
    const entitled = e.daysEntitled + e.daysCarriedOver;
    return { type: e.leaveType.name, entitled, taken: taken._sum.daysDeducted ?? 0, remaining: entitled - (taken._sum.daysDeducted ?? 0) };
  }));

  res.json({
    linked: true,
    next: next && { id: next.id, date: next.date, label: sayDay(next.day), shift: next.shift, start: next.start, end: next.end, onDutyNow, minutesUntil: onDutyNow ? 0 : Math.max(0, Math.round((next.startsAt - now) / MIN)), minutesLeft: onDutyNow ? Math.round((next.endsAt - now) / MIN) : null },
    week,
    cycle: run > 0 || rule ? { dayInRun: run, runLength: rule?.consecutiveDuties ?? null, nextOffDays: offDays.map((d) => sayDay(d)) } : null,
    leave,
    swaps: swaps.map((s) => ({ id: s.id, status: s.status, mine: s.requesterStaffId === who.staffId, assignmentId: s.requesterAssignmentId })),
  });
});

// ------------------------------------------------------------- what we hold

meRouter.get("/data", async (req, res) => {
  const who = needStaff(req);
  if (!who) return res.json({ linked: false });
  const f = { staffId: who.staffId, facilityId: who.facilityId };
  const [staff, duties, leave, attendance, swaps, consents, notice, profile, requests] = await Promise.all([
    prisma.staff.findUniqueOrThrow({ where: { id: who.staffId }, include: { cadre: { select: { name: true } }, department: { select: { name: true } } } }),
    prisma.rosterAssignment.count({ where: f }),
    prisma.leaveRequest.count({ where: f }),
    prisma.attendance.count({ where: f }),
    prisma.dutySwap.count({ where: { facilityId: who.facilityId, OR: [{ requesterStaffId: who.staffId }, { targetStaffId: who.staffId }] } }),
    prisma.consentRecord.findMany({ where: f, orderBy: { grantedAt: "desc" } }),
    prisma.privacyNotice.findFirst({ where: { facilityId: who.facilityId, publishedAt: { not: null } }, orderBy: { publishedAt: "desc" }, select: { version: true, body: true, publishedAt: true } }),
    prisma.userProfile.findUnique({ where: { staffId: who.staffId }, select: { privacyNoticeVersionAccepted: true } }),
    prisma.dataSubjectRequest.findMany({ where: f, orderBy: { receivedAt: "desc" }, select: { id: true, requestType: true, status: true, receivedAt: true, dueAt: true, completedAt: true, description: true, outcomeNote: true } }),
  ]);
  const latest = new Map<string, (typeof consents)[number]>();
  for (const c of consents) if (!latest.has(c.consentType)) latest.set(c.consentType, c);
  res.json({
    linked: true,
    sections: [
      { title: "Your details", lines: [`Name: ${staff.fullName}`, `Staff number: ${staff.staffNo}`, `Cadre: ${staff.cadre?.name ?? "Not set"}`, `Department: ${staff.department?.name ?? "Not set"}`, `Telephone: ${staff.phone ?? "Not held"}`, `Email: ${staff.email ?? "Not held"}`, `Emergency contact: ${staff.emergencyContactName ? `${staff.emergencyContactName}, ${staff.emergencyContactPhone ?? "no number"}` : "Not held"}`, `Photograph: ${staff.photoUrl ? "Held, with your consent" : "Not held"}`] },
      { title: "Your duties", lines: [`${duties} duties are recorded against your name, on published and draft rosters.`] },
      { title: "Your leave", lines: [`${leave} leave requests. Only the dates, the kind of leave and the decision are kept. No reason of a medical kind is asked for or stored.`] },
      { title: "Your attendance", lines: [`${attendance} attendance records, including any corrections and the reason for them.`, `${swaps} duty swaps you took part in.`] },
    ],
    consents: ["PHOTOGRAPH", "CASE_STUDY", "REFERENCE", "MARKETING"].map((t) => {
      const c = latest.get(t);
      return { id: c?.id ?? null, type: t, active: Boolean(c?.granted && !c.withdrawnAt), grantedAt: c?.grantedAt ?? null, withdrawnAt: c?.withdrawnAt ?? null };
    }),
    privacyNotice: notice && { version: notice.version, publishedAt: notice.publishedAt, accepted: profile?.privacyNoticeVersionAccepted ?? null, body: notice.body },
    requests,
  });
});

meRouter.get("/data/export.json", async (req, res) => {
  const who = needStaff(req);
  if (!who) return res.status(404).json({ error: "not_found" });
  const data = await exportMyData(who.staffId, who.facilityId);
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "my_data_exported", entityType: "Staff", entityId: who.staffId, summary: `${who.displayName} downloaded their own data.` });
  res.setHeader("Content-Disposition", `attachment; filename="my-healthflow-data.json"`);
  res.json(data);
});

meRouter.get("/data/export.csv", async (req, res) => {
  const who = needStaff(req);
  if (!who) return res.status(404).json({ error: "not_found" });
  const data = await exportMyData(who.staffId, who.facilityId);
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "my_data_exported", entityType: "Staff", entityId: who.staffId, summary: `${who.displayName} downloaded their own data.` });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="my-healthflow-data.csv"`);
  res.send(exportToCsv(data));
});

// ------------------------------------------------------------- consents

/** Withdrawing a consent never touches the person's use of the system. */
meRouter.post("/consents/:id/withdraw", async (req, res) => {
  const who = needStaff(req);
  if (!who) return res.status(403).json({ error: "forbidden" });
  const c = await prisma.consentRecord.findFirst({ where: { id: String(req.params.id), staffId: who.staffId, facilityId: who.facilityId } });
  if (!c) return res.status(404).json({ error: "not_found" });
  if (c.withdrawnAt) return res.status(409).json({ error: "already_withdrawn", message: "That consent was already withdrawn." });
  await prisma.consentRecord.update({ where: { id: c.id }, data: { withdrawnAt: new Date() } });
  if (c.consentType === "PHOTOGRAPH") await prisma.staff.update({ where: { id: who.staffId }, data: { photoUrl: null, photoConsentId: null } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "consent_withdrawn", entityType: "ConsentRecord", entityId: c.id, summary: `${who.displayName} withdrew their consent for ${c.consentType.toLowerCase().replace(/_/g, " ")}.` });
  res.json({ ok: true });
});

// ------------------------------------------------------------- data requests

/** Days allowed to answer. Access and portability are answered by the download, at once. */
export const DSR_DAYS = { CORRECTION: 14, OBJECTION: 14, ERASURE: 30 } as const;

const dsrInput = z.object({
  requestType: z.enum(["CORRECTION", "OBJECTION", "ERASURE"]),
  description: z.string().trim().min(10, "Say what you are asking for, in a sentence.").max(1000),
});

meRouter.post("/requests", async (req, res) => {
  const who = needStaff(req);
  if (!who) return res.status(403).json({ error: "forbidden" });
  const input = parseOr400(dsrInput, req.body, res);
  if (!input) return;
  const r = await prisma.dataSubjectRequest.create({
    data: { facilityId: who.facilityId, staffId: who.staffId, requestType: input.requestType, description: input.description, dueAt: new Date(Date.now() + DSR_DAYS[input.requestType] * DAY) },
  });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "dsr_received", entityType: "DataSubjectRequest", entityId: r.id, summary: `${who.displayName} raised a ${input.requestType.toLowerCase()} request. It is due within ${DSR_DAYS[input.requestType]} days.` });
  await notifyDeciders(who.facilityId, { type: "dsr_received", title: `${who.displayName} raised a data request`, body: `A ${input.requestType.toLowerCase()} request is due within ${DSR_DAYS[input.requestType]} days.`, linkUrl: "/privacy-and-data", severity: "ACTION" });
  res.status(201).json({ request: { id: r.id, dueAt: r.dueAt } });
});

// ------------------------------------------------------------- notification preferences

async function ownProfile(req: Parameters<typeof caller>[0]) {
  const who = caller(req);
  return prisma.userProfile.findFirst({ where: { facilityId: who.facilityId, userEmail: who.email }, select: { id: true, notificationPreferences: true } });
}

function presentPrefs(prefs: unknown) {
  const muted = mutedFrom(prefs);
  return {
    categories: NOTE_CATEGORIES.map((c) => ({ key: c.key, label: c.label, description: c.description, on: !muted.includes(c.key) })),
    alwaysSent: ALWAYS_SENT,
  };
}

meRouter.get("/sms-opt-out", async (req, res) => {
  const who = caller(req);
  if (!who.staffId) return res.json({ optOut: false, hasPhone: false });
  const s = await prisma.staff.findUnique({ where: { id: who.staffId }, select: { smsOptOut: true, phone: true } });
  res.json({ optOut: s?.smsOptOut ?? false, hasPhone: Boolean(s?.phone) });
});

// A person decides about texts to their own phone. The administrator can also set it, but never overrides this.
meRouter.put("/sms-opt-out", async (req, res) => {
  const who = caller(req);
  if (!who.staffId) return res.status(404).json({ error: "not_found" });
  const input = parseOr400(z.object({ optOut: z.boolean() }), req.body, res);
  if (!input) return;
  await prisma.staff.update({ where: { id: who.staffId }, data: { smsOptOut: input.optOut } });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "sms_opt_out_changed", entityType: "Staff", entityId: who.staffId,
    summary: input.optOut ? `${who.displayName} stopped text messages to their own phone.` : `${who.displayName} allowed text messages to their own phone again.`,
  });
  res.json({ optOut: input.optOut });
});

meRouter.get("/notification-preferences", async (req, res) => {
  const me = await ownProfile(req);
  if (!me) return res.status(404).json({ error: "not_found" });
  res.json(presentPrefs(me.notificationPreferences));
});

meRouter.put("/notification-preferences", async (req, res) => {
  const who = caller(req);
  const me = await ownProfile(req);
  if (!me) return res.status(404).json({ error: "not_found" });
  const input = parseOr400(z.object({ off: z.array(z.string()).max(20) }), req.body, res);
  if (!input) return;
  const unknown = input.off.find((k) => !NOTE_CATEGORIES.some((c) => c.key === k));
  if (unknown) return res.status(400).json({ error: "invalid_input", fields: { off: "One of those is not a kind of notification you can switch off." } });
  const muted = [...new Set(input.off)];
  await prisma.userProfile.update({ where: { id: me.id }, data: { notificationPreferences: { muted } } });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "notification_preferences_changed", entityType: "UserProfile", entityId: me.id,
    summary: muted.length
      ? `${who.displayName} switched off notifications about ${muted.map((k) => NOTE_CATEGORIES.find((c) => c.key === k)!.label.toLowerCase()).join(", ")}.`
      : `${who.displayName} switched on all optional notifications.`,
  });
  res.json(presentPrefs({ muted }));
});

// ------------------------------------------------------------- clock in and out

type Db = Pick<typeof prisma, "clockEvent" | "rosterAssignment" | "attendance">;
const clockState = async (facilityId: string, staffId: string, db: Db = prisma) => {
  const last = await db.clockEvent.findFirst({ where: { facilityId, staffId }, orderBy: { at: "desc" } });
  return { state: last?.kind === "IN" ? ("IN" as const) : ("OUT" as const), lastAt: last?.at ?? null };
};

meRouter.get("/clock", async (req, res) => {
  const who = needStaff(req);
  if (!who) return res.json({ linked: false });
  const f = await prisma.facility.findUniqueOrThrow({ where: { id: who.facilityId }, select: { geoLat: true, geoLng: true, geoRadiusM: true } });
  const enabled = f.geoLat !== null && f.geoLng !== null && f.geoRadiusM !== null;
  res.json({ linked: true, enabled, ...(enabled ? await clockState(who.facilityId, who.staffId) : {}) });
});

const clockInput = z.object({
  kind: z.enum(["IN", "OUT"]),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).nullish(),
});

meRouter.post("/clock", async (req, res) => {
  const who = needStaff(req);
  if (!who) return res.status(403).json({ error: "not_linked", message: "Your login is not linked to a staff record." });
  const body = parseOr400(clockInput, req.body, res);
  if (!body) return;
  const f = await prisma.facility.findUniqueOrThrow({ where: { id: who.facilityId }, select: { geoLat: true, geoLng: true, geoRadiusM: true } });
  if (f.geoLat === null || f.geoLng === null || f.geoRadiusM === null) return res.status(409).json({ error: "geofence_off", message: "Your facility has not turned on clocking in and out." });
  const [lat0, lng0, radius0] = [f.geoLat, f.geoLng, f.geoRadiusM];
  // One tap at a time per person: a second tap that arrives together waits, then sees the first and is turned away,
  // so there is never a double clock-in or a second attendance record.
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${who.staffId}))`;
    const now = await clockState(who.facilityId, who.staffId, tx);
    if (body.kind === "IN" && now.state === "IN") return { status: 409, body: { error: "already_in", message: "You are already clocked in." } };
    if (body.kind === "OUT" && now.state === "OUT") return { status: 409, body: { error: "already_out", message: "You are not clocked in." } };
    const distance = Math.round(metresBetween(lat0, lng0, body.lat, body.lng));
    if (!insideArea(distance, radius0, body.accuracy)) {
      return { status: 403, body: { error: "outside_area", message: `You are not at the facility. Move closer and try again.` } };
    }
    await tx.clockEvent.create({ data: { facilityId: who.facilityId, staffId: who.staffId, kind: body.kind, distanceM: distance } });
  
    // Clocking in marks the person present, or late, against today's published duty, or against last night's
    // night duty when it is still running (a night shift clocked into after midnight). A record is made once.
    if (body.kind === "IN") {
      const at = new Date();
      const today = new Date(Math.floor(at.getTime() / DAY) * DAY);
      const nowMin = at.getUTCHours() * 60 + at.getUTCMinutes();
      const pick = { where: { staffId: who.staffId, facilityId: who.facilityId, roster: { status: "PUBLISHED" as const }, shift: { countsAsDuty: true } }, include: { shift: { select: { startTime: true, endTime: true } } } };
      let duty = await tx.rosterAssignment.findFirst({ ...pick, where: { ...pick.where, dutyDate: today } });
      let startedYesterday = false;
      if (!duty) {
        const last = await tx.rosterAssignment.findFirst({ ...pick, where: { ...pick.where, dutyDate: new Date(today.getTime() - DAY) } });
        const s0 = last?.shift.startTime ? clock(last.shift.startTime) : null;
        const e0 = last?.shift.endTime ? clock(last.shift.endTime) : null;
        if (last && s0 !== null && e0 !== null && e0 <= s0 && nowMin < e0) {
          duty = last;
          startedYesterday = true;
        }
      }
      if (duty && !(await tx.attendance.findFirst({ where: { staffId: who.staffId, rosterAssignmentId: duty.id }, select: { id: true } }))) {
        const start = duty.shift.startTime ? clock(duty.shift.startTime) : null;
        const late = start === null ? 0 : Math.max(0, startedYesterday ? nowMin + 24 * 60 - start : nowMin - start);
        await tx.attendance
          .create({
            data: {
              facilityId: who.facilityId, staffId: who.staffId, rosterId: duty.rosterId, rosterAssignmentId: duty.id, dutyDate: startedYesterday ? new Date(today.getTime() - DAY) : today, shiftId: duty.shiftId,
              status: late > 15 ? "LATE" : "PRESENT", minutesLate: late > 15 ? late : null, recordedBy: "Clocked in", note: "Clocked in at the facility.",
            },
          })
      }
    }
    return null;
  });
  if (outcome) return res.status(outcome.status).json(outcome.body);
  res.status(201).json({ ...(await clockState(who.facilityId, who.staffId)) });
});
