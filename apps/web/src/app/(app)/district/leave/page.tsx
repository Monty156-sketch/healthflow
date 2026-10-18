"use client";

import { useResource } from "@/lib/useApi";
import { DistrictReading, type Reading } from "@/components/DistrictReading";
import { EmptyState, Loading, LoadError, Notice, PageHeader, TD, TH, TableScroll } from "@/components/ui";

interface Data {
  reading: Reading;
  weeks: { from: string; label: string; cadres: { cadre: string; away: number; total: number; concern: boolean }[] }[];
  threshold: number;
  suppressedGroups: number;
  note: string;
}

export default function DistrictLeave() {
  const { data, error, reload } = useResource<Data>("/api/district/leave-concentration");
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading leave" />;
  const cadres = data.weeks[0]?.cadres.map((c) => c.cadre) ?? [];
  return (
    <>
      <PageHeader title="Leave concentration" description={`Approved leave by cadre over the next eight weeks. A figure is marked when ${Math.round(data.threshold * 100)} percent or more of a cadre is away.`} />
      <DistrictReading reading={data.reading} />
      <Notice>{data.note}</Notice>
      <div className="mt-4">
        {cadres.length === 0 ? (
          <EmptyState title="Nothing to show">No facility has granted the staffing permission, or every cadre is too small to show.</EmptyState>
        ) : (
          <TableScroll label="Leave by cadre and week">
            <table className="w-full min-w-[40rem] border-collapse text-[15px]">
              <thead>
                <tr>
                  <th scope="col" className={TH}>Week</th>
                  {cadres.map((c) => (
                    <th key={c} scope="col" className={TH}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.weeks.map((w) => (
                  <tr key={w.from}>
                    <th scope="row" className={`${TD} text-left font-medium whitespace-nowrap`}>{w.label}</th>
                    {w.cadres.map((c) => (
                      <td key={c.cadre} className={`${TD} figures ${c.concern ? "font-semibold text-[var(--status-warning)]" : ""}`}>
                        {c.away} of {c.total}
                        {c.concern && <span className="ml-1 text-sm">high</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </div>
    </>
  );
}
