"use client";

import Link from "next/link";
import { useState } from "react";
import { useResource } from "@/lib/useApi";
import { SwapAsk } from "@/components/SwapAsk";
import { ClockCard } from "@/components/ClockCard";
import { ButtonLink, Button, EmptyState, Loading, LoadError, Notice, PageHeader, Panel } from "@/components/ui";

interface Today {
  linked: boolean;
  next?: { id: string; date: string; label: string; shift: string; start: string; end: string; onDutyNow: boolean; minutesUntil: number; minutesLeft: number | null } | null;
  week?: { id: string; date: string; label: string; shift: string; start: string; end: string }[];
  cycle?: { dayInRun: number; runLength: number | null; nextOffDays: string[] } | null;
  leave?: { type: string; entitled: number; taken: number; remaining: number }[];
  swaps?: { id: string; status: string; mine: boolean; assignmentId: string }[];
}

const until = (m: number) => {
  if (m < 60) return `in ${m} minutes`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h} ${h === 1 ? "hour" : "hours"}${m % 60 ? ` ${m % 60} minutes` : ""}`;
  const d = Math.floor(h / 24);
  return `in ${d} ${d === 1 ? "day" : "days"}`;
};
const SWAP_WORD: Record<string, string> = { REQUESTED: "waiting for a reply", ACCEPTED: "accepted, waiting for approval" };

export default function TodayPage() {
  const { data, error, reload } = useResource<Today>("/api/facility/me/today");
  const [asking, setAsking] = useState(false);
  const [sent, setSent] = useState(false);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading your duties" />;
  if (!data.linked) return <Notice>Your login is not linked to a staff record yet. Ask your facility administrator.</Notice>;
  const n = data.next;
  return (
    <>
      <PageHeader title="Today" />
      <ClockCard />
      <section aria-labelledby="next-duty" className="mb-6 rounded-[var(--radius)] border-2 border-[var(--foreground)] bg-[var(--surface)] p-5">
        <h2 id="next-duty" className="text-base font-medium text-[var(--muted)]">{n?.onDutyNow ? "You are on duty now" : "Your next duty"}</h2>
        {n ? (
          <>
            <p className="mt-1 text-4xl leading-tight font-bold">{n.shift}</p>
            <p className="figures mt-1 text-2xl font-semibold">{n.start} to {n.end}</p>
            <p className="mt-1 text-xl">{n.label}</p>
            <p className="mt-2 text-xl font-semibold">{n.onDutyNow ? `${until(n.minutesLeft ?? 0).replace("in ", "")} left` : `Starts ${until(n.minutesUntil)}`}</p>
            {!n.onDutyNow && (
              <div className="mt-4">
                <Button onClick={() => setAsking(true)} className="min-h-12 w-full sm:w-auto">Request a swap</Button>
              </div>
            )}
            {sent && <p className="mt-3 text-[15px]">Your swap request was sent.</p>}
          </>
        ) : (
          <p className="mt-2 text-xl">Nothing is rostered for you yet.</p>
        )}
      </section>
      {asking && n && (
        <div className="mb-6">
          <SwapAsk assignmentId={n.id} onDone={(s) => { setAsking(false); setSent(s); reload(); }} />
        </div>
      )}
      {data.swaps && data.swaps.length > 0 && (
        <div className="mb-6">
          <Notice action={<Link href="/swaps" className="text-[var(--accent-text)] underline">See swaps</Link>}>
            {data.swaps.length === 1 ? `A swap you are part of is ${SWAP_WORD[data.swaps[0].status] ?? "open"}.` : `${data.swaps.length} swaps you are part of are open.`}
          </Notice>
        </div>
      )}
      {data.cycle && (
        <p className="mb-6 text-lg">
          {data.cycle.dayInRun > 0 ? `Day ${data.cycle.dayInRun}${data.cycle.runLength ? ` of ${data.cycle.runLength}` : ""} on duty. ` : "You are off today. "}
          {data.cycle.nextOffDays.length > 0 && `Your next off days are ${data.cycle.nextOffDays.join(" and ")}.`}
        </p>
      )}
      <Panel title="The next seven days">
        {data.week && data.week.length > 0 ? (
          <ul className="divide-y divide-[var(--border)]">
            {data.week.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-3 text-lg">
                <span className="font-medium">{d.label}</span>
                <span className="figures">{d.shift}, {d.start} to {d.end}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No duties in the next seven days" />
        )}
      </Panel>
      {data.leave && data.leave.length > 0 && (
        <div className="mt-6">
          <Panel title="Your leave this year">
            <ul className="text-lg">
              {data.leave.map((l) => (
                <li key={l.type} className="flex justify-between gap-4 py-1">
                  <span>{l.type}</span>
                  <span className="figures">{l.remaining} of {l.entitled} days left</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        <ButtonLink href="/leave" variant="secondary">Request leave</ButtonLink>
        <ButtonLink href="/my-duties" variant="secondary">My duties for the month</ButtonLink>
      </div>
    </>
  );
}
