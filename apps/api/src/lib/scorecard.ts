// The performance scorecard: a few plain measures for each facility, for one month and the month before, so a district or
// region can see who is slipping and who is improving. Each figure comes from one permission the facility has granted
// (coverage, attendance, compliance). A figure the facility has not shared is blank, never guessed. There is no single
// composite score: one number hides which part is failing, and invites gaming.
import { prisma } from "./prisma.js";
import { coverageFor } from "../routes/district.js";
import type { Granted } from "./district.js";

const DAY = 86_400_000;

export interface Metrics {
  /** Percent of days with a published roster on which every shift had enough people. */
  coverage: number | null;
  /** Percent of the month's rosters that were published before the month began. */
  publishedBeforeStart: number | null;
  /** Average percent of duties with attendance recorded, across published rosters. */
  attendance: number | null;
  /** Findings that block a roster and were still open. */
  blocking: number | null;
  warnings: number | null;
  /** Percent of approved posts that are filled, counting no cadre above its approved number. Known only as of the day it was taken. */
  staffing: number | null;
}

export type Band = "GOOD" | "WATCH" | "CONCERN";
type Key = keyof Metrics;

/** Thresholds are deliberately round, and stated on the page, so a facility can see what it is measured against. */
export function bandOf(key: Key, v: number | null): Band | null {
  if (v === null) return null;
  switch (key) {
    case "coverage": return v >= 90 ? "GOOD" : v >= 75 ? "WATCH" : "CONCERN";
    case "attendance": return v >= 90 ? "GOOD" : v >= 70 ? "WATCH" : "CONCERN";
    case "publishedBeforeStart": return v >= 100 ? "GOOD" : v >= 50 ? "WATCH" : "CONCERN";
    case "staffing": return v >= 90 ? "GOOD" : v >= 75 ? "WATCH" : "CONCERN";
    case "blocking": return v === 0 ? "GOOD" : v <= 2 ? "WATCH" : "CONCERN";
    case "warnings": return v <= 5 ? "GOOD" : v <= 20 ? "WATCH" : "CONCERN";
  }
}

export interface Shared { coverage: boolean; attendance: boolean; compliance: boolean; staffing: boolean }

const EMPTY: Metrics = { coverage: null, publishedBeforeStart: null, attendance: null, blocking: null, warnings: null, staffing: null };

/** Approved posts filled, as a percent. Staff counts are as of now, so this is only taken for the current month or when a month is frozen. */
async function staffingPercent(facilityId: string): Promise<number | null> {
  const [posts, filled] = await Promise.all([
    prisma.establishmentPost.findMany({ where: { facilityId, approvedCount: { gt: 0 } }, select: { cadreId: true, approvedCount: true } }),
    prisma.staff.groupBy({ by: ["cadreId"], where: { facilityId, status: "ACTIVE" }, _count: { _all: true } }),
  ]);
  const approved = posts.reduce((n, p) => n + p.approvedCount, 0);
  if (approved === 0) return null;
  const have = posts.reduce((n, p) => n + Math.min(p.approvedCount, filled.find((f) => f.cadreId === p.cadreId)?._count._all ?? 0), 0);
  return Math.round((have / approved) * 100);
}

/** Every figure for one facility and month, whatever it has shared. Callers hide what was not granted. */
export async function computeMetrics(facilityId: string, year: number, month: number, now = new Date(), withStaffing = false): Promise<Metrics> {
  const start = Date.UTC(year, month - 1, 1);
  const next = Date.UTC(year, month, 1);
  const out: Metrics = { ...EMPTY };
  if (start > now.getTime()) return out;

  const rosters = await prisma.roster.findMany({ where: { facilityId, year, month }, select: { id: true, status: true, publishedAt: true, attendanceCompleteness: true } });
  const published = rosters.filter((r) => r.status === "PUBLISHED");

  out.publishedBeforeStart = rosters.length === 0 ? 0 : Math.round((published.filter((r) => r.publishedAt && r.publishedAt.getTime() < start).length / rosters.length) * 100);
  const startDay = Math.floor(start / DAY);
  const monthDays = Math.round((next - start) / DAY);
  // A month still running is judged on the days already gone.
  const days = now.getTime() >= next ? monthDays : Math.max(1, Math.floor(now.getTime() / DAY) - startDay);
  const cover = (await coverageFor(facilityId, startDay, days)).filter((d) => d.state !== "NO_ROSTER");
  if (cover.length > 0) out.coverage = Math.round((cover.filter((d) => d.state === "OK").length / cover.length) * 100);

  const counted = published.filter((r) => r.attendanceCompleteness !== null);
  if (counted.length > 0) out.attendance = Math.round((counted.reduce((n, r) => n + (r.attendanceCompleteness ?? 0), 0) / counted.length) * 100);

  if (published.length > 0) {
    const f = await prisma.complianceFinding.groupBy({ by: ["severity"], where: { rosterId: { in: published.map((r) => r.id) }, status: "OPEN" }, _count: { _all: true } });
    out.blocking = f.filter((x) => x.severity === "BLOCK").reduce((n, x) => n + x._count._all, 0);
    out.warnings = f.filter((x) => x.severity === "WARN").reduce((n, x) => n + x._count._all, 0);
  }
  if (withStaffing) out.staffing = await staffingPercent(facilityId);
  return out;
}

const monthEnded = (year: number, month: number, now: Date) => Date.UTC(year, month, 1) <= now.getTime();

/** Freezes a finished month once. The first run after the month ends fixes the figures, so later edits cannot move them. */
export async function takeSnapshot(facilityId: string, year: number, month: number, now = new Date()): Promise<boolean> {
  if (!monthEnded(year, month, now)) return false;
  const exists = await prisma.scorecardSnapshot.findUnique({ where: { facilityId_year_month: { facilityId, year, month } }, select: { id: true } });
  if (exists) return false;
  const metrics = await computeMetrics(facilityId, year, month, now, true);
  await prisma.scorecardSnapshot.createMany({ data: [{ facilityId, year, month, metrics }], skipDuplicates: true });
  return true;
}

/** Freezes last month for every facility that belongs to a district. Safe to run daily. */
export async function snapshotLastMonth(now = new Date()): Promise<number> {
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const facilities = await prisma.facility.findMany({ where: { active: true, districtId: { not: null }, status: { in: ["TRIAL", "ACTIVE"] } }, select: { id: true } });
  let n = 0;
  for (const f of facilities) if (await takeSnapshot(f.id, prev.getUTCFullYear(), prev.getUTCMonth() + 1, now)) n++;
  return n;
}

/** One facility's figures for one month, limited to what it has shared. A finished month is read from its snapshot when there is one. */
export async function monthMetrics(facilityId: string, year: number, month: number, shared: Shared, now = new Date()): Promise<Metrics> {
  const frozen = monthEnded(year, month, now) ? await prisma.scorecardSnapshot.findUnique({ where: { facilityId_year_month: { facilityId, year, month } } }) : null;
  const isCurrent = !monthEnded(year, month, now) && Date.UTC(year, month - 1, 1) <= now.getTime();
  const all = frozen ? { ...EMPTY, ...(frozen.metrics as Partial<Metrics>) } : await computeMetrics(facilityId, year, month, now, isCurrent);
  return {
    coverage: shared.coverage ? all.coverage : null,
    publishedBeforeStart: shared.coverage ? all.publishedBeforeStart : null,
    attendance: shared.attendance ? all.attendance : null,
    blocking: shared.compliance ? all.blocking : null,
    warnings: shared.compliance ? all.warnings : null,
    staffing: shared.staffing ? all.staffing : null,
  };
}

const KEYS: Key[] = ["coverage", "publishedBeforeStart", "attendance", "staffing", "blocking", "warnings"];
/** Change from the month before. Positive is a rise in the figure; for findings a rise is worse, which the page words that way. */
const change = (cur: Metrics, prev: Metrics) => Object.fromEntries(KEYS.map((k) => [k, cur[k] === null || prev[k] === null ? null : (cur[k] as number) - (prev[k] as number)])) as Record<Key, number | null>;

export interface Row {
  facilityId: string; name: string; districtId: string | null; district: string | null;
  month: Metrics; previous: Metrics; change: Record<Key, number | null>; bands: Record<Key, Band | null>; concerns: number;
}

/**
 * Scorecard rows for every facility granted under at least one of the three permissions.
 * `previousOf` is the month before the one asked for.
 */
export async function scorecard(year: number, month: number, coverage: Granted[], attendance: Granted[], compliance: Granted[], staffing: Granted[], now = new Date()): Promise<Row[]> {
  const prevDate = new Date(Date.UTC(year, month - 2, 1));
  const everyone = [...coverage, ...attendance, ...compliance, ...staffing];
  const ids = new Set(everyone.map((g) => g.facilityId));
  const names = new Map(everyone.map((g) => [g.facilityId, g.name]));
  const facilities = await prisma.facility.findMany({ where: { id: { in: [...ids] } }, select: { id: true, districtId: true, district: { select: { name: true } } } });
  const where = new Map(facilities.map((f) => [f.id, { id: f.districtId, name: f.district?.name ?? null }]));
  const rows: Row[] = [];
  for (const id of ids) {
    const shared: Shared = { coverage: coverage.some((g) => g.facilityId === id), attendance: attendance.some((g) => g.facilityId === id), compliance: compliance.some((g) => g.facilityId === id), staffing: staffing.some((g) => g.facilityId === id) };
    const cur = await monthMetrics(id, year, month, shared, now);
    const prev = await monthMetrics(id, prevDate.getUTCFullYear(), prevDate.getUTCMonth() + 1, shared, now);
    const bands = Object.fromEntries(KEYS.map((k) => [k, bandOf(k, cur[k])])) as Record<Key, Band | null>;
    rows.push({
      facilityId: id, name: names.get(id) ?? "Facility", districtId: where.get(id)?.id ?? null, district: where.get(id)?.name ?? null,
      month: cur, previous: prev, change: change(cur, prev), bands, concerns: Object.values(bands).filter((b) => b === "CONCERN").length,
    });
  }
  return rows.sort((a, b) => b.concerns - a.concerns || a.name.localeCompare(b.name));
}

/** The mean of the figures that exist, or null when none do. */
export const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
};
