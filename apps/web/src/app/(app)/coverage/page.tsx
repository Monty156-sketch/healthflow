"use client";

import Link from "next/link";
import { useState } from "react";
import { useResource } from "@/lib/useApi";
import { WardSelect } from "@/components/WardSelect";
import { showDate } from "@/lib/format";
import { EmptyState, Field, Input, Loading, LoadError, PageHeader, Panel, StatusBadge, TD, TH, TableScroll } from "@/components/ui";

interface Data {
  month: string;
  strip: { date: string; state: "OK" | "SHORT" | "CADRE" | "NO_ROSTER"; staffed: number; required: number; cadres: string[] }[];
  roster: { id: string; status: string } | null;
  wards?: { id: string; name: string }[];
  ward?: string | null;
  shifts: { id: string; name: string; code: string }[];
  days: { date: string; cells: { shiftId: string; staffed: number; required: number; state: "OK" | "SHORT" | "CADRE"; cadres: string[] }[] }[];
  unfilled: { date: string; shiftId: string; shift: string; staffed: number; required: number; state: "SHORT" | "CADRE"; cadres: string[] }[];
}

const WORD = { OK: "Covered", SHORT: "Short", CADRE: "Cadre short", NO_ROSTER: "No roster" } as const;
const TONE = { OK: "success", SHORT: "block", CADRE: "warning", NO_ROSTER: "neutral" } as const;
const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function CoveragePage() {
  const [month, setMonth] = useState(thisMonth());
  const [ward, setWard] = useState("");
  const { data, error, reload } = useResource<Data>(`/api/facility/coverage?month=${month}${ward ? `&ward=${ward}` : ""}`);
  if (error && !data) return <LoadError onRetry={reload} />;
  return (
    <>
      <PageHeader title="Coverage" description="Red: short of the minimum. Amber: short of a cadre." />
      {!data ? (
        <Loading label="Working out coverage" />
      ) : (
        <div className="space-y-6">
          <Panel title="The next seven days">
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {data.strip.map((d) => (
                <li key={d.date} className="rounded-[var(--radius)] border border-[var(--border)] p-2 text-sm">
                  <p className="figures font-medium">{showDate(d.date)}</p>
                  <StatusBadge tone={TONE[d.state]}>{WORD[d.state]}</StatusBadge>
                  {d.state !== "NO_ROSTER" && <p className="figures mt-1 text-[var(--muted)]">{d.staffed} of {d.required}</p>}
                  {d.state === "CADRE" && <p className="text-[var(--muted)]">{d.cadres.join(", ")}</p>}
                </li>
              ))}
            </ul>
          </Panel>
          <div className="flex flex-wrap items-end gap-3">
            <div className="max-w-[12rem]">
              <Field label="Month">{(a) => <Input {...a} type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />}</Field>
            </div>
            {/* Each ward has its own minimums, so coverage is read one ward at a time. */}
            <WardSelect value={ward || data.ward || ""} onChange={setWard} allLabel={null} wards={data.wards} />
          </div>
          {!data.roster ? (
            <EmptyState title="No roster for this month">Coverage is worked out from the roster for the month.</EmptyState>
          ) : (
            <>
              <Panel title="Unfilled shifts">
                {data.unfilled.length === 0 ? (
                  <p className="text-[15px]">Every shift has its minimum.</p>
                ) : (
                  <ul className="divide-y divide-[var(--border)] text-[15px]">
                    {data.unfilled.map((u) => (
                      <li key={`${u.date}${u.shiftId}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span>
                          <span className="figures font-medium">{showDate(u.date)}</span> {u.shift}: {u.staffed} of {u.required}{u.cadres.length > 0 && `, short of ${u.cadres.join(", ")}`}
                        </span>
                        <span className="flex items-center gap-3">
                          <StatusBadge tone={TONE[u.state]}>{WORD[u.state]}</StatusBadge>
                          <Link href={`/roster/${data.roster!.id}`} className="text-[var(--accent-text)] underline-offset-2 hover:underline">Open the roster</Link>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              <TableScroll label="Coverage by date and shift">
                <table className="w-full min-w-[32rem] border-collapse text-[15px]">
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>Date</th>
                      {data.shifts.map((s) => (
                        <th key={s.id} scope="col" className={TH}>{s.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map((d) => (
                      <tr key={d.date}>
                        <th scope="row" className={`${TD} figures text-left font-medium whitespace-nowrap`}>{showDate(d.date)}</th>
                        {d.cells.map((c) => (
                          <td key={c.shiftId} className={TD}>
                            <StatusBadge tone={TONE[c.state]}>{WORD[c.state]}</StatusBadge>
                            <span className="figures ml-2 text-sm text-[var(--muted)]">{c.staffed} of {c.required}</span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </>
          )}
        </div>
      )}
    </>
  );
}
