"use client";

import { useResource } from "@/lib/useApi";
import { DistrictReading, type Reading } from "@/components/DistrictReading";
import { EmptyState, Loading, LoadError, PageHeader, StatusBadge, TD, TH, TableScroll } from "@/components/ui";

interface Cell { published: boolean; blockingOpen: number; warningsOpen: number; overridden: number }
interface Data {
  reading: Reading;
  months: { year: number; month: number; label: string }[];
  facilities: { facilityId: string; name: string; months: Cell[] }[];
}

export default function DistrictCompliance() {
  const { data, error, reload } = useResource<Data>("/api/district/compliance");
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading compliance" />;
  return (
    <>
      <PageHeader title="Compliance" description="Open findings against the rest and working-hours rules on each published roster. Counts only. No names and no detail of individual staff." />
      <DistrictReading reading={data.reading} />
      {data.facilities.length === 0 ? (
        <EmptyState title="Nothing to show">No facility has granted the compliance permission.</EmptyState>
      ) : (
        <TableScroll label="Roster compliance by month">
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
                  {f.months.map((c, i) => (
                    <td key={i} className={TD}>
                      {!c.published ? (
                        <StatusBadge tone="neutral">No roster</StatusBadge>
                      ) : c.blockingOpen === 0 && c.warningsOpen === 0 ? (
                        <StatusBadge tone="success">No open findings</StatusBadge>
                      ) : (
                        <span className="flex flex-wrap gap-1.5">
                          {c.blockingOpen > 0 && <StatusBadge tone="block">{c.blockingOpen} blocking</StatusBadge>}
                          {c.warningsOpen > 0 && <StatusBadge tone="warning">{c.warningsOpen} to review</StatusBadge>}
                        </span>
                      )}
                      {c.published && c.overridden > 0 && <span className="figures mt-1 block text-sm text-[var(--muted)]">{c.overridden} accepted with a reason</span>}
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
