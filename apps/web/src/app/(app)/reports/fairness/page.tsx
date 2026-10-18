"use client";

import { useState } from "react";
import { useFacility } from "@/components/AppShell";
import { api } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import type { FairMeans, FairnessReport } from "@/lib/types";
import { Button, EmptyState, Field, Input, Loading, LoadError, Notice, PageHeader, Panel } from "@/components/ui";

const thisMonth = () => new Date().toISOString().slice(0, 7);
const MEASURES: { key: keyof FairMeans; label: string }[] = [
  { key: "duties", label: "Total duties" },
  { key: "nights", label: "Night duties" },
  { key: "weekends", label: "Weekend duties" },
  { key: "holidays", label: "Holiday duties" },
  { key: "hours", label: "Hours" },
];
const dev = (v: number, mean: number) => {
  const d = Math.round((v - mean) * 10) / 10;
  return d === 0 ? "at the average" : `${Math.abs(d)} ${d > 0 ? "above" : "below"} the average`;
};

/** A horizontal bar for one person, with the cadre mean marked and the value written on it. */
function Bar({ label, value, mean, max }: { label: string; value: number; mean: number; max: number }) {
  const pct = (n: number) => `${Math.min(100, (n / Math.max(max, 1)) * 100)}%`;
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-center gap-3 text-sm sm:grid-cols-[9rem_1fr_11rem]">
      <span className="text-[var(--muted)]">{label}</span>
      <div className="relative h-4 rounded-[2px] bg-[var(--accent-soft)]" role="img" aria-label={`${label}: ${value}, cadre average ${mean}`}>
        <div className="h-4 rounded-[2px] bg-[var(--accent)]" style={{ width: pct(value) }} />
        <div className="absolute inset-y-[-3px] w-[2px] bg-[var(--foreground)] opacity-60" style={{ left: pct(mean) }} title={`Cadre average ${mean}`} />
      </div>
      <span className="figures col-span-2 sm:col-span-1">
        <strong>{value}</strong> <span className="text-[var(--muted)]">average {mean}, {dev(value, mean)}</span>
      </span>
    </div>
  );
}

export default function FairnessPage() {
  const facility = useFacility();
  const [month, setMonth] = useState(thisMonth());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { data, error, reload } = useResource<FairnessReport>(`/api/facility/reports/fairness?month=${month}`);
  const manager = facility.me.role !== "STAFF";

  async function csv() {
    setBusy(true);
    setProblem(null);
    try {
      await api.download(`/api/facility/reports/fairness.csv?month=${month}`, `fairness-${month}.csv`);
    } catch {
      setProblem("The file could not be made. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={manager ? "Fairness report" : "Why this duty"}
        description={manager ? "Three months up to the month chosen, because one month is too short to judge fairness. Published and approved rosters only." : "Your duties over three months against the average for your cadre. You see yourself only, not your colleagues."}
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="max-w-[12rem]">
          <Field label="Up to and including">{(a) => <Input {...a} type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />}</Field>
        </div>
        {manager && <Button variant="secondary" disabled={busy} onClick={csv}>{busy ? "Preparing CSV…" : "Download CSV"}</Button>}
      </div>
      {problem && <div className="mb-4"><Notice tone="block">{problem}</Notice></div>}
      {error && !data ? (
        <LoadError onRetry={reload} />
      ) : !data ? (
        <Loading label="Working out the figures" />
      ) : data.monthsCovered === 0 ? (
        <EmptyState title="No approved roster in these three months">Fairness is worked out from approved or published rosters.</EmptyState>
      ) : (
        <div className="space-y-6">
          <p className="text-[15px] text-[var(--muted)]">
            {showDate(data.period.from)} to {showDate(data.period.to)}. {data.monthsCovered} of {data.monthsAsked} months have an approved roster.
          </p>
          {data.mine === null && !manager && <Notice tone="warning">Your account is not linked to a staff record, so there are no figures to show. Ask your in-charge.</Notice>}
          {data.mine && (
            <Panel title={`You, against ${data.mine.peers - 1 > 0 ? `the other ${data.mine.cadre.toLowerCase()} staff` : "your cadre"}`} description="The dark mark on each bar is the cadre average.">
              <div className="space-y-3">
                {MEASURES.map((m) => (
                  <Bar key={m.key} label={m.label} value={data.mine!.me[m.key]} mean={data.mine!.means[m.key]} max={Math.max(data.mine!.me[m.key], data.mine!.means[m.key]) * 1.25} />
                ))}
              </div>
            </Panel>
          )}
          {!manager && (
            <Panel title="How duties are allocated">
              <ol className="list-decimal space-y-1 pl-5 text-[15px]">
                <li>Who is eligible for the shift, by cadre and department.</li>
                <li>Who is on leave, and who has other approved time away.</li>
                <li>The rest rules: the minimum rest between duties, a weekly rest, and limits on duty days and nights in a row.</li>
                <li>Then an even spread of nights, weekends and holidays across everyone left, counted over three months.</li>
              </ol>
              <p className="mt-3 text-sm text-[var(--muted)]">If a figure above looks wrong to you, say so to your in-charge. It is a conversation about coverage, not a ranking of colleagues.</p>
            </Panel>
          )}
          {data.cadres?.map((c) => {
            const max = Math.max(1, ...c.people.flatMap((p) => MEASURES.map((m) => p[m.key]))) * 1.1;
            return (
              <Panel key={c.cadre} title={c.cadre} description={c.sentence ?? undefined}>
                <p className="mb-3 text-sm text-[var(--muted)]">Most duties first. Each bar is one person; the dark mark is the {c.cadre.toLowerCase()} average.</p>
                <ul className="space-y-5">
                  {c.people.map((p) => (
                    <li key={p.staffId}>
                      <p className="mb-1 text-[15px] font-medium">{p.name}</p>
                      <div className="space-y-1.5">
                        {MEASURES.map((m) => (
                          <Bar key={m.key} label={m.label} value={p[m.key]} mean={c.means[m.key]} max={max} />
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
