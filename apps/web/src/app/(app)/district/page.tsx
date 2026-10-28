"use client";

import Link from "next/link";
import { useResource } from "@/lib/useApi";
import { DistrictReading, type Reading } from "@/components/DistrictReading";
import { Loading, LoadError, Notice, PageHeader, Panel, StatusBadge, TD, TH, TableScroll } from "@/components/ui";

interface Dash {
  reading: Reading;
  facilitiesGranted: number;
  staffOnDutyNow: number;
  shortDaysNext24Hours: number;
  nextMonthNotPublished: string[];
  facilities: { facilityId: string; name: string; shortDays: number; noRosterDays: number; nextMonthPublished: boolean }[];
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="figures text-2xl font-semibold">{value}</p>
      <p className="text-sm text-[var(--muted)]">{label}</p>
    </div>
  );
}

export default function DistrictDashboard() {
  const { data, error, reload } = useResource<Dash>("/api/district/dashboard");
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading the district view" />;
  return (
    <>
      <PageHeader title="District overview" description="Only facilities that have granted access appear here. Everything on these screens is read only." />
      <DistrictReading reading={data.reading} />
      {data.facilitiesGranted === 0 ? (
        <Notice>No facility has given this district access yet. A facility administrator does that from the Directorate access page.</Notice>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <Figure label="Facilities that have granted access" value={data.facilitiesGranted} />
            <Figure label="Staff on duty now" value={data.staffOnDutyNow} />
            <Figure label="Facility days short of staff in the next 24 hours" value={data.shortDaysNext24Hours} />
          </div>
          <Panel title="Facilities, those needing attention first">
            <TableScroll label="Facilities compared">
              <table className="w-full min-w-[36rem] border-collapse text-[15px]">
                <thead>
                  <tr>
                    <th scope="col" className={TH}>Facility</th>
                    <th scope="col" className={TH}>Next 7 days</th>
                    <th scope="col" className={TH}>Next month&apos;s roster</th>
                  </tr>
                </thead>
                <tbody>
                  {data.facilities.map((f) => (
                    <tr key={f.facilityId}>
                      <th scope="row" className={`${TD} text-left font-medium`}>{f.name}</th>
                      <td className={TD}>
                        {f.shortDays > 0 ? <StatusBadge tone="block">{f.shortDays} {f.shortDays === 1 ? "day" : "days"} short</StatusBadge> : f.noRosterDays > 0 ? <StatusBadge tone="neutral">{f.noRosterDays} without a roster</StatusBadge> : <StatusBadge tone="success">Covered</StatusBadge>}
                      </td>
                      <td className={TD}>{f.nextMonthPublished ? <StatusBadge tone="success">Published</StatusBadge> : <StatusBadge tone="warning">Not published</StatusBadge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </Panel>
          <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[15px]">
            {[["/district/scorecard", "Performance scorecard"], ["/district/coverage", "Coverage monitor"], ["/district/establishment", "Establishment"], ["/district/attendance", "Attendance"], ["/district/compliance", "Compliance"], ["/district/reports", "Report pack"]].map(([h, l]) => (
              <li key={h}><Link href={h} className="text-[var(--accent-text)] underline-offset-2 hover:underline">{l}</Link></li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
