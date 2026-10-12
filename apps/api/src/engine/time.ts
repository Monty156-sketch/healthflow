import type { EShift } from "./types.js";

export const DAY_MIN = 1440;

export function dayOf(year: number, month: number, date: number): number {
  return Math.floor(Date.UTC(year, month - 1, date) / 86_400_000);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Monday is 1, Sunday is 0. */
export function weekdayOf(day: number): number {
  return new Date(day * 86_400_000).getUTCDay();
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "4 August" */
export function sayDay(day: number): string {
  const d = new Date(day * 86_400_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function sayRange(a: number, b: number): string {
  if (a === b) return sayDay(a);
  const da = new Date(a * 86_400_000);
  const db = new Date(b * 86_400_000);
  return da.getUTCMonth() === db.getUTCMonth() ? `${da.getUTCDate()} to ${sayDay(b)}` : `${sayDay(a)} to ${sayDay(b)}`;
}

export function isoOf(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/** Minutes since the epoch at which a duty starts and ends. An overnight shift ends the next morning. */
export function interval(day: number, shift: EShift): { start: number; end: number } {
  const start = day * DAY_MIN + (shift.startMin ?? 0);
  return { start, end: start + shift.durationMin };
}

export function hoursOf(shift: EShift): number {
  const h = shift.durationMin / 60;
  return shift.isOnCall ? h * shift.onCallFactor : h;
}

export function hm(minutes: number): string {
  const h = minutes / 60;
  return Number.isInteger(h) ? `${h}` : h.toFixed(1);
}
