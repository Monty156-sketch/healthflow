"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { MONTHS } from "@/lib/format";
import type { AttendanceMonthCheck, AttendanceMonthItem } from "@/lib/types";
import { Button, EmptyState, Field, Loading, LoadError, Notice, PageHeader, Panel, Select, Textarea } from "@/components/ui";

const say = (i: AttendanceMonthItem) => {
  const status = i.status.toLowerCase().replace("_", " ");
  const when = i.clockedAt ? ` at ${i.clockedAt}${i.minutesLate ? `, ${i.minutesLate} min late` : i.minutesEarly ? `, ${i.minutesEarly} min early` : ""}` : "";
  return `${status}${when}`;
};

function Row({ item, children }: { item: AttendanceMonthItem; children?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
      <span>
        <Link href={`/attendance?date=${item.date}`} className="font-medium underline">{item.date}</Link>, {item.name}, {say(item)}
      </span>
      {children}
    </li>
  );
}

export default function CheckMonthPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const { data, error, reload } = useResource<AttendanceMonthCheck>(`/api/facility/attendance/month-check?month=${key}`);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
  const [why, setWhy] = useState("");
  const years = Array.from({ length: 4 }, (_, i) => now.getFullYear() - 2 + i);

  async function reopen() {
    setBusy(true);
    setProblem(null);
    try {
      await api.post("/api/facility/attendance/month-reopen", { month: key, reason: why });
      setReopening(false);
      setWhy("");
      reload();
    } catch (err) {
      const b = err instanceof ApiError ? (err.body as { message?: string }) : undefined;
      setProblem(b?.message ?? "The month was not reopened. Only the administrator can do this.");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setBusy(true);
    setProblem(null);
    try {
      await api.post("/api/facility/attendance/month-approve", { month: key });
      reload();
    } catch (err) {
      const b = err instanceof ApiError ? (err.body as { message?: string }) : undefined;
      setProblem(b?.message ?? "The month was not approved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Check the month" description="At the end of the month, go through the attendance, compare it with the facility's attendance book, fix any difference, then approve the month. An approved month is locked." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="ck-month" className="mb-1 block text-sm font-medium">Month</label>
          <Select id="ck-month" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="ck-year" className="mb-1 block text-sm font-medium">Year</label>
          <Select id="ck-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </Select>
        </div>
      </div>
      {error && !data ? (
        <LoadError onRetry={reload} />
      ) : !data ? (
        <Loading label="Loading the month" />
      ) : data.counts.total === 0 ? (
        <EmptyState title="Nothing recorded">No attendance has been recorded for this month.</EmptyState>
      ) : (
        <div className="space-y-6">
          <Panel title="Where the records came from" description={`${data.counts.total} records this month.`}>
            <ul className="text-[15px]">
              <li>{data.counts.clock} clocked in on a phone</li>
              <li>{data.counts.manual} marked by the in-charge or administrator</li>
            </ul>
          </Panel>
          {data.toCheck.length > 0 ? (
            <Panel title={`Look at these first (${data.toCheck.length})`} description="The duty changed after attendance was recorded. Open the day, check it, and keep or correct it.">
              <ul className="divide-y divide-[var(--border)]">
                {data.toCheck.map((i) => (
                  <Row key={i.id} item={i}>
                    <Button variant="secondary" onClick={() => api.post(`/api/facility/attendance/${i.id}/resolve`).then(reload)}>
                      It is still right
                    </Button>
                  </Row>
                ))}
              </ul>
            </Panel>
          ) : (
            <Notice tone="success">Nothing is waiting for a look.</Notice>
          )}
          {data.marked.length > 0 && (
            <Panel title={`Marked by hand (${data.marked.length})`} description="These were marked by the in-charge or administrator. Compare them with the facility's attendance book.">
              <ul className="divide-y divide-[var(--border)]">
                {data.marked.map((i) => <Row key={i.id} item={i} />)}
              </ul>
            </Panel>
          )}
          {data.approved ? (
            <div className="space-y-3">
              <Notice tone="success">Approved by {data.approved.by} on {new Date(data.approved.at).toLocaleDateString("en-GB")}. This month is locked and cannot be edited.</Notice>
              {reopening ? (
                <div className="max-w-md space-y-2">
                  <Field label="Why does it need to be reopened?" hint="At least 10 characters. It is kept in the audit log.">{(a) => <Textarea {...a} value={why} onChange={(e) => setWhy(e.target.value)} />}</Field>
                  {problem && <Notice tone="block">{problem}</Notice>}
                  <div className="flex gap-2">
                    <Button disabled={busy || why.trim().length < 10} onClick={reopen}>{busy ? "Reopening…" : "Reopen month"}</Button>
                    <Button variant="secondary" onClick={() => setReopening(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setReopening(true)}>Reopen month</Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {problem && <Notice tone="block">{problem}</Notice>}
              <Button disabled={busy || data.toCheck.length > 0} onClick={approve}>{busy ? "Approving…" : "Approve month"}</Button>
              {data.toCheck.length > 0 && <p className="text-sm text-[var(--muted)]">Clear the list above first.</p>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
