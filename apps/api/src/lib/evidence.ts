// The evidence report: what HealthFlow did for this facility, month by month.
// Every figure is computed from the facility's own records. None is typed in.
import { prisma } from "./prisma.js";
import { complianceFigures, rosterForMonth } from "./reportStats.js";

const round1 = (n: number) => Math.round(n * 10) / 10;
const stdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

export interface EvidenceMonth {
  month: string;
  hasRoster: boolean;
  status: string | null;
  prepSeconds: number | null;
  conflictsDetected: number;
  conflictsByRule: Record<string, number>;
  blockingFound: number;
  overridden: number;
  unfilledOpen: number;
  amendments: number;
  amendmentReasons: string[];
  attendanceCompletenessPercent: number | null;
  nightSpread: { cadre: string; stdev: number; staff: number }[];
  swaps: Record<string, number>;
}

export async function evidenceFor(facilityId: string, endYear: number, endMonth: number, months = 6) {
  const out: EvidenceMonth[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(endYear, endMonth - 1 - i, 1));
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
    const label = `${y}-${String(m).padStart(2, "0")}`;
    const roster = await rosterForMonth(facilityId, y, m);
    if (!roster) { out.push({ month: label, hasRoster: false, status: null, prepSeconds: null, conflictsDetected: 0, conflictsByRule: {}, blockingFound: 0, overridden: 0, unfilledOpen: 0, amendments: 0, amendmentReasons: [], attendanceCompletenessPercent: null, nightSpread: [], swaps: {} }); continue; }
    const [findings, snaps, swaps, fig] = await Promise.all([
      prisma.complianceFinding.findMany({ where: { rosterId: roster.id }, select: { ruleCode: true, severity: true, status: true } }),
      prisma.rosterVersionSnapshot.findMany({ where: { rosterId: roster.id }, select: { reason: true } }),
      prisma.dutySwap.groupBy({ by: ["status"], where: { rosterId: roster.id }, _count: { _all: true } }),
      complianceFigures(facilityId, roster.id, y, m),
    ]);
    const byRule: Record<string, number> = {};
    for (const f of findings) byRule[f.ruleCode] = (byRule[f.ruleCode] ?? 0) + 1;
    const cadres = new Map<string, number[]>();
    for (const r of fig.rows) cadres.set(r.cadre ?? "No cadre", [...(cadres.get(r.cadre ?? "No cadre") ?? []), r.nights]);
    out.push({
      month: label, hasRoster: true, status: roster.status,
      prepSeconds: roster.generationSeconds ?? null,
      conflictsDetected: findings.length, conflictsByRule: byRule,
      blockingFound: findings.filter((f) => f.severity === "BLOCK").length,
      overridden: findings.filter((f) => f.status === "OVERRIDDEN").length,
      unfilledOpen: findings.filter((f) => f.ruleCode === "C11" && f.status === "OPEN").length,
      amendments: Math.max(0, roster.version - 1), amendmentReasons: snaps.map((s) => s.reason).filter((r): r is string => Boolean(r)),
      attendanceCompletenessPercent: roster.attendanceCompleteness === null ? null : Math.round(roster.attendanceCompleteness * 100),
      nightSpread: [...cadres.entries()].map(([cadre, xs]) => ({ cadre, stdev: round1(stdev(xs)), staff: xs.length })),
      swaps: Object.fromEntries(swaps.map((s) => [s.status, s._count._all])),
    });
  }
  const [active, signedIn] = await Promise.all([
    prisma.staff.count({ where: { facilityId, status: "ACTIVE" } }),
    prisma.userProfile.count({ where: { facilityId, active: true, staffId: { not: null }, lastSignInAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
  ]);
  return { months: out, access: { activeStaff: active, signedInLast30Days: signedIn } };
}
