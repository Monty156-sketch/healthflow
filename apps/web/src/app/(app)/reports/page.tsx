"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui";

const REPORTS = [
  { href: "/reports/compliance", title: "Compliance report", body: "Hours, duty days, nights, longest rest and rest breaches for every person in a month, every override with who approved it, and signature lines. PDF and CSV." },
  { href: "/reports/fairness", title: "Fairness report", body: "Night, weekend, holiday and total duties for each person over three, six or twelve months, against the average for their cadre. Staff see their own figures only. CSV." },
  { href: "/reports/allowances", title: "Duty days and allowances", body: "For each person in a month: duty days, each shift worked, nights, weekends, public holidays and hours, set against attendance. For the accounts office. Counts only, no rates. Workbook and CSV." },
  { href: "/reports/evidence", title: "Evidence report", body: "What HealthFlow did for this facility, month by month: preparation time, conflicts caught before publication, overrides, amendments, attendance and swaps." },
];

export default function ReportsPage() {
  return (
    <>
      <PageHeader title="Reports" description="Worked out from the roster." />
      <ul className="grid max-w-3xl gap-4 sm:grid-cols-2">
        {REPORTS.map((r) => (
          <li key={r.href} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="text-lg font-semibold">
              <Link href={r.href} className="text-[var(--accent-text)] underline-offset-4 hover:underline">
                {r.title}
              </Link>
            </h2>
            <p className="mt-1 text-[15px] text-[var(--muted)]">{r.body}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
