// Ties facilities to their district office by the district they chose at registration.
import { prisma } from "./prisma.js";

/** District names compare without the words people add or drop: "Wa Municipal" and "Wa" are the same district. */
export const districtKey = (s: string) => s.toLowerCase().replace(/\b(municipal|metropolitan|district|assembly)\b/g, "").replace(/[^a-z0-9]/g, "");

/**
 * When a district office is approved, every facility already waiting under its name
 * (same region, same agency, no office yet) is linked to it. Returns how many.
 */
export async function claimFacilitiesFor(d: { id: string; name: string; region: string; agency: string; level: string }): Promise<number> {
  if (d.level !== "DISTRICT") return 0;
  const key = districtKey(d.name);
  if (!key) return 0;
  const waiting = await prisma.facility.findMany({
    where: { districtId: null, agency: d.agency as never, region: { equals: d.region, mode: "insensitive" }, districtName: { not: null } },
    select: { id: true, districtName: true },
  });
  const ids = waiting.filter((f) => districtKey(f.districtName ?? "") === key).map((f) => f.id);
  if (ids.length === 0) return 0;
  await prisma.facility.updateMany({ where: { id: { in: ids }, districtId: null }, data: { districtId: d.id } });
  return ids.length;
}
