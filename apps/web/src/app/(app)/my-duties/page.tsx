"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { MONTHS, showDate } from "@/lib/format";
import type { MyDuties } from "@/lib/types";
import { SwapAsk } from "@/components/SwapAsk";
import { Button, EmptyState, Field, Loading, LoadError, Notice, PageHeader, Select, StatusBadge, Textarea } from "@/components/ui";

const WORDS: Record<string, string> = { PRESENT: "Present", LATE: "Late", ABSENT: "Absent", EXCUSED: "Excused" };

function Correction({ id, onDone }: { id: string; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/api/facility/my-duties/${id}/correction`, { note });
      onDone();
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { fields?: Record<string, string>; message?: string }) : undefined;
      setErr(b?.fields?.note ?? b?.message ?? "It was not sent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2 space-y-2">
      <Field label="What is wrong?" error={err ?? undefined}>{(a) => <Textarea {...a} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      <div className="flex gap-2">
        <Button disabled={busy} onClick={send}>Send to my in-charge</Button>
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

export default function MyDutiesPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [open, setOpen] = useState<string | null>(null);
  const [swapping, setSwapping] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [swapSent, setSwapSent] = useState(false);
  const { data, error, reload } = useResource<MyDuties>(`/api/facility/my-duties?month=${year}-${String(month).padStart(2, "0")}`);
  const years = Array.from({ length: 3 }, (_, i) => now.getFullYear() - 1 + i);

  return (
    <>
      <PageHeader title="My duties" description="Your published duties, and the attendance recorded for each." />
      <div className="mb-4 flex gap-3">
        <div>
          <label htmlFor="md-month" className="mb-1 block text-sm font-medium">Month</label>
          <Select id="md-month" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => (<option key={m} value={i + 1}>{m}</option>))}
          </Select>
        </div>
        <div>
          <label htmlFor="md-year" className="mb-1 block text-sm font-medium">Year</label>
          <Select id="md-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (<option key={y}>{y}</option>))}
          </Select>
        </div>
      </div>
      {swapSent && <div className="mb-4"><Notice tone="success">Swap request sent. You will be told when they answer. See Duty swaps.</Notice></div>}
      {sent && <div className="mb-4"><Notice tone="success">Sent. Your in-charge will see it with the date.</Notice></div>}
      {error && !data ? (
        <LoadError onRetry={reload} />
      ) : !data ? (
        <Loading label="Loading your duties" />
      ) : !data.linked ? (
        <Notice tone="warning">Your account is not linked to a staff record yet, so there are no duties to show. Ask your in-charge to link it.</Notice>
      ) : data.duties.length === 0 ? (
        <EmptyState title="No published duties">There is nothing published for you in {MONTHS[month - 1]} {year}.</EmptyState>
      ) : (
        <ul className="divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
          {data.duties.map((d) => (
            <li key={d.assignmentId} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[15px]">
                  <span className="figures font-medium">{showDate(d.date)}</span>, {d.shift.name}
                  {d.shift.startTime && d.shift.endTime ? <span className="text-[var(--muted)]"> {d.shift.startTime} to {d.shift.endTime}</span> : null}
                </p>
                {d.attendance ? (
                  <StatusBadge tone={d.attendance.status === "PRESENT" ? "success" : d.attendance.status === "ABSENT" ? "block" : "warning"}>
                    {WORDS[d.attendance.status] ?? d.attendance.status}
                    {d.attendance.minutesLate ? `, ${d.attendance.minutesLate} min` : ""}
                  </StatusBadge>
                ) : (
                  <span className="text-sm text-[var(--muted)]">{d.past ? "Not recorded" : "Coming up"}</span>
                )}
              </div>
              {d.attendance?.corrected && <p className="mt-1 text-sm text-[var(--muted)]">This record was corrected.</p>}
              {d.attendance && open !== d.assignmentId && (
                <button type="button" onClick={() => { setOpen(d.assignmentId); setSent(false); }} className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-[var(--accent-text)] underline-offset-4 hover:underline">
                  This is wrong
                </button>
              )}
              {!d.past && !d.attendance && swapping !== d.assignmentId && (
                <button type="button" onClick={() => { setSwapping(d.assignmentId); setSent(false); }} className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-[var(--accent-text)] underline-offset-4 hover:underline">
                  Swap this duty
                </button>
              )}
              {swapping === d.assignmentId && <SwapAsk assignmentId={d.assignmentId} onDone={(ok) => { setSwapping(null); if (ok) setSwapSent(true); }} />}
              {open === d.assignmentId && <Correction id={d.assignmentId} onDone={() => { setOpen(null); setSent(true); }} />}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
