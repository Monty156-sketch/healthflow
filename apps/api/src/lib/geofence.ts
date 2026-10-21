// Clock in and out inside the facility's own area. The administrator saves the facility's
// coordinates and a radius; a member of staff is let in when their phone is inside it.
// Only how far from the centre they were is kept, never where they were.
const EARTH_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Straight-line distance in metres between two points on the earth. */
export function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A phone reports how sure it is of its position. Doubt is allowed for up to 100 m, so a poor fix does not shut out someone who is at the door. */
export function insideArea(distanceM: number, radiusM: number, accuracyM: number | null | undefined): boolean {
  return distanceM - Math.min(Math.max(accuracyM ?? 0, 0), 100) <= radiusM;
}
