"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import type { AttendanceDay, AttendanceStatus } from "@/lib/types";
import { CoverPanel } from "@/components/CoverPanel";
import { Button, EmptyState, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Textarea } from "@/components/ui";

const OPTIONS: { value: AttendanceStatus; label: string }[] = [
  { value: "PRESENT", label: "Present" },
  { value: "LATE", label: "Late" },
  { value: "ABSENT", label: "Absent" },
  { value: "EXCUSED", label: "Excused" },
];

interface Entry {
  status: AttendanceStatus;
  minutes: string;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

function Sheet({ data, reload }: { data: AttendanceDay; reload: () => void }) {
  const initial: Record<string, Entry> = {};
  for (const s of data.shifts) {
    for (const p of s.people) {
      const st = (p.record?.status ?? "PRESENT") as AttendanceStatus;
      initial[p.assignmentId] = { status: st, minutes: p.record?.minutesLate ? String(p.record.minutesLate) : "" };
    }
  }
  const [entries, setEntries] = useState(initial);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [needReason, setNeedReason] = useState(data.needsReason);
  const [finding, setFinding] = useState<{ id: string; name: string } | null>(null);
  const today = data.date === todayIso();

  const set = (id: string, patch: Partial<Entry>) => setEntries((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  const anyRecorded = data.shifts.some((s) => s.people.some((p) => p.record));

  async function save() {
    setBusy(true);
    setProblem(null);
    setSaved(null);
    try {
      const records = Object.entries(entries).map(([assignmentId, e]) => ({
        assignmentId,
        status: e.status,
        ...(e.status === "LATE" ? { minutesLate: Number(e.minutes) || undefined } : {}),
      }));
      const r = await api.put<{ saved: number }>("/api/facility/attendance/day", { date: data.date, reason, records });
      setSaved(r.saved);
      reload();
    } catch (err) {
      const b = err instanceof ApiError ? (err.body as { error?: string; message?: string }) : undefined;
      if (b?.error === "reason_required") setNeedReason(true);
      setProblem(b?.message ?? "Attendance was not saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {data.review.length > 0 && (
        <Panel title="Check these" description="The duty changed after attendance was recorded. The record was kept as it was.">
          <ul className="divide-y divide-[var(--border)]">
            {data.review.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
                <span>
                  {r.name}, recorded as {r.status.toLowerCase().replace("_", " ")}
                  {r.minutesLate ? ` (${r.minutesLate} min)` : ""}
                </span>
                <Button variant="secondary" onClick={() => api.post(`/api/facility/attendance/${r.id}/resolve`).then(reload)}>
                  It is still right
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {finding && <CoverPanel key={finding.id} assignmentId={finding.id} personName={finding.name} onClose={() => setFinding(null)} onDone={() => { setFinding(null); reload(); }} />}
      {data.covered.length > 0 && (
        <Panel title="Covered today" description="Absent, with someone else asked to take the duty.">
          <ul className="text-[15px]">
            {data.covered.map((c) => (
              <li key={`${c.absentName}-${c.coverName}`}>
                {c.absentName} is covered by {c.coverName}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {data.shifts.length === 0 && <EmptyState title="Nobody was on duty">The published roster has no duties on this date.</EmptyState>}
      {data.shifts.map((shift) => (
        <Panel key={shift.id} title={`${shift.name} (${shift.code})`} description={shift.startTime && shift.endTime ? `${shift.startTime} to ${shift.endTime}` : undefined}>
          <ul className="divide-y divide-[var(--border)]">
            {shift.people.map((p) => {
              const e = entries[p.assignmentId];
              return (
                <li key={p.assignmentId} className="py-3">
                  <fieldset>
                    <legend className="mb-2 text-[15px] font-medium">
                      {p.name}
                      {p.cadre && <span className="font-normal text-[var(--muted)]"> , {p.cadre}</span>}
                      {p.isCover && <span className="font-normal text-[var(--muted)]"> , cover{p.coverForName ? ` for ${p.coverForName}` : ""}{p.coverState === "AWAITING" ? ", waiting to confirm" : p.coverState === "ESCALATED" ? ", has not confirmed" : ""}</span>}
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      {OPTIONS.map((o) => (
                        <label
                          key={o.value}
                          className={`flex min-h-11 min-w-[5.5rem] cursor-pointer items-center justify-center rounded-[var(--radius)] border px-3 text-[15px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)] ${
                            e.status === o.value ? "border-[var(--accent)] bg-[var(--accent)] font-medium text-white" : "border-[var(--border-strong)] bg-[var(--surface)]"
                          }`}
                        >
                          <input type="radio" className="sr-only" name={`st-${p.assignmentId}`} checked={e.status === o.value} onChange={() => set(p.assignmentId, { status: o.value })} />
                          {o.label}
                        </label>
                      ))}
                    </div>
                    {e.status === "LATE" && (
                      <div className="mt-2 max-w-[12rem]">
                        <Field label="Minutes late">{(a) => <Input {...a} inputMode="numeric" value={e.minutes} onChange={(ev) => set(p.assignmentId, { minutes: ev.target.value.replace(/\D/g, "") })} />}</Field>
                      </div>
                    )}
                    {today && p.record && (p.record.status === "ABSENT" || p.record.status === "EXCUSED") && (
                      <div className="mt-2">
                        <Button variant="secondary" onClick={() => setFinding({ id: p.assignmentId, name: p.name })}>
                          Find cover for this duty
                        </Button>
                        {(e.status !== p.record.status) && <p className="mt-1 text-sm text-[var(--muted)]">Save the change first, then find cover.</p>}
                      </div>
                    )}
                    {p.record?.needsReview && <p className="mt-1 text-sm text-[var(--status-warning)]">The duty changed after this was recorded. Check it is still right.</p>}
                    {p.record?.corrected && p.record.originalStatus && <p className="mt-1 text-sm text-[var(--muted)]">Corrected. First recorded as {p.record.originalStatus.toLowerCase().replace("_", " ")}.</p>}
                  </fieldset>
                </li>
              );
            })}
          </ul>
        </Panel>
      ))}

      {data.onLeave.length > 0 && (
        <details className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <summary className="cursor-pointer text-[15px] font-medium">On leave ({data.onLeave.length})</summary>
          <ul className="mt-2 text-[15px]">
            {data.onLeave.map((p) => (
              <li key={p.staffId}>
                {p.name}, {p.official ? "official assignment" : `${p.typeName.toLowerCase()} leave`}
              </li>
            ))}
          </ul>
        </details>
      )}
      {data.offDuty.length > 0 && (
        <details className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <summary className="cursor-pointer text-[15px] font-medium">Off duty ({data.offDuty.length})</summary>
          <ul className="mt-2 text-[15px]">
            {data.offDuty.map((p) => (
              <li key={p.staffId}>{p.name}</li>
            ))}
          </ul>
        </details>
      )}

      {data.shifts.length > 0 && (
        <div className="space-y-3">
          {(needReason || anyRecorded) && (
            <Field
              label="Reason for the change"
              optional={!needReason}
              hint={needReason ? `This date is more than ${data.cutoffDays} days ago, so a reason is needed. It is kept as a correction.` : "Needed only if you change something already recorded."}
            >
              {(a) => <Textarea {...a} value={reason} onChange={(ev) => setReason(ev.target.value)} />}
            </Field>
          )}
          {problem && <Notice tone="block">{problem}</Notice>}
          {saved !== null && <Notice tone="success">{saved === 0 ? "Nothing changed." : `Saved ${saved} ${saved === 1 ? "record" : "records"}.`}</Notice>}
          <Button disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save attendance"}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function AttendancePage() {
  const [date, setDate] = useState(todayIso());
  const { data, error, reload } = useResource<AttendanceDay>(`/api/facility/attendance/day?date=${date}`);

  return (
    <>
      <PageHeader title="Daily attendance" description="Everyone starts as present. Change only the people who were not. Night duty counts on the day it started." />
      <div className="mb-4 max-w-xs">
        <Field label="Date">{(a) => <Input {...a} type="date" max={todayIso()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />}</Field>
      </div>
      {error && !data ? (
        <LoadError onRetry={reload} />
      ) : !data ? (
        <Loading label="Loading attendance" />
      ) : data.blocked ? (
        <Notice tone="warning">{data.blocked}</Notice>
      ) : (
        <Sheet key={data.date} data={data} reload={reload} />
      )}
    </>
  );
}
