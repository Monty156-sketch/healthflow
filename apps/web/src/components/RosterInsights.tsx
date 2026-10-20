"use client";

// Two things a roster manager asks of a finished roster: where are we short and
// what would fix it, and is the work shared fairly. Both are read from the
// roster as it stands, so they follow every edit.
import { useResource } from "@/lib/useApi";
import type { RosterInsights as Insights } from "@/lib/types";
import { Loading, LoadError, Notice, Panel, StatusBadge, TD, TH, TableScroll } from "@/components/ui";

export function RosterInsights({ rosterId, stamp }: { rosterId: string; stamp: string }) {
  const { data, error, reload } = useResource<Insights>(`/api/facility/rosters/${rosterId}/insights?s=${stamp}`);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Reading the roster" />;
  const widest = Math.max(1, ...data.workload.map((w) => w.hours));
  const byCadre = new Map<string, Insights["workload"]>();
  for (const w of data.workload) byCadre.set(w.cadreName, [...(byCadre.get(w.cadreName) ?? []), w]);
  const average = new Map(data.cadres.map((c) => [c.cadreName, c.averageHours]));

  return (
    <div className="space-y-5">
      {data.advice.length > 0 && (
        <Panel title="Where the roster is short" description="Cadre places this roster could not fill.">
          <div className="space-y-4">
            {data.advice.map((a) => (
              <section key={a.cadreId} aria-label={`${a.cadreName} cover`}>
                <p className="text-[15px] font-medium">{a.headline}</p>
                <p className="mt-2 text-sm font-medium text-[var(--muted)]">What would close it</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px]">
                  {a.options.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Workload" description="Hours per person. The line marks the cadre average.">
        {data.workload.length === 0 ? (
          <Notice>No staff on this roster yet.</Notice>
        ) : (
          <div className="space-y-5">
            {[...byCadre.entries()].map(([cadre, people]) => (
              <TableScroll key={cadre} label={`${cadre} workload`}>
                <table className="w-full min-w-[40rem] border-collapse text-[15px]">
                  <caption className="px-3 pb-2 text-left text-sm font-semibold">
                    {cadre} <span className="figures font-normal text-[var(--muted)]">average {average.get(cadre) ?? 0} hours</span>
                  </caption>
                  <thead>
                    <tr>
                      {["Name", "Hours", "Duties", "Nights", "Weekends", "Holidays", "Leave days"].map((h) => (
                        <th key={h} scope="col" className={TH}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((w) => (
                      <tr key={w.staffId}>
                        <th scope="row" className={`${TD} text-left font-medium`}>
                          <span className="block">{w.name}</span>
                          {w.restriction && <span className="block text-sm font-normal text-[var(--muted)]">{w.restriction}</span>}
                          {w.note && (
                            <span className="mt-1 block text-sm font-normal">
                              <StatusBadge tone="warning">{w.against === "above" ? "Above average" : "Below average"}</StatusBadge> <span className="text-[var(--muted)]">{w.note}</span>
                            </span>
                          )}
                        </th>
                        <td className={`${TD} figures`}>
                          <span className="flex items-center gap-2">
                            <span className="relative block h-2.5 w-28 rounded-[3px] bg-[var(--surface-2)]" aria-hidden="true">
                              <span className="absolute inset-y-0 left-0 rounded-[3px] bg-[var(--accent)]" style={{ width: `${(w.hours / widest) * 100}%` }} />
                              <span className="absolute -inset-y-0.5 w-px bg-[var(--foreground)]" style={{ left: `${((average.get(cadre) ?? 0) / widest) * 100}%` }} />
                            </span>
                            {w.hours}
                          </span>
                        </td>
                        <td className={`${TD} figures`}>{w.duties}</td>
                        <td className={`${TD} figures`}>{w.nights}</td>
                        <td className={`${TD} figures`}>{w.weekends}</td>
                        <td className={`${TD} figures`}>{w.holidays}</td>
                        <td className={`${TD} figures`}>{w.leaveDays}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            ))}
          </div>
        )}
        <p className="mt-3 text-sm text-[var(--muted)]">Above or below means more than 20% from the cadre average.</p>
      </Panel>
    </div>
  );
}
