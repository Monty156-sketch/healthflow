// The district's view: read only, and only of what each facility has granted.
// A facility with no grant is not here at all, not even as a locked row. Every
// response says which grants it was read under, and every read is written to
// the facility's own audit log.
import { demandOn, hasDemand } from "../engine/demand.js";
import { Router, type Request } from "express";
import { prisma } from "../lib/prisma.js";
import { agencyOf, officesUnder, auditDistrictRead, grantedFor, readingUnder, suspendedFor, type Granted } from "../lib/district.js";
import { requireAuth } from "../middleware/auth.js";
import { requireDistrictOfficer } from "../middleware/districtAccess.js";
import { sayDay } from "../engine/time.js";
import { mean, scorecard, type Row } from "../lib/scorecard.js";
import { csvCell } from "../lib/csvSafe.js";

export const districtRouter = Router();
districtRouter.use(requireAuth, requireDistrictOfficer);

// Every screen's "reading" note also names the facilities that are suspended, with the reason, so their absence is explained.
districtRouter.use(async (req, res, next) => {
  try {
    const suspended = await suspendedFor(req.district!.districtId);
    const send = res.json.bind(res);
    res.json = (body: unknown) => send(body && typeof body === "object" && "reading" in body ? { ...(body as object), reading: { ...(body as { reading: object }).reading, suspended } } : body);
    next();
  } catch (e) { next(e); }
});

const DAY = 86_400_000;
const today = () => Math.floor(Date.now() / DAY);
const iso = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);

async function read(req: Request, scope: "COVERAGE" | "STAFFING" | "ATTENDANCE" | "COMPLIANCE", screen: string) {
  const granted = await grantedFor(req.district!.districtId, scope);
  await auditDistrictRead(req, granted, screen, scope);
  return granted;
}

// ------------------------------------------------------------- coverage

export type DayState = "OK" | "SHORT" | "CADRE" | "NO_ROSTER";
interface Day { date: string; state: DayState; staffed: number; required: number; cadres: string[] }

/** Staffed against required, for each of the next days, from the published roster only. */
export async function coverageFor(facilityId: string, from: number, days: number): Promise<Day[]> {
  const [shifts, cadres, rosters] = await Promise.all([
    prisma.shift.findMany({ where: { facilityId, active: true, countsAsDuty: true, isOnCall: false }, select: { id: true, minStaff: true, minByCadre: true, weekendMinStaff: true, weekendMinByCadre: true, holidayMinStaff: true, holidayMinByCadre: true } }),
    prisma.cadre.findMany({ where: { facilityId }, select: { id: true, name: true } }),
    prisma.roster.findMany({ where: { facilityId, status: "PUBLISHED" }, select: { id: true, year: true, month: true } }),
  ]);
  const shaped = shifts.map((s) => ({
    ...s, minByCadre: (s.minByCadre ?? {}) as Record<string, number>,
    weekendMinByCadre: (s.weekendMinByCadre ?? null) as Record<string, number> | null, holidayMinByCadre: (s.holidayMinByCadre ?? null) as Record<string, number> | null,
  }));
  const needy = shaped.filter((s) => hasDemand(s));
  const holidayRows = await prisma.publicHoliday.findMany({ where: { OR: [{ facilityId }, { facilityId: null }], date: { gte: new Date(from * DAY), lte: new Date((from + days - 1) * DAY) } }, select: { date: true } });
  const holidays = new Set(holidayRows.map((h) => Math.floor(h.date.getTime() / DAY)));
  const published = new Set(rosters.map((r) => `${r.year}-${r.month}`));
  const assigned = await prisma.rosterAssignment.findMany({
    where: { facilityId, rosterId: { in: rosters.map((r) => r.id) }, shiftId: { in: needy.map((s) => s.id) }, dutyDate: { gte: new Date(from * DAY), lte: new Date((from + days - 1) * DAY) } },
    select: { shiftId: true, dutyDate: true, staff: { select: { cadreId: true } } },
  });
  const cadreName = new Map(cadres.map((c) => [c.id, c.name]));
  const out: Day[] = [];
  for (let d = from; d < from + days; d++) {
    const dt = new Date(d * DAY);
    if (!published.has(`${dt.getUTCFullYear()}-${dt.getUTCMonth() + 1}`)) { out.push({ date: iso(d), state: "NO_ROSTER", staffed: 0, required: 0, cadres: [] }); continue; }
    let staffed = 0, required = 0, short = false;
    const cadreShort = new Set<string>();
    for (const s of needy) {
      const here = assigned.filter((a) => a.shiftId === s.id && Math.floor(a.dutyDate.getTime() / DAY) === d);
      const today = demandOn(s, d, holidays);
      const byCadre = Object.entries(today.minByCadre);
      const need = Math.max(today.minStaff, byCadre.reduce((n, [, v]) => n + v, 0));
      required += need;
      staffed += Math.min(here.length, need);
      if (here.length < today.minStaff) short = true;
      for (const [cid, v] of byCadre) if (here.filter((a) => a.staff.cadreId === cid).length < v) cadreShort.add(cadreName.get(cid) ?? "a cadre");
    }
    out.push({ date: iso(d), state: short ? "SHORT" : cadreShort.size ? "CADRE" : "OK", staffed, required, cadres: [...cadreShort] });
  }
  return out;
}

districtRouter.get("/coverage", async (req, res) => {
  const granted = await read(req, "COVERAGE", "the coverage monitor");
  const from = today();
  const rows = await Promise.all(granted.map(async (g) => ({ facilityId: g.facilityId, name: g.name, days: await coverageFor(g.facilityId, from, 7) })));
  res.json({ reading: readingUnder(granted, "COVERAGE"), dates: Array.from({ length: 7 }, (_, i) => ({ date: iso(from + i), label: sayDay(from + i) })), facilities: rows });
});

// ------------------------------------------------------------- establishment

districtRouter.get("/establishment", async (req, res) => {
  const granted = await read(req, "STAFFING", "establishment and vacancies");
  const ids = granted.map((g) => g.facilityId);
  const [cadres, posts, filled] = await Promise.all([
    prisma.cadre.findMany({ where: { facilityId: { in: ids }, active: true }, select: { id: true, name: true, facilityId: true } }),
    prisma.establishmentPost.findMany({ where: { facilityId: { in: ids } } }),
    prisma.staff.groupBy({ by: ["facilityId", "cadreId"], where: { facilityId: { in: ids }, status: "ACTIVE" }, _count: { _all: true } }),
  ]);
  const facilities = granted.map((g) => ({
    facilityId: g.facilityId, name: g.name,
    cadres: cadres.filter((c) => c.facilityId === g.facilityId).map((c) => {
      const approved = posts.find((p) => p.facilityId === g.facilityId && p.cadreId === c.id)?.approvedCount ?? 0;
      const have = filled.find((f) => f.facilityId === g.facilityId && f.cadreId === c.id)?._count._all ?? 0;
      return { cadre: c.name, approved, filled: have, vacancies: Math.max(0, approved - have) };
    }).filter((c) => c.approved > 0 || c.filled > 0),
  }));
  res.json({ reading: readingUnder(granted, "STAFFING"), facilities });
});

// ------------------------------------------------------------- dashboard

const minutes = (hhmm: string | null) => (hhmm ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) : null);

districtRouter.get("/dashboard", async (req, res) => {
  const granted = await read(req, "COVERAGE", "the district dashboard");
  const ids = granted.map((g) => g.facilityId);
  const now = new Date();
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const d0 = today();
  const duties = await prisma.rosterAssignment.findMany({
    where: { facilityId: { in: ids }, roster: { status: "PUBLISHED" }, dutyDate: { in: [new Date((d0 - 1) * DAY), new Date(d0 * DAY)] }, shift: { countsAsDuty: true, isOnCall: false } },
    select: { dutyDate: true, shift: { select: { startTime: true, endTime: true, isOvernight: true } } },
  });
  const onDutyNow = duties.filter((a) => {
    const s = minutes(a.shift.startTime), e = minutes(a.shift.endTime);
    if (s === null || e === null) return false;
    const isToday = Math.floor(a.dutyDate.getTime() / DAY) === d0;
    const overnight = a.shift.isOvernight || e <= s;
    return isToday ? (overnight ? nowMin >= s : nowMin >= s && nowMin < e) : overnight && nowMin < e;
  }).length;
  let unfilled = 0;
  for (const g of granted) unfilled += (await coverageFor(g.facilityId, d0, 2)).filter((d) => d.state === "SHORT" || d.state === "CADRE").length;
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const publishedNext = await prisma.roster.findMany({ where: { facilityId: { in: ids }, year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, status: "PUBLISHED" }, select: { facilityId: true } });
  const notPublished = granted.filter((g) => !publishedNext.some((r) => r.facilityId === g.facilityId)).map((g) => g.name);
  // One row per facility so the overview can be read as a comparison, worst first.
  const rows = await Promise.all(granted.map(async (g) => {
    const days = await coverageFor(g.facilityId, d0, 7);
    return {
      facilityId: g.facilityId, name: g.name,
      shortDays: days.filter((d) => d.state === "SHORT" || d.state === "CADRE").length,
      noRosterDays: days.filter((d) => d.state === "NO_ROSTER").length,
      nextMonthPublished: publishedNext.some((r) => r.facilityId === g.facilityId),
    };
  }));
  rows.sort((a, b) => b.shortDays - a.shortDays || b.noRosterDays - a.noRosterDays || a.name.localeCompare(b.name));
  res.json({ reading: readingUnder(granted, "COVERAGE"), facilitiesGranted: granted.length, staffOnDutyNow: onDutyNow, shortDaysNext24Hours: unfilled, nextMonthNotPublished: notPublished, facilities: rows });
});

// ------------------------------------------------------------- attendance completeness and compliance

/** The last three calendar months, newest first. */
function lastMonths(n = 3) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  });
}

/** How much of each published roster has attendance recorded. Completeness only: never who was absent. */
districtRouter.get("/attendance", async (req, res) => {
  const granted = await read(req, "ATTENDANCE", "attendance completeness");
  const months = lastMonths();
  const rosters = await prisma.roster.findMany({
    where: { facilityId: { in: granted.map((g) => g.facilityId) }, status: "PUBLISHED", OR: months },
    select: { facilityId: true, year: true, month: true, attendanceCompleteness: true },
  });
  res.json({
    reading: readingUnder(granted, "ATTENDANCE"),
    months: months.map((m) => ({ ...m, label: new Date(Date.UTC(m.year, m.month - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) })),
    facilities: granted.map((g) => ({
      facilityId: g.facilityId, name: g.name,
      months: months.map((m) => {
        const r = rosters.find((x) => x.facilityId === g.facilityId && x.year === m.year && x.month === m.month);
        return { published: Boolean(r), percent: r?.attendanceCompleteness == null ? null : Math.round(r.attendanceCompleteness * 100) };
      }),
    })),
  });
});

/** Counts of open findings on each published roster. Rule codes and counts only, no names. */
districtRouter.get("/compliance", async (req, res) => {
  const granted = await read(req, "COMPLIANCE", "roster compliance");
  const months = lastMonths(2);
  const rosters = await prisma.roster.findMany({
    where: { facilityId: { in: granted.map((g) => g.facilityId) }, status: "PUBLISHED", OR: months },
    select: { id: true, facilityId: true, year: true, month: true },
  });
  const findings = await prisma.complianceFinding.groupBy({ by: ["rosterId", "severity", "status"], where: { rosterId: { in: rosters.map((r) => r.id) } }, _count: { _all: true } });
  res.json({
    reading: readingUnder(granted, "COMPLIANCE"),
    months: months.map((m) => ({ ...m, label: new Date(Date.UTC(m.year, m.month - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) })),
    facilities: granted.map((g) => ({
      facilityId: g.facilityId, name: g.name,
      months: months.map((m) => {
        const ids = rosters.filter((r) => r.facilityId === g.facilityId && r.year === m.year && r.month === m.month).map((r) => r.id);
        if (ids.length === 0) return { published: false, blockingOpen: 0, warningsOpen: 0, overridden: 0 };
        const n = (pred: (x: (typeof findings)[number]) => boolean) => findings.filter((x) => ids.includes(x.rosterId) && pred(x)).reduce((t, x) => t + x._count._all, 0);
        return { published: true, blockingOpen: n((x) => x.severity === "BLOCK" && x.status === "OPEN"), warningsOpen: n((x) => x.severity === "WARN" && x.status === "OPEN"), overridden: n((x) => x.status === "OVERRIDDEN") };
      }),
    })),
  });
});

// ------------------------------------------------------------- leave concentration

const MIN_GROUP = 3;
const THRESHOLD = 0.25;

districtRouter.get("/leave-concentration", async (req, res) => {
  const granted = await read(req, "STAFFING", "leave concentration");
  const ids = granted.map((g) => g.facilityId);
  const d0 = today();
  const monday = d0 - ((new Date(d0 * DAY).getUTCDay() + 6) % 7);
  const staff = await prisma.staff.findMany({ where: { facilityId: { in: ids }, status: "ACTIVE", cadreId: { not: null } }, select: { id: true, facilityId: true, cadre: { select: { name: true } } } });
  // A cadre with fewer than three staff at a facility is left out entirely: its leave would point at a person.
  const group = new Map<string, typeof staff>();
  for (const s of staff) group.set(`${s.facilityId}|${s.cadre!.name}`, [...(group.get(`${s.facilityId}|${s.cadre!.name}`) ?? []), s]);
  const kept = [...group.values()].filter((g) => g.length >= MIN_GROUP).flat();
  const suppressed = [...group.values()].filter((g) => g.length < MIN_GROUP).length;
  const leave = await prisma.leaveRequest.findMany({
    where: { facilityId: { in: ids }, status: "APPROVED", staffId: { in: kept.map((k) => k.id) }, endDate: { gte: new Date(monday * DAY) }, startDate: { lte: new Date((monday + 8 * 7 - 1) * DAY) } },
    select: { staffId: true, startDate: true, endDate: true }, // never the type
  });
  const cadreNames = [...new Set(kept.map((k) => k.cadre!.name))].sort();
  const weeks = Array.from({ length: 8 }, (_, w) => {
    const from = monday + w * 7, to = from + 6;
    return {
      from: iso(from), label: `Week of ${sayDay(from)}`,
      cadres: cadreNames.map((c) => {
        const members = kept.filter((k) => k.cadre!.name === c);
        const away = new Set(leave.filter((l) => members.some((m) => m.id === l.staffId) && Math.floor(l.startDate.getTime() / DAY) <= to && Math.floor(l.endDate.getTime() / DAY) >= from).map((l) => l.staffId)).size;
        return { cadre: c, away, total: members.length, concern: members.length > 0 && away / members.length >= THRESHOLD };
      }),
    };
  });
  res.json({ reading: readingUnder(granted, "STAFFING"), weeks, threshold: THRESHOLD, suppressedGroups: suppressed, note: "Counts of people and their cadres only. No names and no kind of leave. A cadre with fewer than three staff at a facility is left out." });
});

// ------------------------------------------------------------- report pack

export async function reportPack(req: Request) {
  const reportMonth = new Date();
  const year = reportMonth.getUTCFullYear(), month = reportMonth.getUTCMonth() + 1;
  const sections: Record<string, unknown> = {};
  const used: { scope: string; facilities: number }[] = [];

  const staffing = await grantedFor(req.district!.districtId, "STAFFING");
  await auditDistrictRead(req, staffing, "the report pack (establishment and staffing)", "STAFFING");
  used.push({ scope: "staffing", facilities: staffing.length });
  {
    const ids = staffing.map((g) => g.facilityId);
    const [cadres, posts, filled] = await Promise.all([
      prisma.cadre.findMany({ where: { facilityId: { in: ids }, active: true }, select: { id: true, name: true, facilityId: true } }),
      prisma.establishmentPost.findMany({ where: { facilityId: { in: ids } } }),
      prisma.staff.groupBy({ by: ["facilityId", "cadreId"], where: { facilityId: { in: ids }, status: "ACTIVE" }, _count: { _all: true } }),
    ]);
    sections.establishment = staffing.flatMap((g) => cadres.filter((c) => c.facilityId === g.facilityId).map((c) => {
      const approved = posts.find((p) => p.facilityId === g.facilityId && p.cadreId === c.id)?.approvedCount ?? 0;
      const have = filled.find((f) => f.facilityId === g.facilityId && f.cadreId === c.id)?._count._all ?? 0;
      return { facility: g.name, cadre: c.name, approved, filled: have, vacancies: Math.max(0, approved - have) };
    }).filter((r) => r.approved > 0 || r.filled > 0));
  }

  const coverage = await grantedFor(req.district!.districtId, "COVERAGE");
  await auditDistrictRead(req, coverage, "the report pack (coverage summary)", "COVERAGE");
  used.push({ scope: "coverage", facilities: coverage.length });
  sections.coverage = await Promise.all(coverage.map(async (g) => {
    const days = await coverageFor(g.facilityId, today(), 7);
    return { facility: g.name, daysFullyStaffed: days.filter((d) => d.state === "OK").length, daysShort: days.filter((d) => d.state === "SHORT").length, daysShortOfACadre: days.filter((d) => d.state === "CADRE").length, daysWithNoPublishedRoster: days.filter((d) => d.state === "NO_ROSTER").length };
  }));

  const attendance = await grantedFor(req.district!.districtId, "ATTENDANCE");
  await auditDistrictRead(req, attendance, "the report pack (attendance completeness)", "ATTENDANCE");
  used.push({ scope: "attendance", facilities: attendance.length });
  const rostersA = await prisma.roster.findMany({ where: { facilityId: { in: attendance.map((g) => g.facilityId) }, year, month, status: "PUBLISHED" }, select: { facilityId: true, attendanceCompleteness: true } });
  sections.attendance = attendance.map((g) => ({ facility: g.name, completenessPercent: (() => { const v = rostersA.find((r) => r.facilityId === g.facilityId)?.attendanceCompleteness; return v === null || v === undefined ? null : Math.round(v * 100); })() }));

  const compliance = await grantedFor(req.district!.districtId, "COMPLIANCE");
  await auditDistrictRead(req, compliance, "the report pack (compliance summary)", "COMPLIANCE");
  used.push({ scope: "compliance", facilities: compliance.length });
  const rostersC = await prisma.roster.findMany({ where: { facilityId: { in: compliance.map((g) => g.facilityId) }, year, month, status: "PUBLISHED" }, select: { id: true, facilityId: true } });
  const findings = await prisma.complianceFinding.groupBy({ by: ["rosterId", "severity", "status"], where: { rosterId: { in: rostersC.map((r) => r.id) } }, _count: { _all: true } });
  sections.compliance = compliance.map((g) => {
    const r = rostersC.find((x) => x.facilityId === g.facilityId);
    const f = findings.filter((x) => x.rosterId === r?.id);
    const n = (pred: (x: (typeof f)[number]) => boolean) => f.filter(pred).reduce((t, x) => t + x._count._all, 0);
    return { facility: g.name, published: Boolean(r), blockingOpen: n((x) => x.severity === "BLOCK" && x.status === "OPEN"), warningsOpen: n((x) => x.severity === "WARN" && x.status === "OPEN"), overridden: n((x) => x.status === "OVERRIDDEN") };
  });
  return { generatedOn: new Date().toISOString().slice(0, 10), district: req.district!.districtName, period: `${year}-${String(month).padStart(2, "0")}`, used, sections };
}

districtRouter.get("/report-pack", async (req, res) => {
  res.json(await reportPack(req));
});

districtRouter.get("/report-pack.csv", async (req, res) => {
  const pack = await reportPack(req);
  const esc = csvCell;
  const lines: string[] = [`District report pack,${esc(pack.district)},${pack.period},generated ${pack.generatedOn}`, ""];
  for (const [name, rows] of Object.entries(pack.sections)) {
    const list = rows as Record<string, unknown>[];
    lines.push(name.toUpperCase());
    if (list.length === 0) { lines.push("No facility has granted this information.", ""); continue; }
    lines.push(Object.keys(list[0]).join(","));
    for (const r of list) lines.push(Object.values(r).map(esc).join(","));
    lines.push("");
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="district-report-pack-${pack.period}.csv"`);
  res.send(lines.join("\n"));
});

// ------------------------------------------------------------- performance scorecard

/** A month as `YYYY-MM`, no later than this month and no earlier than two years back. Defaults to last month. */
function scorecardMonth(raw: unknown) {
  const now = new Date();
  const fallback = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const m = typeof raw === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? { year: Number(raw.slice(0, 4)), month: Number(raw.slice(5)) } : { year: fallback.getUTCFullYear(), month: fallback.getUTCMonth() + 1 };
  const index = m.year * 12 + m.month;
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth() + 1;
  return index > current || index < current - 24 ? { year: fallback.getUTCFullYear(), month: fallback.getUTCMonth() + 1 } : m;
}

const label = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

async function scorecardFor(req: Request) {
  const { year, month } = scorecardMonth(req.query.month);
  // Each figure is read under its own permission, and each read is written to the facility's audit log.
  const [coverage, attendance, compliance, staffing] = await Promise.all([
    read(req, "COVERAGE", "the performance scorecard"),
    read(req, "ATTENDANCE", "the performance scorecard"),
    read(req, "COMPLIANCE", "the performance scorecard"),
    read(req, "STAFFING", "the performance scorecard"),
  ]);
  const rows = await scorecard(year, month, coverage, attendance, compliance, staffing);
  const prev = new Date(Date.UTC(year, month - 2, 1));
  return { year, month, rows, coverage, attendance, compliance, staffing, label: label(year, month), previousLabel: label(prev.getUTCFullYear(), prev.getUTCMonth() + 1) };
}

/** Per district, for a regional office comparing the districts that report to it. */
function byDistrict(rows: Row[]) {
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(r.district ?? "No district", [...(groups.get(r.district ?? "No district") ?? []), r]);
  return [...groups.entries()].map(([district, list]) => ({
    district, facilities: list.length,
    coverage: mean(list.map((r) => r.month.coverage)), previousCoverage: mean(list.map((r) => r.previous.coverage)),
    attendance: mean(list.map((r) => r.month.attendance)), previousAttendance: mean(list.map((r) => r.previous.attendance)),
    publishedBeforeStart: mean(list.map((r) => r.month.publishedBeforeStart)),
    staffing: mean(list.map((r) => r.month.staffing)),
    blocking: list.every((r) => r.month.blocking === null) ? null : list.reduce((n, r) => n + (r.month.blocking ?? 0), 0),
    inConcern: list.filter((r) => r.concerns > 0).length,
  })).sort((a, b) => b.inConcern - a.inConcern || a.district.localeCompare(b.district));
}

districtRouter.get("/scorecard", async (req, res) => {
  const s = await scorecardFor(req);
  const all = new Map([...s.coverage, ...s.attendance, ...s.compliance, ...s.staffing].map((g) => [g.facilityId, g]));
  const level = (await prisma.district.findUnique({ where: { id: req.district!.districtId }, select: { level: true } }))?.level;
  res.json({
    reading: {
      scope: "COVERAGE",
      facilities: [...all.values()].map((g) => ({ id: g.facilityId, name: g.name })),
      sentence: all.size
        ? `Reading ${all.size} ${all.size === 1 ? "facility" : "facilities"}. Each figure comes from the permission that covers it. A figure a facility has not shared is left blank.`
        : "No facility has granted coverage, attendance or compliance, so there is nothing to show.",
    },
    month: `${s.year}-${String(s.month).padStart(2, "0")}`, label: s.label, previousLabel: s.previousLabel,
    summary: {
      facilities: s.rows.length, inConcern: s.rows.filter((r) => r.concerns > 0).length,
      coverage: mean(s.rows.map((r) => r.month.coverage)), previousCoverage: mean(s.rows.map((r) => r.previous.coverage)),
      attendance: mean(s.rows.map((r) => r.month.attendance)), previousAttendance: mean(s.rows.map((r) => r.previous.attendance)),
      publishedBeforeStart: mean(s.rows.map((r) => r.month.publishedBeforeStart)),
      staffing: mean(s.rows.map((r) => r.month.staffing)), previousStaffing: mean(s.rows.map((r) => r.previous.staffing)),
    },
    thresholds: { staffing: "Good from 90%, watch from 75%", coverage: "Good from 90%, watch from 75%", attendance: "Good from 90%, watch from 70%", publishedBeforeStart: "Good at 100%, watch from 50%", blocking: "Good at none, watch up to 2" },
    facilities: s.rows,
    ...(level === "REGION" ? { districts: byDistrict(s.rows) } : {}),
  });
});

districtRouter.get("/scorecard.csv", async (req, res) => {
  const s = await scorecardFor(req);
  const esc = csvCell;
  const n = (v: number | null) => (v === null ? "" : v);
  const lines = [
    `Performance scorecard,${esc(req.district!.districtName)},${s.label},compared with ${s.previousLabel}`,
    "Facility,District,Days fully staffed %,Change,Published before month began %,Attendance recorded %,Change,Posts filled %,Blocking findings open,Warnings open",
    ...s.rows.map((r) => [r.name, r.district ?? "", n(r.month.coverage), n(r.change.coverage), n(r.month.publishedBeforeStart), n(r.month.attendance), n(r.change.attendance), n(r.month.staffing), n(r.month.blocking), n(r.month.warnings)].map(esc).join(",")),
  ];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="scorecard-${s.year}-${String(s.month).padStart(2, "0")}.csv"`);
  res.send(lines.join("\n"));
});

export type { Granted };

// ------------------------------------------------------------- the district's own details and directory

/** The details the district registered with. Read only: a change goes through PS Tech. */
districtRouter.get("/profile", async (req, res) => {
  const d = await prisma.district.findUnique({ where: { id: req.district!.districtId } });
  if (!d) return res.status(404).json({ error: "not_found" });
  res.json({
    district: {
      name: d.name, region: d.region, level: d.level, agency: d.agency, status: d.status, registeredAt: d.registeredAt, approvedAt: d.approvedAt,
      contact: { name: d.contactName, role: d.contactRole, email: d.contactEmail, phone: d.contactPhone, officeAddress: d.officeAddress },
    },
  });
});

/**
 * Facilities that chose this district. Name, type and whether they have given
 * access: nothing about their staff or rosters, which stay behind the grants.
 */
districtRouter.get("/facilities", async (req, res) => {
  const districtId = req.district!.districtId;
  const agency = await agencyOf(districtId);
  const under = await officesUnder(districtId);
  const [facilities, grants] = await Promise.all([
    prisma.facility.findMany({ where: { districtId: { in: under }, agency, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, facilityType: true, createdAt: true, status: true, accessNote: true } }),
    prisma.districtGrant.findMany({ where: { districtId: { in: under }, status: "ACTIVE" }, select: { facilityId: true } }),
  ]);
  const granted = new Set(grants.map((g) => g.facilityId));
  res.json({ facilities: facilities.map((f) => ({ id: f.id, name: f.name, type: f.facilityType, joinedAt: f.createdAt, grantedAccess: granted.has(f.id) && f.status !== "SUSPENDED", suspended: f.status === "SUSPENDED", suspendedReason: f.status === "SUSPENDED" ? f.accessNote : null })) });
});
