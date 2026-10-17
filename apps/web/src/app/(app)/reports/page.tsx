"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui";

const REPORTS = [
  { href: "/reports/compliance", title: "Compliance report", body: "Hours, duty days, nights, longest rest and rest breaches for every person in a month, every override with who approved it, and signature lines. PDF and CSV." },
  { href: "/reports/fairness", title: "Fairness report", body: "Night, weekend, holiday and total duties for each person over three months, against the average for their cadre. Staff see their own figures only. CSV." },
];

export default function ReportsPage() {
  return (
    <>
      <PageHeader title="Reports" description="Every figure is worked out from the roster. The roster itself downloads as PDF or Excel from its own page." />
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
