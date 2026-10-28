// Coverage: dates against shifts, staffed against required. The question is
// "are we covered this week", so a seven-day strip comes first.
import { demandOn, hasDemand } from "../../engine/demand.js";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { allowRoles, caller, READ_ROLES } from "../../middleware/facilityAccess.js";
import { rostersForMonth } from "../../lib/reportStats.js";
import { evidenceFor } from "../../lib/evidence.js";
import { coverageFor } from "../district.js";
import { csvCell } from "../../lib/csvSafe.js";

export const coverageRouter = Router();
coverageRouter.use(allowRoles(...READ_ROLES));

const DAY = 86_400_000;
const month = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month.") });

type State = "OK" | "SHORT" | "CADRE";

coverageRouter.get("/", async (req, res) => {
  const who = caller(req);
  const q = month.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "invalid_input", message: "Choose a month." });
  const [y, m] = q.data.month.split("-").map(Number);
  const today = Math.floor(Date.now() / DAY);
  const strip = await coverageFor(who.facilityId, today, 7);
  // A hospital has a roster per ward and each ward has its own minimums, so coverage is read one ward at a time.
  const askedWard = who.departmentId ?? (typeof req.query.ward === "string" && req.query.ward ? req.query.ward : null);
  const all = await rostersForMonth(who.facilityId, y, m);
  const wards = all.filter((r) => r.department).map((r) => ({ id: r.departmentId!, name: r.department!.name }));
  const roster = (askedWard ? all.find((r) => r.departmentId === askedWard) : all[0]) ?? null;
  if (!roster) return res.json({ month: q.data.month, strip, roster: null, wards, ward: askedWard, shifts: [], days: [], unfilled: [] });
  const demand = roster.departmentId ? await prisma.shiftDemand.findMany({ where: { departmentId: roster.departmentId } }) : [];
  const [shiftRows, cadres, assigned] = await Promise.all([
    prisma.shift.findMany({ where: { facilityId: who.facilityId, active: true, countsAsDuty: true, isOnCall: false }, orderBy: { sortOrder: "asc" } }),
    prisma.cadre.findMany({ where: { facilityId: who.facilityId }, select: { id: true, name: true } }),
    prisma.rosterAssignment.findMany({ where: { rosterId: roster.id }, select: { shiftId: true, dutyDate: true, staff: { select: { cadreId: true } } } }),
  ]);
  const shifts = shiftRows.map((s) => {
    const src = demand.find((d) => d.shiftId === s.id) ?? s;
    return {
      ...s, minStaff: src.minStaff, minByCadre: (src.minByCadre ?? {}) as Record<string, number>, weekendMinStaff: src.weekendMinStaff, holidayMinStaff: src.holidayMinStaff,
      weekendMinByCadre: (src.weekendMinByCadre ?? null) as Record<string, number> | null, holidayMinByCadre: (src.holidayMinByCadre ?? null) as Record<string, number> | null,
    };
  });
  const needy = shifts.filter((s) => hasDemand(s));
  const holidayRows = await prisma.publicHoliday.findMany({ where: { OR: [{ facilityId: who.facilityId }, { facilityId: null }], date: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) } }, select: { date: true } });
  const holidays = new Set(holidayRows.map((h) => Math.floor(h.date.getTime() / DAY)));
  const cadreName = new Map(cadres.map((c) => [c.id, c.name]));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = Array.from({ length: last }, (_, i) => {
    const date = new Date(Date.UTC(y, m - 1, i + 1));
    const cells = needy.map((s) => {
      const here = assigned.filter((a) => a.shiftId === s.id && a.dutyDate.getTime() === date.getTime());
      const need = demandOn(s, Math.floor(date.getTime() / DAY), holidays);
      const byCadre = Object.entries(need.minByCadre);
      const required = Math.max(need.minStaff, byCadre.reduce((n, [, v]) => n + v, 0));
      const shortCadres = byCadre.filter(([cid, v]) => here.filter((a) => a.staff.cadreId === cid).length < v).map(([cid]) => cadreName.get(cid) ?? "a cadre");
      const state: State = here.length < need.minStaff ? "SHORT" : shortCadres.length ? "CADRE" : "OK";
      return { shiftId: s.id, staffed: here.length, required, state, cadres: shortCadres };
    });
    return { date: date.toISOString().slice(0, 10), cells };
  });
  const unfilled = days.flatMap((d) => d.cells.filter((c) => c.state !== "OK").map((c) => ({ date: d.date, shiftId: c.shiftId, shift: needy.find((s) => s.id === c.shiftId)!.name, staffed: c.staffed, required: c.required, state: c.state, cadres: c.cadres })));
  res.json({ month: q.data.month, strip, roster: { id: roster.id, status: roster.status }, wards, ward: roster.departmentId, shifts: needy.map((s) => ({ id: s.id, name: s.name, code: s.code })), days, unfilled });
});

// ------------------------------------------------------------- evidence

const EVIDENCE_NOTE = "These figures describe this facility only and are not published or shared without the facility's written consent.";

coverageRouter.get("/evidence", async (req, res) => {
  const who = caller(req);
  const q = month.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "invalid_input", message: "Choose a month." });
  const [y, m] = q.data.month.split("-").map(Number);
  res.json({ note: EVIDENCE_NOTE, ...(await evidenceFor(who.facilityId, y, m)) });
});


/** The identifiable version needs the exporter to confirm the facility's written consent exists. */
coverageRouter.get("/evidence.csv", async (req, res) => {
  const who = caller(req);
  const q = month.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "invalid_input", message: "Choose a month." });
  const identifiable = req.query.consent === "confirmed";
  if (req.query.consent !== undefined && !identifiable) return res.status(400).json({ error: "consent_required", message: "Confirm that the facility has given written consent before an identifiable version is made." });
  const [y, m] = q.data.month.split("-").map(Number);
  const data = await evidenceFor(who.facilityId, y, m);
  const fac = await prisma.facility.findUniqueOrThrow({ where: { id: who.facilityId }, select: { name: true } });
  const rows = [
    ["Measure", ...data.months.map((x) => x.month)],
    ["Roster preparation seconds", ...data.months.map((x) => x.prepSeconds ?? "")],
    ["Conflicts detected before publication", ...data.months.map((x) => x.conflictsDetected)],
    ["Blocking findings (statutory breaches caught)", ...data.months.map((x) => x.blockingFound)],
    ["Overrides granted", ...data.months.map((x) => x.overridden)],
    ["Unfilled shifts still open", ...data.months.map((x) => x.unfilledOpen)],
    ["Amendments after publication", ...data.months.map((x) => x.amendments)],
    ["Attendance completeness percent", ...data.months.map((x) => x.attendanceCompletenessPercent ?? "")],
    ["Swaps approved", ...data.months.map((x) => x.swaps.APPROVED ?? 0)],
    ["Swaps requested (all)", ...data.months.map((x) => Object.values(x.swaps).reduce((a, b) => a + b, 0))],
  ];
  if (identifiable) await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "evidence_exported_identifiable", entityType: "Facility", entityId: who.facilityId, summary: `${who.displayName} confirmed the facility's written consent and exported an identifiable evidence report.` });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="evidence-${q.data.month}${identifiable ? "" : "-anonymous"}.csv"`);
  res.send([`${identifiable ? fac.name : "A health facility"},evidence report to ${q.data.month}`, EVIDENCE_NOTE, "", ...rows.map((r) => r.map(csvCell).join(","))].join("\n"));
});
