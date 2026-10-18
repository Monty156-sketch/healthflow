// How a facility is doing, worked out from what it does and never from what it
// says. Reduced to three states so the console can say which facility to
// telephone. At risk means a phone call, not an email.
import { prisma } from "./prisma.js";

export type Health = "HEALTHY" | "WATCH" | "AT_RISK";

export interface Adoption {
  health: Health;
  why: string[];
  rostersThisMonth: number;
  rostersLastMonth: number;
  daysSinceSignIn: number | null;
  accountsActive: number;
  staffActive: number;
  lastRosterPublishedAt: Date | null;
  lastSignInAt: Date | null;
  errorsLast30Days: number;
  supportSessionsLast30Days: number;
}

const DAY = 86_400_000;

export async function adoptionFor(facilityIds?: string[], now = new Date()): Promise<Map<string, Adoption>> {
  const facilities = await prisma.facility.findMany({ where: facilityIds ? { id: { in: facilityIds } } : { active: true }, select: { id: true, createdAt: true } });
  const ids = facilities.map((f) => f.id);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const last = m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
  const monthAgo = new Date(now.getTime() - 30 * DAY);

  const [published, signIns, accounts, staff, errors, sessions] = await Promise.all([
    prisma.roster.findMany({ where: { facilityId: { in: ids }, status: "PUBLISHED", OR: [{ year: y, month: m }, { year: last.year, month: last.month }] }, select: { facilityId: true, year: true, month: true } }),
    prisma.userProfile.groupBy({ by: ["facilityId"], where: { facilityId: { in: ids } }, _max: { lastSignInAt: true } }),
    prisma.userProfile.groupBy({ by: ["facilityId"], where: { facilityId: { in: ids }, active: true, staffId: { not: null } }, _count: { _all: true } }),
    prisma.staff.groupBy({ by: ["facilityId"], where: { facilityId: { in: ids }, status: "ACTIVE" }, _count: { _all: true } }),
    prisma.errorReport.groupBy({ by: ["facilityId"], where: { facilityId: { in: ids }, createdAt: { gte: monthAgo } }, _count: { _all: true } }),
    prisma.supportSession.groupBy({ by: ["facilityId"], where: { facilityId: { in: ids }, startedAt: { gte: monthAgo } }, _count: { _all: true } }),
  ]);
  const lastPub = await prisma.roster.groupBy({ by: ["facilityId"], where: { facilityId: { in: ids }, status: "PUBLISHED" }, _max: { publishedAt: true } });

  const out = new Map<string, Adoption>();
  for (const f of facilities) {
    const thisMonth = published.filter((r) => r.facilityId === f.id && r.year === y && r.month === m).length;
    const lastMonth = published.filter((r) => r.facilityId === f.id && r.year === last.year && r.month === last.month).length;
    const lastIn = signIns.find((s) => s.facilityId === f.id)?._max.lastSignInAt ?? null;
    const daysSince = lastIn ? Math.floor((now.getTime() - lastIn.getTime()) / DAY) : null;
    const ageDays = Math.floor((now.getTime() - f.createdAt.getTime()) / DAY);
    // A facility set up this month has not had a chance to publish last month's roster.
    const startOfLast = Date.UTC(last.year, last.month - 1, 1);
    const oldEnough = f.createdAt.getTime() < startOfLast;
    const why: string[] = [];
    let health: Health = "HEALTHY";
    if (oldEnough && lastMonth === 0) { health = "AT_RISK"; why.push("No roster was published last month."); }
    if ((daysSince !== null && daysSince >= 21) || (daysSince === null && ageDays >= 21)) {
      health = "AT_RISK";
      why.push(daysSince === null ? "Nobody has ever signed in." : `Nobody has signed in for ${daysSince} days.`);
    }
    if (health !== "AT_RISK") {
      if (thisMonth === 0 && now.getUTCDate() > 15 && ageDays > 30) { health = "WATCH"; why.push("No roster published yet this month, and the month is more than half gone."); }
      if (daysSince !== null && daysSince >= 10) { health = "WATCH"; why.push(`Last sign-in was ${daysSince} days ago.`); }
    }
    if (health === "HEALTHY") why.push(thisMonth > 0 ? "A roster is published this month." : "Set up recently.");
    out.set(f.id, {
      health, why, rostersThisMonth: thisMonth, rostersLastMonth: lastMonth, daysSinceSignIn: daysSince,
      accountsActive: accounts.find((a) => a.facilityId === f.id)?._count._all ?? 0,
      staffActive: staff.find((a) => a.facilityId === f.id)?._count._all ?? 0,
      lastRosterPublishedAt: lastPub.find((a) => a.facilityId === f.id)?._max.publishedAt ?? null,
      lastSignInAt: lastIn,
      errorsLast30Days: errors.find((a) => a.facilityId === f.id)?._count._all ?? 0,
      supportSessionsLast30Days: sessions.find((a) => a.facilityId === f.id)?._count._all ?? 0,
    });
  }
  return out;
}
