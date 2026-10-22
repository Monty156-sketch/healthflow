"use client";

import { useResource } from "@/lib/useApi";
import { DistrictReading, type Reading } from "@/components/DistrictReading";
import { EmptyState, Loading, LoadError, PageHeader, StatusBadge, TD, TH, TableScroll } from "@/components/ui";

interface Data {
  reading: Reading;
  months: { year: number; month: number; label: string }[];
  facilities: { facilityId: string; name: string; months: { published: boolean; percent: number | null }[] }[];
}

/** 90 and over is on track, 70 to 89 needs a nudge, below that is behind. */
const tone = (p: number) => (p >= 90 ? "success" : p >= 70 ? "warning" : "block");

export default function DistrictAttendance() {
  const { data, error, reload } = useResource<Data>("/api/district/attendance");
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading attendance" />;
  return (
    <>
      <PageHeader title="Attendance" description="How much of each published roster has attendance recorded. This is completeness only. It does not show who was present or absent." />
      <DistrictReading reading={data.reading} />
      {data.facilities.length === 0 ? (
        <EmptyState title="Nothing to show">No facility has granted the attendance permission.</EmptyState>
      ) : (
        <TableScroll label="Attendance completeness by month">
          <table className="w-full min-w-[40rem] border-collapse text-[15px]">
            <thead>
              <tr>
                <th scope="col" className={TH}>Facility</th>
                {data.months.map((m) => (
                  <th key={`${m.year}-${m.month}`} scope="col" className={TH}>{m.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.facilities.map((f) => (
                <tr key={f.facilityId}>
                  <th scope="row" className={`${TD} text-left font-medium`}>{f.name}</th>
                  {f.months.map((m, i) => (
                    <td key={i} className={TD}>
                      {!m.published ? <StatusBadge tone="neutral">No roster</StatusBadge> : m.percent === null ? <span className="text-[var(--muted)]">Not yet counted</span> : <StatusBadge tone={tone(m.percent)}>{m.percent}% recorded</StatusBadge>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </>
  );
}
