"use client";

// Before generating: can these people cover these minimums, within the rest rules?
// A bound worked out from the facility's own numbers, so it can say what to change
// before the generator leaves gaps.
import { useResource } from "@/lib/useApi";
import { Loading, LoadError, Notice, Panel } from "@/components/ui";

interface Check {
  verdict: "OK" | "TIGHT" | "SHORT";
  headline: string;
  people: number;
  nightTakers: number;
  duties: { needed: number; possible: number };
  nights: { needed: number; possible: number; takersNeeded: number };
  peopleNeeded: number;
  hoursPerPerson: number;
  suggestions: string[];
}

export function StaffingCheck({ rosterId, stamp }: { rosterId: string; stamp: string }) {
  const { data, error, reload } = useResource<Check>(`/api/facility/rosters/${rosterId}/staffing?s=${stamp}`);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Checking staffing" />;
  const tone = data.verdict === "SHORT" ? "block" : data.verdict === "TIGHT" ? "warning" : "success";
  return (
    <Panel title="Staffing for this month" description="Checked before you generate.">
      <Notice tone={tone}>{data.headline}</Notice>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[15px] sm:grid-cols-4">
        <div>
          <dt className="text-sm text-[var(--muted)]">On the roster</dt>
          <dd className="figures">{data.people} people</dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--muted)]">Enough for these minimums</dt>
          <dd className="figures">about {data.peopleNeeded}</dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--muted)]">Take nights</dt>
          <dd className="figures">
            {data.nightTakers} of about {data.nights.takersNeeded} needed
          </dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--muted)]">Hours each, on average</dt>
          <dd className="figures">{data.hoursPerPerson}</dd>
        </div>
      </dl>
      {data.suggestions.length > 0 && (
        <>
          <p className="mt-4 text-sm font-medium text-[var(--muted)]">To fix it</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px]">
            {data.suggestions.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
