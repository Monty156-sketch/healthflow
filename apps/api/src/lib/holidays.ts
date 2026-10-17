// Public holidays. Each facility gets its own editable copy of the fixed
// statutory ones the first time they are needed. Movable ones (the Eid days)
// and any holiday moved off a weekend are NOT guessed: the facility adds them
// when the official notice is out.
import { prisma } from "./prisma.js";
import { writeAuditLog } from "./audit.js";

const DAY = 86_400_000;

/** Statutory holidays that fall on a weekday and so need no guesswork. Source: Ministry of the Interior list for 2026; 2027 worked out from the same fixed dates. */
export const SEED: { date: string; name: string }[] = [
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-01-07", name: "Constitution Day" },
  { date: "2026-03-06", name: "Independence Day" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-04-06", name: "Easter Monday" },
  { date: "2026-05-01", name: "Workers' Day" },
  { date: "2026-07-03", name: "Republic Day (observed)" },
  { date: "2026-09-21", name: "Founders' Day" },
  { date: "2026-12-04", name: "Farmers' Day" },
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2026-12-28", name: "Boxing Day (observed)" },
  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-01-07", name: "Constitution Day" },
  { date: "2027-03-26", name: "Good Friday" },
  { date: "2027-03-29", name: "Easter Monday" },
  { date: "2027-07-01", name: "Republic Day" },
  { date: "2027-09-21", name: "Founders' Day" },
  { date: "2027-12-03", name: "Farmers' Day" },
];

export async function ensureHolidays(facilityId: string) {
  const seeded = await prisma.auditLog.findFirst({ where: { facilityId, action: "holidays_seeded" }, select: { id: true } });
  if (seeded) return;
  await prisma.publicHoliday.createMany({ data: SEED.map((h) => ({ facilityId, date: new Date(`${h.date}T00:00:00Z`), name: h.name, year: Number(h.date.slice(0, 4)) })) });
  await writeAuditLog({
    facilityId, action: "holidays_seeded", entityType: "PublicHoliday",
    summary: "Ghana's fixed statutory public holidays for 2026 and 2027 were added to this facility. Eid days and holidays moved off a weekend were not added; add them when announced.",
  });
}

/** Holiday days (epoch days) between two days, this facility's own and any national ones. */
export async function holidayDays(facilityId: string, startDay: number, endDay: number): Promise<Set<number>> {
  await ensureHolidays(facilityId);
  const rows = await prisma.publicHoliday.findMany({
    where: { OR: [{ facilityId }, { facilityId: null }], date: { gte: new Date(startDay * DAY), lte: new Date(endDay * DAY) } },
    select: { date: true },
  });
  return new Set(rows.map((r) => Math.floor(r.date.getTime() / DAY)));
}
