"use client";

import { FormEvent, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import type { LeaveTypeFull } from "@/lib/types";
import { Button, Checkbox, EmptyState, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Select, StatusBadge, TableScroll } from "@/components/ui";

const BASIS = { CALENDAR_DAYS: "Calendar days", SCHEDULED_DUTY_DAYS: "Scheduled duty days", WORKING_DAYS_MON_FRI: "Working days, Monday to Friday" };

const blank: LeaveTypeFull = {
  id: "", name: "", code: "", colour: "#25619f", isPaid: true, affectsAvailability: true, countsAgainstEntitlement: false, deductionBasis: "CALENDAR_DAYS",
  maxConsecutiveDays: null, createsDutyDebt: false, isShortAbsence: false, maxDaysForAutoCover: 3, returnDateSetBy: "STAFF_CONFIRMS", active: true, sortOrder: 0,
};

function Editor({ value, onDone }: { value: LeaveTypeFull; onDone: (saved: boolean) => void }) {
  const [v, setV] = useState(value);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof LeaveTypeFull>(k: K) => (x: LeaveTypeFull[K]) => setV((o) => ({ ...o, [k]: x }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFields({});
    setProblem(null);
    try {
      const { id, sortOrder, ...body } = v;
      void sortOrder;
      if (id) await api.patch(`/api/facility/leave-types/${id}`, body);
      else await api.post("/api/facility/leave-types", body);
      onDone(true);
    } catch (err) {
      const b = err instanceof ApiError ? (err.body as { fields?: Record<string, string>; message?: string }) : undefined;
      if (b?.fields) setFields(b.fields);
      else setProblem(b?.message ?? "It was not saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={value.id ? `Change ${value.name}` : "New leave type"}>
      <form onSubmit={save} noValidate className="grid max-w-3xl gap-4 sm:grid-cols-2">
        <Field label="Name" error={fields.name}>{(a) => <Input {...a} value={v.name} onChange={(e) => set("name")(e.target.value)} />}</Field>
        <Field label="Code" hint="Shown on the calendar. Not L for Late." error={fields.code}>{(a) => <Input {...a} value={v.code} maxLength={6} onChange={(e) => set("code")(e.target.value.toUpperCase())} />}</Field>
        <Field label="Colour" error={fields.colour}>{(a) => <input {...a} type="color" className="h-11 w-20 rounded border border-[var(--border-strong)]" value={v.colour ?? "#25619f"} onChange={(e) => set("colour")(e.target.value)} />}</Field>
        <Field label="How days are counted" error={fields.deductionBasis}>
          {(a) => (
            <Select {...a} value={v.deductionBasis} onChange={(e) => set("deductionBasis")(e.target.value as LeaveTypeFull["deductionBasis"])}>
              {Object.entries(BASIS).map(([k, l]) => (<option key={k} value={k}>{l}</option>))}
            </Select>
          )}
        </Field>
        <Field label="Longest run, in days" optional hint="Leave empty for no limit. Study leave often runs for months." error={fields.maxConsecutiveDays}>
          {(a) => <Input {...a} inputMode="numeric" value={v.maxConsecutiveDays ?? ""} onChange={(e) => set("maxConsecutiveDays")(e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null)} />}
        </Field>
        <Field label="Who sets the return date">
          {(a) => (
            <Select {...a} value={v.returnDateSetBy} onChange={(e) => set("returnDateSetBy")(e.target.value as LeaveTypeFull["returnDateSetBy"])}>
              <option value="IN_CHARGE">The in-charge, from the days granted</option>
              <option value="STAFF_CONFIRMS">The person confirms when they are back</option>
            </Select>
          )}
        </Field>
        <div className="space-y-1 sm:col-span-2">
          <Checkbox label="Paid" checked={v.isPaid} onChange={set("isPaid")} />
          <Checkbox label="Blocks availability (the person is not rostered)" checked={v.affectsAvailability} onChange={set("affectsAvailability")} />
          <Checkbox label="Counts against the yearly entitlement" checked={v.countsAgainstEntitlement} onChange={set("countsAgainstEntitlement")} />
          <Checkbox label="A short absence (a day or two, asked of the in-charge)" checked={v.isShortAbsence} onChange={set("isShortAbsence")} />
          <Checkbox
            label="Time away is worked back"
            hint="Leave off for sick and compassionate leave."
            checked={v.createsDutyDebt}
            onChange={set("createsDutyDebt")}
          />
          <Checkbox label="In use" hint="Switching it off hides it from new requests. Past requests keep it." checked={v.active} onChange={set("active")} />
        </div>
        {v.isShortAbsence && (
          <Field label="Cover found automatically up to, days" hint="Longer absences go to the in-charge." error={fields.maxDaysForAutoCover}>
            {(a) => <Input {...a} inputMode="numeric" value={v.maxDaysForAutoCover} onChange={(e) => set("maxDaysForAutoCover")(Number(e.target.value.replace(/\D/g, "")) || 0)} />}
          </Field>
        )}
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          {problem && <div className="w-full"><Notice tone="block">{problem}</Notice></div>}
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          <Button variant="secondary" onClick={() => onDone(false)}>Cancel</Button>
        </div>
      </form>
    </Panel>
  );
}

export default function LeaveTypesPage() {
  const { data, error, reload } = useResource<{ types: LeaveTypeFull[] }>("/api/facility/leave-types");
  const [editing, setEditing] = useState<LeaveTypeFull | null>(null);

  return (
    <>
      <PageHeader
        title="Leave types"
        description="Check these match your leave practice."
        actions={<Button onClick={() => setEditing(blank)}>Add a leave type</Button>}
      />
      {editing && <div className="mb-6"><Editor key={editing.id || "new"} value={editing} onDone={(saved) => { setEditing(null); if (saved) reload(); }} /></div>}
      {error && !data ? (
        <LoadError onRetry={reload} />
      ) : !data ? (
        <Loading label="Loading leave types" />
      ) : data.types.length === 0 ? (
        <EmptyState title="No leave types" />
      ) : (
        <TableScroll label="Leave types, scrolls sideways on small screens">
          <table className="w-full min-w-[46rem] border-collapse text-left text-[15px]">
            <caption className="sr-only">Leave types</caption>
            <thead>
              <tr className="text-sm text-[var(--muted)]">
                {["Type", "Counted as", "Entitlement", "Worked back", "In use", ""].map((h, i) => (<th key={i} scope="col" className="border-b border-[var(--border-strong)] px-3 py-2 font-medium">{h || <span className="sr-only">Actions</span>}</th>))}
              </tr>
            </thead>
            <tbody>
              {data.types.map((t) => (
                <tr key={t.id}>
                  <th scope="row" className="border-b border-[var(--border)] px-3 py-2 font-medium">
                    <span className="mr-2 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: t.colour ?? "#999" }} aria-hidden="true" />
                    {t.name} <span className="figures text-[var(--muted)]">({t.code})</span>
                  </th>
                  <td className="border-b border-[var(--border)] px-3 py-2">{BASIS[t.deductionBasis]}</td>
                  <td className="border-b border-[var(--border)] px-3 py-2">{t.countsAgainstEntitlement ? "Counts" : "Does not count"}</td>
                  <td className="border-b border-[var(--border)] px-3 py-2">{t.createsDutyDebt ? "Yes" : "No"}</td>
                  <td className="border-b border-[var(--border)] px-3 py-2"><StatusBadge tone={t.active ? "success" : "neutral"}>{t.active ? "In use" : "Off"}</StatusBadge></td>
                  <td className="border-b border-[var(--border)] px-3 py-1 text-right"><Button variant="secondary" aria-label={`Change ${t.name}`} onClick={() => setEditing(t)}>Change</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </>
  );
}
