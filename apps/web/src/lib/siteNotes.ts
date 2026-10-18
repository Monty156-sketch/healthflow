// Written by hand, on purpose. An honestly maintained list is worth more than none.

export interface Incident {
  date: string;
  title: string;
  detail: string;
  resolved?: string;
}
export const INCIDENTS: Incident[] = [];

export interface Release {
  date: string;
  title: string;
  points: string[];
}
export const RELEASES: Release[] = [
  {
    date: "18 October 2026",
    title: "Swaps across two months",
    points: [
      "When someone is on leave near the end of a month, an exchange can now be with a duty in the following month's roster.",
      "Sick leave now asks the person to confirm the day they are back, instead of the in-charge fixing a date.",
    ],
  },
  {
    date: "17 October 2026",
    title: "Leave, cover and returns",
    points: [
      "Leave that takes someone off published duties shows swap options first and cover after, with what each does to the duty ledger.",
      "After a return is confirmed, the in-charge can see a proposal that puts the person back on the rest of the month at a fair share.",
      "The roster generator now takes the duty ledger into account, and debts settle when a roster is published.",
      "Excel export of the roster, with a compliance report and a fairness report.",
    ],
  },
  {
    date: "October 2026",
    title: "Duty swaps, daily attendance and notifications",
    points: [
      "Staff can ask a colleague to swap a duty, and the in-charge approves it after the system has checked it again.",
      "Daily attendance is recorded against the published roster.",
      "Staff see their own duties on a phone and are told when something changes.",
    ],
  },
];
