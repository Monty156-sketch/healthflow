"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { Button, Field, Input, Loading, LoadError, Notice, PageHeader, TD, TH, TableScroll } from "@/components/ui";

interface Month {
  month: string; hasRoster: boolean; prepSeconds: number | null; conflictsDetected: number; blockingFound: number; overridden: number;
  unfilledOpen: number; amendments: number; amendmentReasons: string[]; attendanceCompletenessPercent: number | null;
  nightSpread: { cadre: string; stdev: number; staff: number }[]; swaps: Record<string, number>;
}
interface Data { note: string; months: Month[]; access: { activeStaff: number; signedInLast30Days: number } }

/** A small trend as a row of labelled horizontal bars. Every bar carries its number. */
function Trend({ values }: { values: (number | null)[] }) {
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  return (
    <span className="inline-flex items-end gap-0.5" aria-hidden="true">
      {values.map((v, i) => (
        <span key={i} className="w-2 bg-[var(--accent)]" style={{ height: `${Math.max(2, ((v ?? 0) / max) * 20)}px` }} />
      ))}
    </span>
  );
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function EvidencePage() {
  const [month, setMonth] = useState(thisMonth());
  const [consent, setConsent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { data, error, reload } = useResource<Data>(`/api/facility/coverage/evidence?month=${month}`);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Working out the figures" />;

  const rows: { label: string; get: (m: Month) => number | null; unit?: string }[] = [
    { label: "Roster preparation time", get: (m) => m.prepSeconds, unit: "seconds" },
    { label: "Conflicts detected before publication", get: (m) => (m.hasRoster ? m.conflictsDetected : null) },
    { label: "Blocking (statutory) findings caught", get: (m) => (m.hasRoster ? m.blockingFound : null) },
    { label: "Overrides granted", get: (m) => (m.hasRoster ? m.overridden : null) },
    { label: "Unfilled shifts still open", get: (m) => (m.hasRoster ? m.unfilledOpen : null) },
    { label: "Amendments after publication", get: (m) => (m.hasRoster ? m.amendments : null) },
    { label: "Attendance completeness", get: (m) => m.attendanceCompletenessPercent, unit: "percent" },
    { label: "Swaps requested", get: (m) => (m.hasRoster ? Object.values(m.swaps).reduce((a, b) => a + b, 0) : null) },
    { label: "Swaps approved", get: (m) => (m.hasRoster ? (m.swaps.APPROVED ?? 0) : null) },
  ];
  const last = data.months[data.months.length - 1];

  async function csv(identifiable: boolean) {
    setProblem(null);
    try {
      await api.download(`/api/facility/coverage/evidence.csv?month=${month}${identifiable ? "&consent=confirmed" : ""}`, "evidence.csv");
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { message?: string }) : undefined;
      setProblem(b?.message ?? "The file could not be made. Try again.");
    }
  }

  return (
    <>
      <PageHeader title="Evidence report" description="Six months up to the chosen month." />
      <Notice>{data.note}</Notice>
      <div className="my-4 flex flex-wrap items-end gap-3">
        <div className="max-w-[12rem]">
          <Field label="Up to and including">{(a) => <Input {...a} type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />}</Field>
        </div>
        <Button variant="secondary" onClick={() => csv(false)}>Download CSV, no facility name</Button>
      </div>
      {problem && <Notice tone="block">{problem}</Notice>}
      <TableScroll label="Evidence by month">
        <table className="w-full min-w-[44rem] border-collapse text-[15px]">
          <thead>
            <tr>
              <th scope="col" className={TH}>Measure</th>
              {data.months.map((m) => (
                <th key={m.month} scope="col" className={TH}>{m.month}</th>
              ))}
              <th scope="col" className={TH}>Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row" className={`${TD} text-left font-medium`}>{r.label}{r.unit && <span className="text-sm font-normal text-[var(--muted)]"> ({r.unit})</span>}</th>
                {data.months.map((m) => (
                  <td key={m.month} className={`${TD} figures`}>{r.get(m) ?? "None"}</td>
                ))}
                <td className={TD}><Trend values={data.months.map((m) => r.get(m))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <section className="mt-6 space-y-2 text-[15px]">
        <h2 className="text-lg font-semibold">Reach</h2>
        <p>{data.access.signedInLast30Days} of {data.access.activeStaff} active staff have signed in during the last 30 days.</p>
        {last.nightSpread.length > 0 && (
          <>
            <h2 className="pt-2 text-lg font-semibold">Night duty spread, {last.month}</h2>
            <p className="text-[var(--muted)]">Lower means nights are spread more evenly.</p>
            <ul>{last.nightSpread.map((n) => <li key={n.cadre}>{n.cadre}: <span className="figures">{n.stdev}</span> across {n.staff} {n.staff === 1 ? "person" : "people"}</li>)}</ul>
          </>
        )}
        {last.amendmentReasons.length > 0 && (
          <>
            <h2 className="pt-2 text-lg font-semibold">Reasons for amendments, {last.month}</h2>
            <ul className="list-disc pl-5">{last.amendmentReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </>
        )}
      </section>
      <section className="mt-8 max-w-xl border-t border-[var(--border)] pt-4">
        <h2 className="text-lg font-semibold">Version with the facility name</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Only for use outside the facility with its written consent.</p>
        <label className="mt-3 flex min-h-11 items-start gap-3 text-[15px]">
          <input type="checkbox" className="mt-1 size-5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>I confirm that the facility has given written consent for these figures to be shared with its name on them.</span>
        </label>
        <div className="mt-3"><Button disabled={!consent} onClick={() => csv(true)}>Download CSV with facility name</Button></div>
      </section>
    </>
  );
}
