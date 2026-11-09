"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { MONTHS } from "@/lib/format";
import type { AttendanceMonthCheck, AttendanceMonthItem } from "@/lib/types";
import { Button, EmptyState, Loading, LoadError, Notice, PageHeader, Panel, Select } from "@/components/ui";

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
        {item.source === "AUTO" && <span className="text-[var(--muted)]"> (no clock-in)</span>}
        {item.source === "BOOK" && <span className="text-[var(--muted)]"> (from the book)</span>}
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
  const years = Array.from({ length: 4 }, (_, i) => now.getFullYear() - 2 + i);

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
      <PageHeader title="Check the month against the book" description="Go through what the phones and the system recorded, compare it with the facility's attendance book, fix any difference, then approve the month." />
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
              <li>{data.counts.book} typed in from the book</li>
              <li>{data.counts.auto} marked absent automatically (no clock-in)</li>
            </ul>
          </Panel>
          {data.toCheck.length > 0 ? (
            <Panel title={`Look at these first (${data.toCheck.length})`} description="Find each one in the book. If the person signed, open the day and enter their time. If not, confirm the absence.">
              <ul className="divide-y divide-[var(--border)]">
                {data.toCheck.map((i) => (
                  <Row key={i.id} item={i}>
                    <Button variant="secondary" onClick={() => api.post(`/api/facility/attendance/${i.id}/resolve`).then(reload)}>
                      The book agrees
                    </Button>
                  </Row>
                ))}
              </ul>
            </Panel>
          ) : (
            <Notice tone="success">Nothing is waiting for a look.</Notice>
          )}
          {data.fromBook.length > 0 && (
            <Panel title={`Typed in from the book (${data.fromBook.length})`} description="These came from the book, so they should match it line for line.">
              <ul className="divide-y divide-[var(--border)]">
                {data.fromBook.map((i) => <Row key={i.id} item={i} />)}
              </ul>
            </Panel>
          )}
          {data.approved ? (
            <Notice tone="success">Approved by {data.approved.by} on {new Date(data.approved.at).toLocaleDateString("en-GB")}.</Notice>
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
