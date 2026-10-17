// Returning from leave. The resumption date is worked out and shown with its
// arithmetic, but a person is only "back" when someone confirms it. A date
// passing moves the request to due, then overdue, and tells the people who run
// the roster. Status changes are stored the first time they are noticed, and
// that moment is also when the reminder goes out, so each reminder is sent once.
import type { ReturnStatus } from "@healthflow/db";
import { prisma } from "./prisma.js";
import { holidayDays } from "./holidays.js";
import { notifyDeciders, notifyStaff } from "./notify.js";
import { sayDay } from "../engine/time.js";
import { todayDay } from "./leaveWindow.js";

const DAY = 86_400_000;

export interface Resumption {
  date: number;
  lastLeaveDay: number;
  skippedHolidays: number;
  sentence: string;
}

/**
 * Where a stretch of leave ends and duty resumes. The count starts on the first
 * day. Public holidays are never counted as leave days, and on a working-day
 * basis neither are weekends. Duty resumes on the next day that is not a
 * holiday (or, on a working-day basis, a weekend).
 */
export async function resumptionOf(facilityId: string, startDay: number, days: number, basis: string): Promise<Resumption> {
  const holidays = await holidayDays(facilityId, startDay, startDay + days + 120);
  const working = basis === "WORKING_DAYS_MON_FRI";
  const off = (d: number) => {
    const wd = new Date(d * DAY).getUTCDay();
    return holidays.has(d) || (working && (wd === 0 || wd === 6));
  };
  let counted = 0;
  let d = startDay - 1;
  let skippedHolidays = 0;
  while (counted < days) {
    d++;
    if (holidays.has(d)) {
      skippedHolidays++;
      continue;
    }
    if (off(d)) continue;
    counted++;
  }
  const last = d;
  let resume = last + 1;
  while (off(resume)) resume++;
  const skipped = skippedHolidays === 0 ? "" : `, excluding ${skippedHolidays} public ${skippedHolidays === 1 ? "holiday" : "holidays"}`;
  const sentence = `${days} ${days === 1 ? "day" : "days"} from ${sayDay(startDay)}${skipped}${working ? " (weekends are not counted)" : ""}. Resumption of duty: ${sayDay(resume)}.`;
  return { date: resume, lastLeaveDay: last, skippedHolidays, sentence };
}

interface ReturnLike {
  endDate: Date;
  expectedReturnDate: Date | null;
  isOpenEnded: boolean;
  actualReturnDate: Date | null;
  returnStatus: ReturnStatus;
}

/** The day the person is expected back, as an epoch day, or null if open-ended. */
export function expectedBack(r: ReturnLike): number | null {
  if (r.isOpenEnded) return null;
  return r.expectedReturnDate ? Math.floor(r.expectedReturnDate.getTime() / DAY) : Math.floor(r.endDate.getTime() / DAY) + 1;
}

/** What the status is today, whatever is stored. */
export function liveStatus(r: ReturnLike, today = todayDay()): ReturnStatus {
  if (r.actualReturnDate) return r.returnStatus === "RETURNED_EARLY" ? "RETURNED_EARLY" : "CONFIRMED";
  if (r.returnStatus === "EXTENDED") return "EXTENDED";
  const back = expectedBack(r);
  if (back === null) return "NOT_DUE";
  if (today > back) return "OVERDUE";
  if (today >= back - 1) return "DUE";
  return "NOT_DUE";
}

/** Store status changes and send each reminder once. Safe to call often. */
export async function syncReturns(facilityId: string) {
  const today = todayDay();
  const rows = await prisma.leaveRequest.findMany({
    where: {
      facilityId, status: "APPROVED", actualReturnDate: null, isOpenEnded: false, returnStatus: { in: ["NOT_DUE", "DUE"] },
      endDate: { lte: new Date((today + 1) * DAY) },
    },
    include: { staff: { select: { fullName: true } }, leaveType: { select: { name: true } } },
  });
  for (const r of rows) {
    const next = liveStatus(r, today);
    if (next === r.returnStatus || next === "NOT_DUE") continue;
    const moved = await prisma.leaveRequest.updateMany({ where: { id: r.id, returnStatus: r.returnStatus }, data: { returnStatus: next } });
    if (moved.count === 0) continue;
    const back = expectedBack(r)!;
    if (next === "DUE") {
      const when = today >= back ? "today" : "tomorrow";
      const body = `${r.leaveType.name} leave ends ${when === "today" ? "now" : "tomorrow"}. Confirm the day they are back on duty.`;
      await notifyStaff(facilityId, r.staffId, { type: "return_due", title: `You are due back on duty ${when}`, body: `Your ${r.leaveType.name.toLowerCase()} leave ends. Report back when you resume.`, linkUrl: "/leave", severity: "ACTION" });
      await notifyDeciders(facilityId, { type: "return_due", title: `${r.staff.fullName} is due back ${when}`, body, linkUrl: "/returns", severity: "INFO" });
    } else if (next === "OVERDUE") {
      await notifyDeciders(facilityId, {
        type: "return_overdue", title: `${r.staff.fullName} has not been confirmed back`,
        body: `They were expected on ${sayDay(back)}. Until someone confirms, they stay off the roster. Confirm the return or extend the leave.`, linkUrl: "/returns", severity: "ACTION",
      });
    }
  }
}
