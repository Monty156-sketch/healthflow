"use client";

import { useResource } from "@/lib/useApi";
import { DistrictReading, type Reading } from "@/components/DistrictReading";
import { EmptyState, Loading, LoadError, PageHeader, StatusBadge, TD, TH, TableScroll } from "@/components/ui";

interface Day { date: string; state: "OK" | "SHORT" | "CADRE" | "NO_ROSTER"; staffed: number; required: number; cadres: string[] }
interface Data {
  reading: Reading;
  dates: { date: string; label: string }[];
  facilities: { facilityId: string; name: string; days: Day[] }[];
}

const TONE = { OK: "success", SHORT: "block", CADRE: "warning", NO_ROSTER: "neutral" } as const;
const WORD = { OK: "Covered", SHORT: "Short", CADRE: "Cadre short", NO_ROSTER: "No roster" } as const;

export default function DistrictCoverage() {
  const { data, error, reload } = useResource<Data>("/api/district/coverage");
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading coverage" />;
  return (
    <>
      <PageHeader title="Coverage monitor" description="Staff on the published roster against what each shift needs, for the next seven days. A day with no published roster is shown as such, not as covered." />
      <DistrictReading reading={data.reading} />
      {data.facilities.length === 0 ? (
        <EmptyState title="Nothing to show">No facility has granted the coverage permission.</EmptyState>
      ) : (
        <TableScroll label="Coverage for the next seven days">
          <table className="w-full min-w-[48rem] border-collapse text-[15px]">
            <thead>
              <tr>
                <th scope="col" className={TH}>Facility</th>
                {data.dates.map((d) => (
                  <th key={d.date} scope="col" className={TH}>{d.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.facilities.map((f) => (
                <tr key={f.facilityId}>
                  <th scope="row" className={`${TD} text-left font-medium`}>{f.name}</th>
                  {f.days.map((d) => (
                    <td key={d.date} className={TD}>
                      <StatusBadge tone={TONE[d.state]}>{WORD[d.state]}</StatusBadge>
                      {d.state !== "NO_ROSTER" && <span className="figures ml-2 text-sm text-[var(--muted)]">{d.staffed} of {d.required}</span>}
                      {d.state === "CADRE" && <span className="block text-sm text-[var(--muted)]">{d.cadres.join(", ")}</span>}
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
