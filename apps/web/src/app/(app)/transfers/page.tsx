"use client";

// Inter-ward transfers. The administrator moves a person to another ward, now
// or on a date. Their record goes with them; the new ward's roster counts them
// from that day. Ward in-charges see the moves into and out of their ward.
import { useState } from "react";
import { useFacility } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import type { Department, Staff } from "@/lib/types";
import { Button, Checkbox, EmptyState, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Select, StatusBadge, TableScroll, TD, TH } from "@/components/ui";

interface Transfer { id: string; name: string; staffNo: string; from: string | null; to: string; effectiveDate: string; kind: "ROUTINE" | "EMERGENCY"; inCharge: boolean; reason: string | null; status: "SCHEDULED" | "DONE" | "CANCELLED" }

const STATUS = {
  SCHEDULED: { word: "Scheduled", tone: "warning" },
  DONE: { word: "Done", tone: "success" },
  CANCELLED: { word: "Cancelled", tone: "neutral" },
} as const;

const todayIso = () => new Date().toISOString().slice(0, 10);
const say = (e: unknown, fallback: string) => (e instanceof ApiError ? (e.body as { message?: string; fields?: Record<string, string> } | undefined) : undefined) ?? { message: fallback };

function NewTransfer({ onDone }: { onDone: () => void }) {
  const staff = useResource<{ staff: Staff[] }>("/api/facility/staff");
  const wards = useResource<{ departments: Department[] }>("/api/facility/departments");
  const blank = { staffId: "", toDepartmentId: "", effectiveDate: todayIso(), kind: "ROUTINE", reason: "", inCharge: false };
  const [form, setForm] = useState(blank);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if ((staff.error && !staff.data) || (wards.error && !wards.data)) return <LoadError onRetry={() => { staff.reload(); wards.reload(); }} />;
  if (!staff.data || !wards.data) return <Loading label="Loading" />;
  const person = staff.data.staff.find((s) => s.id === form.staffId);
  const active = wards.data.departments.filter((d) => d.active !== false);

  async function save() {
    setBusy(true);
    setFields({});
    setProblem(null);
    try {
      await api.post("/api/facility/transfers", { ...form, reason: form.reason || undefined });
      setForm(blank);
      onDone();
    } catch (e) {
      const b = say(e, "The transfer could not be saved. Try again.");
      setFields(b.fields ?? {});
      setProblem(b.fields ? null : (b.message ?? null));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Move someone" description="Their record and leave go with them.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Person" error={fields.staffId} hint={person ? `Now in ${person.department?.name ?? "no ward"}.` : undefined}>
          {(a) => (
            <Select {...a} value={form.staffId} onChange={(e) => setForm({ ...form, staffId: e.target.value })}>
              <option value="">Choose</option>
              {staff.data!.staff.filter((s) => s.status === "ACTIVE" || s.status === "ON_LEAVE").map((s) => <option key={s.id} value={s.id}>{s.fullName} ({s.staffNo})</option>)}
            </Select>
          )}
        </Field>
        <Field label="To ward" error={fields.toDepartmentId}>
          {(a) => (
            <Select {...a} value={form.toDepartmentId} onChange={(e) => setForm({ ...form, toDepartmentId: e.target.value })}>
              <option value="">Choose</option>
              {active.filter((d) => d.id !== person?.department?.id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="From" error={fields.effectiveDate} hint="Today moves them now.">
          {(a) => <Input {...a} type="date" min={todayIso()} value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} />}
        </Field>
        <Field label="Type">
          {(a) => (
            <Select {...a} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="ROUTINE">Routine</option>
              <option value="EMERGENCY">Emergency</option>
            </Select>
          )}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Reason" optional error={fields.reason}>{(a) => <Input {...a} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />}</Field>
        </div>
        <div className="sm:col-span-2"><Checkbox label="In charge of the new ward" checked={form.inCharge} onChange={(on) => setForm({ ...form, inCharge: on })} /></div>
      </div>
      {problem && <div className="mt-3"><Notice tone="warning">{problem}</Notice></div>}
      <div className="mt-4"><Button disabled={busy || !form.staffId || !form.toDepartmentId} onClick={save}>{busy ? "Saving…" : "Transfer"}</Button></div>
    </Panel>
  );
}

export default function TransfersPage() {
  const { isAdmin } = useFacility();
  const list = useResource<{ transfers: Transfer[] }>("/api/facility/transfers");
  const [problem, setProblem] = useState<string | null>(null);
  if (list.error && !list.data) return <LoadError onRetry={list.reload} />;
  if (!list.data) return <Loading label="Loading transfers" />;
  const rows = list.data.transfers;

  async function cancel(id: string) {
    setProblem(null);
    try {
      await api.post(`/api/facility/transfers/${id}/cancel`, {});
      list.reload();
    } catch (e) {
      setProblem(say(e, "That could not be cancelled. Try again.").message ?? null);
    }
  }

  return (
    <>
      <PageHeader title="Ward transfers" description="Move staff between wards. No new registration needed." />
      <div className="space-y-6">
        {isAdmin && <NewTransfer onDone={list.reload} />}
        <Panel title="Transfers">
          {problem && <div className="mb-3"><Notice tone="warning">{problem}</Notice></div>}
          {rows.length === 0 ? (
            <EmptyState title="No transfers yet" />
          ) : (
            <TableScroll label="Ward transfers">
              <table className="w-full min-w-[44rem] border-collapse text-sm">
                <thead><tr><th className={TH}>Name</th><th className={TH}>From</th><th className={TH}>To</th><th className={TH}>Date</th><th className={TH}>Type</th><th className={TH}>Status</th>{isAdmin && <th className={TH}><span className="sr-only">Actions</span></th>}</tr></thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <td className={TD}>{t.name}<span className="block text-[13px] text-[var(--muted)]">{t.staffNo}{t.reason ? `, ${t.reason}` : ""}</span></td>
                      <td className={TD}>{t.from ?? "None"}</td>
                      <td className={TD}>{t.to}{t.inCharge && <span className="block text-[13px] text-[var(--muted)]">As in-charge</span>}</td>
                      <td className={`${TD} figures`}>{showDate(t.effectiveDate)}</td>
                      <td className={TD}>{t.kind === "EMERGENCY" ? "Emergency" : "Routine"}</td>
                      <td className={TD}><StatusBadge tone={STATUS[t.status].tone}>{STATUS[t.status].word}</StatusBadge></td>
                      {isAdmin && <td className={TD}>{t.status === "SCHEDULED" && <Button variant="secondary" onClick={() => cancel(t.id)}>Cancel</Button>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Panel>
      </div>
    </>
  );
}
