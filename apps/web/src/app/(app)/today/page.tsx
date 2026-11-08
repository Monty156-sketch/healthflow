"use client";

import Link from "next/link";
import { useState } from "react";
import { useResource } from "@/lib/useApi";
import { useOptionalFacility } from "@/components/AppShell";
import { SwapAsk } from "@/components/SwapAsk";
import { ClockCard } from "@/components/ClockCard";
import { ButtonLink, Button, EmptyState, Loading, LoadError, Notice, PageHeader } from "@/components/ui";

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

/** Ghana is on UTC all year, so the hour is read in UTC like every other time on screen. */
const greeting = () => {
  const h = new Date().getUTCHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};
const firstName = (full?: string) => (full ?? "").replace(/^(dr|mr|mrs|ms|miss|nurse|midwife)\.?\s+/i, "").split(/\s+/)[0];

export default function TodayPage() {
  const fac = useOptionalFacility();
  const { data, error, reload } = useResource<Today>("/api/facility/me/today");
  const [asking, setAsking] = useState(false);
  const [sent, setSent] = useState(false);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading your duties" />;
  if (!data.linked) return <Notice>Your login is not linked to a staff record yet. Ask your facility administrator.</Notice>;
  const n = data.next;
  return (
    <>
      <header className="mb-5">
        <h1 className="text-3xl font-semibold tracking-tight">{greeting()}{firstName(fac?.me.displayName) ? `, ${firstName(fac?.me.displayName)}` : ""}</h1>
        <p className="mt-1 text-lg text-[var(--muted)]">Welcome to HealthFlow. Here is your day.</p>
      </header>
      <ClockCard />
      <section aria-labelledby="next-duty" className="mb-6 overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-5 py-3">
          <span aria-hidden="true" className={`size-2.5 rounded-full ${n?.onDutyNow ? "bg-[var(--status-success)]" : "bg-[var(--accent)]"}`} />
          <h2 id="next-duty" className="text-[15px] font-medium text-[var(--muted)]">{n?.onDutyNow ? "You are on duty now" : "Your next duty"}</h2>
        </div>
        {n ? (
          <div className="px-5 py-5 sm:px-6">
            <p className="text-[2.5rem] leading-none font-semibold tracking-tight">{n.shift}</p>
            <p className="figures mt-3 text-2xl font-medium text-[var(--accent-text)]">{n.start} <span className="text-[var(--muted)]">to</span> {n.end}</p>
            <p className="mt-1 text-lg text-[var(--muted)]">{n.label}</p>
            <p className="mt-4 inline-block rounded-full bg-[var(--accent-soft)] px-4 py-1.5 text-base font-medium text-[var(--accent-text)]">
              {n.onDutyNow ? `${until(n.minutesLeft ?? 0).replace("in ", "")} left` : `Starts ${until(n.minutesUntil)}`}
            </p>
            {!n.onDutyNow && (
              <div className="mt-5">
                <Button variant="secondary" onClick={() => setAsking(true)} className="min-h-12 w-full sm:w-auto">Request a swap</Button>
              </div>
            )}
            {sent && <p className="mt-3 text-[15px]">Your swap request was sent.</p>}
          </div>
        ) : (
          <p className="px-5 py-6 text-lg text-[var(--muted)]">Nothing is rostered for you yet.</p>
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
      <section aria-labelledby="week-h" className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 id="week-h" className="mb-3 text-base font-semibold">The next seven days</h2>
        {data.week && data.week.length > 0 ? (
          <ul className="divide-y divide-[var(--border)]">
            {data.week.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-4 py-3.5">
                <span className="text-[17px] font-medium">{d.label}</span>
                <span className="text-right">
                  <span className="block text-[17px]">{d.shift}</span>
                  <span className="figures block text-sm text-[var(--muted)]">{d.start} to {d.end}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No duties in the next seven days" />
        )}
      </section>
      {data.leave && data.leave.length > 0 && (
        <div className="mt-6">
          <section aria-labelledby="leave-h" className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 id="leave-h" className="mb-3 text-base font-semibold">Your leave this year</h2>
            <ul className="space-y-4">
              {data.leave.map((l) => (
                <li key={l.type}>
                  <div className="flex justify-between gap-4 text-[17px]">
                    <span>{l.type}</span>
                    <span className="figures text-[var(--muted)]">{l.remaining} of {l.entitled} days left</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-2)] ring-1 ring-[var(--border)]" role="img" aria-label={`${l.remaining} of ${l.entitled} days left`}>
                    <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500" style={{ width: `${l.entitled > 0 ? Math.max(0, Math.min(100, (l.remaining / l.entitled) * 100)) : 0}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        <ButtonLink href="/leave" variant="secondary">Request leave</ButtonLink>
        <ButtonLink href="/my-duties" variant="secondary">My duties for the month</ButtonLink>
      </div>
    </>
  );
}
