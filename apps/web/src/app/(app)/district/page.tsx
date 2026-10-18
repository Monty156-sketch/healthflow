"use client";

import Link from "next/link";
import { useResource } from "@/lib/useApi";
import { DistrictReading, type Reading } from "@/components/DistrictReading";
import { Loading, LoadError, Notice, PageHeader, Panel } from "@/components/ui";

interface Dash {
  reading: Reading;
  facilitiesGranted: number;
  staffOnDutyNow: number;
  shortDaysNext24Hours: number;
  nextMonthNotPublished: string[];
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
          <Panel title="Next month&apos;s roster not yet published">
            {data.nextMonthNotPublished.length === 0 ? (
              <p className="text-[15px]">Every facility has published next month&apos;s roster.</p>
            ) : (
              <ul className="list-disc pl-5 text-[15px]">
                {data.nextMonthNotPublished.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </Panel>
          <p className="mt-6 text-[15px]">
            <Link href="/district/coverage" className="text-[var(--accent-text)] underline-offset-2 hover:underline">Open the coverage monitor</Link>
          </p>
        </>
      )}
    </>
  );
}
