// Emergency deployments. A national exercise or an emergency can take clinical
// staff out of their unit for days. Each person given one shift to work for the
// dates; they come off the monthly roster, colleagues fill in, and the roster
// engine is not touched: this reuses the same mending that leave uses. The
// emergency roster is shared with the people on it and is never published.
// They stay "return due" until the in-charge confirms they are back, and then
// the rest of the month is re-planned with them in.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { notifyDeciders, notifyStaff } from "../../lib/notify.js";
import { parseOr400 } from "../../lib/validate.js";
import { mendRosters, type RosterMend } from "../../lib/leaveRoster.js";
import { todayDay } from "../../lib/leaveWindow.js";
import { sayDay } from "../../engine/time.js";
import { allowRoles, caller, ADMIN_ROLES, READ_ROLES } from "../../middleware/facilityAccess.js";

export const deploymentsRouter = Router();

const DAY = 86_400_000;
const dayOf = (d: Date) => Math.floor(d.getTime() / DAY);
const dateOf = (n: number) => new Date(n * DAY);
const iso = (n: number) => dateOf(n).toISOString().slice(0, 10);

const isoDate = (label: string) =>
  z.string({ required_error: `${label} is required.` }).trim().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) === v, `${label} must be a real date.`);

const createInput = z.object({
  name: z.string().trim().min(3, "Give the exercise a name.").max(120),
  notes: z.string().trim().max(500).optional(),
  startDate: isoDate("Start date"),
  endDate: isoDate("End date"),
  members: z.array(z.object({ staffId: z.string().min(1), shiftId: z.string().min(1) })).min(1, "Choose at least one person.").max(300),
});

const summary = (m: RosterMend[]) => ({
  rosters: m.length,
  removed: m.reduce((n, x) => n + x.removed, 0),
  filled: m.reduce((n, x) => n + x.filled.length, 0),
  unfilled: m.flatMap((x) => x.unfilled),
});

/** All deployments, open ones first, with who is on them and who is still to be confirmed back. */
deploymentsRouter.get("/", allowRoles(...READ_ROLES), async (req, res) => {
  const who = caller(req);
  const rows = await prisma.deployment.findMany({
    where: { facilityId: who.facilityId },
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
    take: 50,
    include: { members: { include: { staff: { select: { fullName: true, cadre: { select: { name: true } }, department: { select: { name: true } } } }, shift: { select: { name: true } } } } },
  });
  const today = todayDay();
  res.json({
    deployments: rows.map((d) => ({
      id: d.id, name: d.name, notes: d.notes, status: d.status, startDate: iso(dayOf(d.startDate)), endDate: iso(dayOf(d.endDate)), createdAt: d.createdAt,
      dueBack: d.status === "ACTIVE" && today > dayOf(d.endDate),
      members: d.members.map((m) => ({ id: m.id, staffId: m.staffId, name: m.staff.fullName, cadre: m.staff.cadre?.name ?? null, department: m.staff.department?.name ?? null, shift: m.shift.name, returnedOn: m.returnedOn ? iso(dayOf(m.returnedOn)) : null })),
    })),
  });
});

/** The emergency roster: each person's shift on each day. Not a published roster; it is shared with the people on it. */
deploymentsRouter.get("/:id/roster", allowRoles(...READ_ROLES), async (req, res) => {
  const who = caller(req);
  const d = await prisma.deployment.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId }, include: { members: { include: { staff: { select: { fullName: true, staffNo: true } }, shift: { select: { name: true, startTime: true, endTime: true } } } } } });
  if (!d) return res.status(404).json({ error: "not_found" });
  const days: string[] = [];
  for (let n = dayOf(d.startDate); n <= dayOf(d.endDate); n++) days.push(iso(n));
  res.json({
    name: d.name, startDate: days[0], endDate: days[days.length - 1], days,
    rows: d.members.map((m) => ({ name: m.staff.fullName, staffNo: m.staff.staffNo, shift: m.shift.name, from: m.shift.startTime, to: m.shift.endTime })).sort((a, b) => a.shift.localeCompare(b.shift) || a.name.localeCompare(b.name)),
  });
});

deploymentsRouter.post("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(createInput, req.body, res);
  if (!input) return;
  const start = dayOf(new Date(`${input.startDate}T00:00:00.000Z`));
  const end = dayOf(new Date(`${input.endDate}T00:00:00.000Z`));
  const today = todayDay();
  const fields: Record<string, string> = {};
  if (end < start) fields.endDate = "The end date cannot be before the start date.";
  else if (end - start > 120) fields.endDate = "An exercise longer than 120 days needs to be split in two.";
  if (start < today) fields.startDate = "Start today or later. Duties before today are already done.";
  const ids = [...new Set(input.members.map((m) => m.staffId))];
  if (ids.length !== input.members.length) fields.members = "A person is listed twice.";
  if (Object.keys(fields).length) return res.status(400).json({ error: "invalid_input", fields });

  const [staff, shifts, busy] = await Promise.all([
    prisma.staff.findMany({ where: { id: { in: ids }, facilityId: who.facilityId, status: "ACTIVE" }, select: { id: true, fullName: true } }),
    prisma.shift.findMany({ where: { id: { in: input.members.map((m) => m.shiftId) }, facilityId: who.facilityId, countsAsDuty: true, isOnCall: false }, select: { id: true, name: true } }),
    prisma.deploymentMember.findMany({ where: { staffId: { in: ids }, returnedOn: null, deployment: { facilityId: who.facilityId } }, select: { staff: { select: { fullName: true } } } }),
  ]);
  if (staff.length !== ids.length) return res.status(400).json({ error: "invalid_input", fields: { members: "Everyone must be an active member of staff here." } });
  if (new Set(input.members.map((m) => m.shiftId)).size !== shifts.length) return res.status(400).json({ error: "invalid_input", fields: { members: "Give each person a day shift, not an off day or on call." } });
  if (busy.length) return res.status(409).json({ error: "already_deployed", message: `${busy.slice(0, 3).map((b) => b.staff.fullName).join(", ")}${busy.length > 3 ? ` and ${busy.length - 3} more` : ""} ${busy.length === 1 ? "is" : "are"} already on a deployment that is not closed. Mark them back first.` });

  const dep = await prisma.deployment.create({
    data: {
      facilityId: who.facilityId, name: input.name, notes: input.notes || null, startDate: dateOf(start), endDate: dateOf(end), createdBy: who.email,
      members: { create: input.members.map((m) => ({ staffId: m.staffId, shiftId: m.shiftId })) },
    },
  });
  const by = { email: who.email, displayName: who.displayName };
  // Take the people off the monthly roster for the dates and fill in. Published rosters stay published.
  const mended = await mendRosters(who.facilityId, {
    absentIds: ids, from: start, to: end, why: `${input.name} has taken ${ids.length} ${ids.length === 1 ? "person" : "people"} off the usual roster`, versionNote: `Before ${input.name} took people off the roster`,
    auditAction: "roster_mended_for_deployment", gapSubject: `The ${input.name} deployment`,
    auditLead: (n, month) => `${input.name} took ${ids.length} ${ids.length === 1 ? "person" : "people"} off the usual roster, removing ${n} ${n === 1 ? "duty" : "duties"} from the ${month} roster.`,
  }, by);

  const shiftName = new Map(shifts.map((s) => [s.id, s.name]));
  for (const m of input.members) {
    await notifyStaff(who.facilityId, m.staffId, {
      type: "deployment_assigned", title: `You are on the ${input.name} emergency roster`,
      body: `${shiftName.get(m.shiftId) ?? "Your shift"} every day from ${sayDay(start)} to ${sayDay(end)}. You are off the usual roster until your in-charge confirms you are back.`, linkUrl: "/deployments", severity: "ACTION",
    });
  }
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "deployment_created", entityType: "Deployment", entityId: dep.id, summary: `${who.displayName} set up the ${input.name} deployment for ${ids.length} ${ids.length === 1 ? "person" : "people"}, ${sayDay(start)} to ${sayDay(end)}.` });
  await notifyDeciders(who.facilityId, { type: "deployment_created", title: `${input.name}: ${ids.length} off the usual roster`, body: `They return to the usual roster only when you confirm them back under Return due.`, linkUrl: "/returns", severity: "INFO" }, who.email);
  res.status(201).json({ id: dep.id, roster: summary(mended) });
});

const backInput = z.object({ memberIds: z.array(z.string().min(1)).min(1, "Choose who is back.").max(300), date: isoDate("Date").optional() });

/** The in-charge confirms people are back. The rest of the month is re-planned with them in. */
deploymentsRouter.post("/:id/back", allowRoles(...READ_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(backInput, req.body, res);
  if (!input) return;
  const dep = await prisma.deployment.findFirst({ where: { id: String(req.params.id), facilityId: who.facilityId }, include: { members: { include: { staff: { select: { fullName: true } } } } } });
  if (!dep) return res.status(404).json({ error: "not_found" });
  const today = todayDay();
  const back = input.date ? dayOf(new Date(`${input.date}T00:00:00.000Z`)) : today;
  if (back <= dayOf(dep.startDate)) return res.status(400).json({ error: "invalid_input", fields: { date: "They cannot be back on or before the first day of the deployment." } });
  if (back > today + 14) return res.status(400).json({ error: "invalid_input", fields: { date: "Choose a date within the next two weeks." } });
  const chosen = dep.members.filter((m) => input.memberIds.includes(m.id) && !m.returnedOn);
  if (chosen.length === 0) return res.status(409).json({ error: "none_open", message: "Nobody chosen is still waiting to be confirmed back." });

  await prisma.$transaction(async (tx) => {
    await tx.deploymentMember.updateMany({ where: { id: { in: chosen.map((m) => m.id) } }, data: { returnedOn: dateOf(back), returnedBy: who.email } });
    const left = await tx.deploymentMember.count({ where: { deploymentId: dep.id, returnedOn: null } });
    if (left === 0) await tx.deployment.update({ where: { id: dep.id }, data: { status: "CLOSED", closedAt: new Date() } });
  });

  const by = { email: who.email, displayName: who.displayName };
  const ids = chosen.map((m) => m.staffId);
  const names = `${chosen.length} ${chosen.length === 1 ? "person" : "people"}`;
  // Rest days between the end of the exercise and their first day back stay free of duty.
  const restFrom = Math.max(dayOf(dep.endDate) + 1, today);
  const rest = back - 1 >= restFrom
    ? await mendRosters(who.facilityId, { absentIds: ids, from: restFrom, to: back - 1, why: `${names} from ${dep.name} are resting before they return`, versionNote: `Before rest days after ${dep.name}`, auditAction: "roster_mended_for_deployment", gapSubject: `Rest days after ${dep.name}`, auditLead: (n, month) => `Rest days after ${dep.name} removed ${n} ${n === 1 ? "duty" : "duties"} from the ${month} roster.` }, by)
    : [];
  // From their first day back the rest of the month is planned again, with them in.
  const monthEnd = Math.floor(Date.UTC(dateOf(back).getUTCFullYear(), dateOf(back).getUTCMonth() + 1, 0) / DAY);
  const replanFrom = Math.max(back, today);
  const replanned = replanFrom <= monthEnd
    ? await mendRosters(who.facilityId, { absentIds: [], replan: true, from: replanFrom, to: monthEnd, why: `${names} came back from ${dep.name}`, versionNote: `Before ${names} returned from ${dep.name}`, auditAction: "roster_replanned_after_return", gapSubject: `The re-plan after ${dep.name}`, auditLead: (n, month) => `${names} came back from ${dep.name}, so ${n} ${n === 1 ? "duty" : "duties"} in the ${month} roster were planned again.` }, by)
    : [];

  for (const m of chosen) {
    await notifyStaff(who.facilityId, m.staffId, { type: "deployment_back", title: "You are back on the usual roster", body: `Your first day back is ${sayDay(back)}. Check the roster for your duties.`, linkUrl: "/roster", severity: "ACTION" });
  }
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "deployment_return_confirmed", entityType: "Deployment", entityId: dep.id, summary: `${who.displayName} confirmed ${chosen.map((m) => m.staff.fullName).slice(0, 4).join(", ")}${chosen.length > 4 ? ` and ${chosen.length - 4} more` : ""} back from ${dep.name}, first day back ${sayDay(back)}.` });
  res.json({ confirmed: chosen.length, rest: summary(rest), replan: summary(replanned) });
});
