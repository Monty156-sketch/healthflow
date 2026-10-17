"use client";

import { FormEvent, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import { Button, EmptyState, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Select } from "@/components/ui";

interface Holiday {
  id: string;
  date: string;
  name: string;
}

function Row({ h, onChanged }: { h: Holiday; onChanged: () => void }) {
  const [edit, setEdit] = useState(false);
  const [date, setDate] = useState(h.date);
  const [name, setName] = useState(h.name);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  async function save() {
    setErr(null);
    try {
      await api.patch(`/api/facility/holidays/${h.id}`, { date, name });
      setEdit(false);
      onChanged();
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { fields?: Record<string, string> }) : undefined;
      setErr(b?.fields ? Object.values(b.fields)[0] : "It was not saved. Try again.");
    }
  }
  if (edit) {
    return (
      <li className="space-y-2 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Date">{(a) => <Input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Name">{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Button onClick={save}>Save</Button>
          <Button variant="secondary" onClick={() => setEdit(false)}>Cancel</Button>
        </div>
        {err && <Notice tone="block">{err}</Notice>}
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
      <span><span className="figures font-medium">{showDate(h.date)}</span>, {h.name}</span>
      <span className="flex gap-2">
        <Button variant="secondary" aria-label={`Change ${h.name}`} onClick={() => setEdit(true)}>Change</Button>
        {confirm ? (
          <Button variant="secondary" onClick={() => api.delete(`/api/facility/holidays/${h.id}`).then(onChanged)}>Yes, remove it</Button>
        ) : (
          <Button variant="quiet" aria-label={`Remove ${h.name}`} onClick={() => setConfirm(true)}>Remove</Button>
        )}
      </span>
    </li>
  );
}

export default function HolidaysPage() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const { data, error, reload } = useResource<{ year: number; holidays: Holiday[] }>(`/api/facility/holidays?year=${year}`);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});

  async function add(e: FormEvent) {
    e.preventDefault();
    setFields({});
    try {
      await api.post("/api/facility/holidays", { date, name });
      setDate("");
      setName("");
      reload();
    } catch (err) {
      const b = err instanceof ApiError ? (err.body as { fields?: Record<string, string> }) : undefined;
      setFields(b?.fields ?? { name: "It was not saved. Try again." });
    }
  }

  return (
    <>
      <PageHeader title="Public holidays" description="Skipped when working days are counted, and used by the roster for fair spreading of holiday duties." />
      <div className="mb-4"><Notice tone="warning">The fixed holidays were added from the Ministry of the Interior list. Eid days are set by the Chief Imam during the year, and a holiday that falls on a weekend may be moved. Add or change those here when the official notice is out. Check every date against it.</Notice></div>
      <div className="mb-4 max-w-[10rem]">
        <label htmlFor="ho-year" className="mb-1 block text-sm font-medium">Year</label>
        <Select id="ho-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => (<option key={y}>{y}</option>))}
        </Select>
      </div>
      <Panel title="Add a holiday">
        <form onSubmit={add} noValidate className="flex flex-wrap items-end gap-3">
          <Field label="Date" error={fields.date}>{(a) => <Input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Name" error={fields.name}>{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Button type="submit">Add</Button>
        </form>
      </Panel>
      <div className="mt-6">
        {error && !data ? (
          <LoadError onRetry={reload} />
        ) : !data ? (
          <Loading label="Loading holidays" />
        ) : data.holidays.length === 0 ? (
          <EmptyState title={`No holidays for ${year}`}>Add them above.</EmptyState>
        ) : (
          <ul className="divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4">
            {data.holidays.map((h) => (<Row key={h.id} h={h} onChanged={reload} />))}
          </ul>
        )}
      </div>
    </>
  );
}
