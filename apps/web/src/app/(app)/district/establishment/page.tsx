"use client";

import { useResource } from "@/lib/useApi";
import { DistrictReading, type Reading } from "@/components/DistrictReading";
import { EmptyState, Loading, LoadError, PageHeader, Panel, TD, TH, TableScroll } from "@/components/ui";

interface Data {
  reading: Reading;
  facilities: { facilityId: string; name: string; cadres: { cadre: string; approved: number; filled: number; vacancies: number }[] }[];
}

export default function DistrictEstablishment() {
  const { data, error, reload } = useResource<Data>("/api/district/establishment");
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading establishment" />;
  return (
    <>
      <PageHeader title="Establishment and vacancies" description="Approved posts against staff in post, by cadre. Approved posts are entered by each facility." />
      <DistrictReading reading={data.reading} />
      {data.facilities.length === 0 ? (
        <EmptyState title="Nothing to show">No facility has granted the staffing permission.</EmptyState>
      ) : (
        <div className="space-y-6">
          {data.facilities.map((f) => (
            <Panel key={f.facilityId} title={f.name}>
              {f.cadres.length === 0 ? (
                <p className="text-[15px] text-[var(--muted)]">This facility has not entered approved posts yet.</p>
              ) : (
                <TableScroll label={`Establishment at ${f.name}`}>
                  <table className="w-full min-w-[28rem] border-collapse text-[15px]">
                    <thead>
                      <tr>
                        {["Cadre", "Approved", "In post", "Vacancies"].map((h) => (
                          <th key={h} scope="col" className={TH}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {f.cadres.map((c) => (
                        <tr key={c.cadre}>
                          <th scope="row" className={`${TD} text-left font-medium`}>{c.cadre}</th>
                          <td className={`${TD} figures`}>{c.approved}</td>
                          <td className={`${TD} figures`}>{c.filled}</td>
                          <td className={`${TD} figures`}>{c.vacancies}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              )}
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
