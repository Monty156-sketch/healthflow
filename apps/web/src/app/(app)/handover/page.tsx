"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate, showDateTime } from "@/lib/format";
import { Button, EmptyState, Field, Loading, LoadError, Notice, PageHeader, Panel, Select, StatusBadge, Textarea, Input } from "@/components/ui";

interface Note {
  id: string; ward: string | null; departmentId: string | null; shiftId: string; shift: string; dutyDate: string; author: string; mine: boolean;
  summary: string; pending: string | null; concerns: string | null; urgent: boolean; createdAt: string; read: boolean; readCount: number; readers?: { name: string; at: string }[];
}
interface Options { shifts: { id: string; name: string; startTime: string | null; endTime: string | null }[]; wards: { id: string; name: string }[]; fixed: boolean; ward: string | null }

const today = () => new Date().toISOString().slice(0, 10);

function NoteCard({ n, canManage, onChange }: { n: Note; canManage: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [showReaders, setShowReaders] = useState(false);
  async function markRead() {
    setBusy(true);
    try { await api.post(`/api/facility/handover/${n.id}/read`); onChange(); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await api.delete(`/api/facility/handover/${n.id}`); onChange(); } catch { /* the note stays; the list refreshes */ onChange(); } finally { setBusy(false); }
  }
  return (
    <li className={`rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 ${n.urgent ? "border-l-[3px] border-l-[var(--status-block)]" : ""}`}>
      <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
        <strong className="text-[15px] text-[var(--foreground)]">{n.shift}, {showDate(n.dutyDate)}</strong>
        {n.ward && <span>{n.ward}</span>}
        {n.urgent && <StatusBadge tone="block">Read first</StatusBadge>}
        {!n.read && <StatusBadge tone="warning">Not read</StatusBadge>}
      </p>
      <p className="mt-2 whitespace-pre-wrap text-[15px]">{n.summary}</p>
      {n.pending && <p className="mt-2 whitespace-pre-wrap text-[15px]"><strong>Still to do: </strong>{n.pending}</p>}
      {n.concerns && <p className="mt-2 whitespace-pre-wrap text-[15px]"><strong>Concerns: </strong>{n.concerns}</p>}
      <p className="mt-2 text-sm text-[var(--muted)]">{n.author}, {showDateTime(n.createdAt)}. {n.readCount === 0 ? "Not yet read by anyone." : `Read by ${n.readCount}.`}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {!n.read && <Button disabled={busy} onClick={markRead}>I have read this</Button>}
        {n.readers && n.readers.length > 0 && <Button variant="secondary" onClick={() => setShowReaders(!showReaders)}>{showReaders ? "Hide readers" : "Who has read it"}</Button>}
        {(n.mine || canManage) && <Button variant="secondary" disabled={busy} onClick={remove}>Remove</Button>}
      </div>
      {showReaders && n.readers && <ul className="mt-2 text-sm">{n.readers.map((r) => <li key={r.name + r.at}>{r.name}, {showDateTime(r.at)}</li>)}</ul>}
    </li>
  );
}

function Write({ options, ward, onDone }: { options: Options; ward: string; onDone: () => void }) {
  const [shiftId, setShiftId] = useState(options.shifts[0]?.id ?? "");
  const [dutyDate, setDutyDate] = useState(today());
  const [summary, setSummary] = useState("");
  const [pending, setPending] = useState("");
  const [concerns, setConcerns] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function send() {
    setBusy(true); setProblem(null); setFields({});
    try {
      await api.post("/api/facility/handover", { shiftId, dutyDate, ward: ward || null, summary, pending: pending || null, concerns: concerns || null, urgent });
      onDone();
    } catch (e) {
      const f = e instanceof ApiError && typeof e.body === "object" && e.body && "fields" in e.body ? (e.body as { fields: Record<string, string> }).fields : null;
      if (f) setFields(f);
      setProblem(f ? "Check the details marked below." : "It was not saved. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  return (
    <Panel title="Leave a handover note">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Shift you are handing over" error={fields.shiftId}>{(a) => (
          <Select {...a} value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
            {options.shifts.map((s) => <option key={s.id} value={s.id}>{s.name}{s.startTime ? ` (${s.startTime} to ${s.endTime})` : ""}</option>)}
          </Select>
        )}</Field>
        <Field label="Day the shift started" error={fields.dutyDate}>{(a) => <Input {...a} type="date" max={today()} value={dutyDate} onChange={(e) => setDutyDate(e.target.value)} />}</Field>
      </div>
      {fields.ward && <div className="mt-3"><Notice tone="block">{fields.ward}</Notice></div>}
      <div className="mt-4 space-y-4">
        <Field label="How the ward was" error={fields.summary}>{(a) => <Textarea {...a} value={summary} onChange={(e) => setSummary(e.target.value)} />}</Field>
        <Field label="Still to do" optional error={fields.pending}>{(a) => <Textarea {...a} value={pending} onChange={(e) => setPending(e.target.value)} />}</Field>
        <Field label="Concerns" optional error={fields.concerns} hint="Equipment, supplies, staffing, anything the next shift should watch.">{(a) => <Textarea {...a} value={concerns} onChange={(e) => setConcerns(e.target.value)} />}</Field>
      </div>
      <label className="mt-3 flex min-h-11 items-center gap-2 text-[15px]">
        <input type="checkbox" className="size-5" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
        Needs attention first. The in-charge is told at once.
      </label>
      <p className="mt-2 text-sm text-[var(--muted)]">Do not write patient names. Use bed numbers and say what needs doing.</p>
      {problem && <div className="mt-3"><Notice tone="block">{problem}</Notice></div>}
      <div className="mt-4"><Button disabled={busy || summary.trim().length < 3 || !shiftId} onClick={send}>{busy ? "Saving…" : "Save note"}</Button></div>
    </Panel>
  );
}

export default function HandoverPage() {
  const options = useResource<Options>("/api/facility/handover/options");
  const [picked, setWard] = useState("");
  const [days, setDays] = useState("3");
  const [writing, setWriting] = useState(false);
  // Staff and ward managers are held to their own ward; the rest choose.
  const ward = options.data?.fixed ? (options.data.ward ?? "") : picked;
  const notes = useResource<{ notes: Note[] }>(options.data ? `/api/facility/handover?days=${days}${ward ? `&ward=${ward}` : ""}` : null);

  if (options.error && !options.data) return <LoadError onRetry={options.reload} />;
  if (!options.data) return <Loading />;
  const o = options.data;
  const refresh = () => { notes.reload(); setWriting(false); };
  const manager = !o.fixed;

  return (
    <>
      <PageHeader title="Shift handover" description="What the shift going off leaves for the shift coming on. Read the notes at the start of your shift." />
      {writing ? (
        <Write options={o} ward={ward} onDone={refresh} />
      ) : (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          {!o.fixed && o.wards.length > 0 && (
            <div className="max-w-[16rem]">
              <Field label="Ward">{(a) => (
                <Select {...a} value={picked} onChange={(e) => setWard(e.target.value)}>
                  <option value="">All wards</option>
                  {o.wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </Select>
              )}</Field>
            </div>
          )}
          <div className="max-w-[12rem]">
            <Field label="Show">{(a) => (
              <Select {...a} value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="2">Last 2 days</option>
                <option value="3">Last 3 days</option>
                <option value="7">Last week</option>
                <option value="14">Last 2 weeks</option>
              </Select>
            )}</Field>
          </div>
          <Button disabled={o.shifts.length === 0 || (!o.fixed && o.wards.length > 0 && !ward)} onClick={() => setWriting(true)}>Leave a note</Button>
        </div>
      )}
      {!writing && !o.fixed && o.wards.length > 0 && !ward && <p className="mb-3 text-sm text-[var(--muted)]">Choose a ward to leave a note for it.</p>}
      {o.shifts.length === 0 && <div className="mb-4"><Notice tone="neutral">No shifts are set up yet. Add shifts under Duty patterns first.</Notice></div>}
      {notes.error && !notes.data ? (
        <LoadError onRetry={notes.reload} />
      ) : !notes.data ? (
        <Loading />
      ) : notes.data.notes.length === 0 ? (
        <EmptyState title="No handover notes">Nothing has been left for these days.</EmptyState>
      ) : (
        <ul className="space-y-3">{notes.data.notes.map((n) => <NoteCard key={n.id} n={n} canManage={manager} onChange={refresh} />)}</ul>
      )}
    </>
  );
}
