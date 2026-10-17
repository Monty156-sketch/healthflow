// How long someone is really away. A date passing is never a return: leave
// that is open-ended, or whose return day has gone by without anyone
// confirming they are back, keeps the person unavailable until it is resolved.
import type { ReturnStatus } from "@healthflow/db";

const DAY = 86_400_000;
export const FAR = 10_000_000; // "no end", as an epoch day

export interface LeaveLike {
  startDate: Date;
  endDate: Date;
  isOpenEnded: boolean;
  actualReturnDate: Date | null;
  returnStatus: ReturnStatus;
}

export const todayDay = () => Math.floor(Date.now() / DAY);

/** The last day the person is unavailable, as an epoch day. */
export function effectiveEnd(r: LeaveLike, today = todayDay()): number {
  const end = Math.floor(r.endDate.getTime() / DAY);
  if (r.actualReturnDate) return Math.floor(r.actualReturnDate.getTime() / DAY) - 1;
  if (r.isOpenEnded) return FAR;
  if (r.returnStatus === "CONFIRMED" || r.returnStatus === "RETURNED_EARLY" || r.returnStatus === "EXTENDED") return end; // an extension carries on from the next day
  if (today > end + 1) return FAR; // the return day went by and nobody confirmed
  return end;
}

/** Is this leave still keeping the person away from a given window? */
export function overlaps(r: LeaveLike, fromDay: number, toDay: number, today = todayDay()) {
  const start = Math.floor(r.startDate.getTime() / DAY);
  return start <= toDay && effectiveEnd(r, today) >= fromDay;
}
