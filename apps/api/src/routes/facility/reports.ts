// Reports (Part 7). Compliance is for the people who run the roster. Fairness
// is for everyone, but staff see only themselves against their cadre's
// average, never a list of colleagues.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { allowRoles, caller, READ_ROLES } from "../../middleware/facilityAccess.js";
import { complianceForRosters, fairnessFigures, rostersForMonth } from "../../lib/reportStats.js";
import { compliancePdf } from "../../lib/compliancePdf.js";

export const reportsRouter = Router();

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const monthInput = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month."), ward: z.string().optional() });
const title = (y: number, m: number) => `${MONTHS[m - 1]} ${y}`;
const csvCell = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** A ward manager sees their own ward whatever they ask for; others can narrow to one ward or read the whole hospital. */
const wardOf = (who: { departmentId?: string | null }, asked?: string) => who.departmentId ?? (asked || null);

async function compliance(facilityId: string, month: string, ward: string | null) {
  const [y, m] = month.split("-").map(Number);
  const rosters = await rostersForMonth(facilityId, y, m, ward);
  if (!rosters.length) return null;
  const RANK = ["DRAFT", "GENERATED", "UNDER_REVIEW", "APPROVED", "PUBLISHED", "ARCHIVED"];
  const furthest = [...rosters].sort((a, b) => RANK.indexOf(a.status) - RANK.indexOf(b.status))[0];
  const roster = { id: furthest.id, status: furthest.status, version: Math.max(...rosters.map((r) => r.version)) };
  return {
    roster, year: y, monthNumber: m, ...(await complianceForRosters(facilityId, rosters, y, m)),
    wards: rosters.filter((r) => r.department).map((r) => ({ id: r.departmentId!, name: r.department!.name, status: r.status })),
    wardName: ward ? rosters[0].department?.name ?? null : null,
  };
}

reportsRouter.get("/compliance", allowRoles(...READ_ROLES), async (req, res) => {
  const who = caller(req);
  const q = monthInput.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "invalid_input", message: "Choose a month." });
  const r = await compliance(who.facilityId, q.data.month, wardOf(who, q.data.ward));
  if (!r) return res.json({ month: q.data.month, roster: null });
  res.json({
    month: q.data.month, title: title(r.year, r.monthNumber), roster: { id: r.roster.id, status: r.roster.status, version: r.roster.version },
    rows: r.rows, overrides: r.overrides, summary: r.summary, normalWeek: r.normalWeek, wards: r.wards, ward: r.wardName,
  });
});

reportsRouter.get("/compliance.pdf", allowRoles(...READ_ROLES), async (req, res) => {
  const who = caller(req);
  const q = monthInput.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "invalid_input", message: "Choose a month." });
  const r = await compliance(who.facilityId, q.data.month, wardOf(who, q.data.ward));
  if (!r) return res.status(404).json({ error: "not_found", message: "There is no roster for that month." });
  const facility = await prisma.facility.findUniqueOrThrow({ where: { id: who.facilityId }, select: { name: true } });
  const buf = await compliancePdf({
    facilityName: facility.name, title: `${title(r.year, r.monthNumber)}${r.wardName ? `, ${r.wardName}` : r.wards.length ? ", all wards" : ""}`, rosterStatus: r.roster.status.replace("_", " "), version: r.roster.version,
    generatedOn: new Date().toISOString().slice(0, 10), generatedBy: who.displayName, rows: r.rows, overrides: r.overrides, summary: r.summary, normalWeek: r.normalWeek,
  });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "compliance_report_downloaded", entityType: "Roster", entityId: r.roster.id, summary: `${who.displayName} downloaded the ${title(r.year, r.monthNumber)} compliance report as a PDF.` });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="compliance-${q.data.month}.pdf"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(buf);
});

reportsRouter.get("/compliance.csv", allowRoles(...READ_ROLES), async (req, res) => {
  const who = caller(req);
  const q = monthInput.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "invalid_input", message: "Choose a month." });
  const r = await compliance(who.facilityId, q.data.month, wardOf(who, q.data.ward));
  if (!r) return res.status(404).json({ error: "not_found", message: "There is no roster for that month." });
  const lines = [
    [...(r.wards.length ? ["Ward"] : []), "Staff no", "Name", "Cadre", "Hours", "Duty days", "Nights", "Highest week hours", `Hours over ${r.normalWeek} a week`, "Longest rest hours", "Rest breaches"],
    ...r.rows.map((x) => [...(r.wards.length ? [x.ward ?? ""] : []), x.staffNo, x.name, x.cadre, x.hours, x.dutyDays, x.nights, x.highestWeekHours, x.hoursAboveNormal, x.longestRestHours, x.restBreaches]),
    [],
    ["Overrides"],
    ["Rule", "Staff", "What", "Reason", "Approved by", "Date"],
    ...r.overrides.map((o) => [o.rule, o.staff, o.message, o.reason, o.approver, o.date]),
  ];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="compliance-${q.data.month}.csv"`);
  res.setHeader("Cache-Control", "no-store");
  res.send("﻿" + lines.map((l) => l.map(csvCell).join(",")).join("\r\n"));
});

// ------------------------------------------------------------- fairness

reportsRouter.get("/fairness", async (req, res) => {
  const who = caller(req);
  const q = monthInput.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "invalid_input", message: "Choose a month." });
  const [y, m] = q.data.month.split("-").map(Number);
  const f = await fairnessFigures(who.facilityId, y, m, wardOf(who, q.data.ward));
  const manager = READ_ROLES.includes(who.role);
  const base = { month: q.data.month, period: f.period, monthsCovered: f.monthsCovered, monthsAsked: f.monthsAsked, manager };
  if (manager) return res.json({ ...base, cadres: f.byCadre.map((c) => ({ cadre: c.cadre, means: c.means, sentence: c.sentence, people: c.people })) });
  // A member of staff sees themselves against the average for their cadre, and no one else.
  if (!who.staffId) return res.json({ ...base, mine: null });
  const cadreId = f.cadreOf.get(who.staffId);
  const group = f.byCadre.find((c) => c.cadreId === (cadreId ?? null));
  const me = group?.people.find((p) => p.staffId === who.staffId);
  res.json({ ...base, mine: me && group ? { cadre: group.cadre, means: group.means, me: { nights: me.nights, weekends: me.weekends, holidays: me.holidays, duties: me.duties, hours: me.hours }, peers: group.people.length } : null });
});

reportsRouter.get("/fairness.csv", allowRoles(...READ_ROLES), async (req, res) => {
  const who = caller(req);
  const q = monthInput.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "invalid_input", message: "Choose a month." });
  const [y, m] = q.data.month.split("-").map(Number);
  const f = await fairnessFigures(who.facilityId, y, m, wardOf(who, q.data.ward));
  const lines: (string | number | null)[][] = [["Cadre", "Name", "Night duties", "Weekend duties", "Holiday duties", "Total duties", "Hours", "Duties against cadre mean"]];
  for (const c of f.byCadre) for (const p of c.people) lines.push([c.cadre, p.name, p.nights, p.weekends, p.holidays, p.duties, p.hours, Math.round((p.duties - c.means.duties) * 10) / 10]);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="fairness-${q.data.month}.csv"`);
  res.setHeader("Cache-Control", "no-store");
  res.send("﻿" + lines.map((l) => l.map(csvCell).join(",")).join("\r\n"));
});
