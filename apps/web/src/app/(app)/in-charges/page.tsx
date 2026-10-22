"use client";

// The in-charge list. The administrator names each in-charge with their rank and ward. When that person
// signs up with the same name, the ward and rank are filled in and cannot be changed, so nobody can
// choose an in-charge's ward for themselves.
import { useState } from "react";
import { useFacility } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import type { Department } from "@/lib/types";
import { Button, EmptyState, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Select, StatusBadge, TableScroll, TD, TH } from "@/components/ui";

interface Row { id: string; fullName: string; rank: string; departmentId: string | null; ward: string | null; signedUp: boolean }

export default function InChargesPage() {
  const { facility, me } = useFacility();
  const list = useResource<{ inCharges: Row[] }>("/api/facility/in-charges");
  const depts = useResource<{ departments: Department[] }>("/api/facility/departments");
  const byWard = Boolean(facility.rosterByWard);
  const blank = { fullName: "", rank: "", departmentId: "" };
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me.role !== "FACILITY_ADMIN") return <Notice tone="warning">Only the facility administrator manages the in-charge list.</Notice>;
  if ((list.error && !list.data) || (depts.error && !depts.data)) return <LoadError onRetry={() => { list.reload(); depts.reload(); }} />;
  if (!list.data || !depts.data) return <Loading label="Loading" />;
  const wards = depts.data.departments.filter((d) => d.active !== false && (d.kind ?? "WARD") === "WARD");

  async function save() {
    setBusy(true);
    setFields({});
    setProblem(null);
    const body = { fullName: form.fullName, rank: form.rank, departmentId: form.departmentId || null };
    try {
      if (editing) await api.patch(`/api/facility/in-charges/${editing}`, body);
      else await api.post("/api/facility/in-charges", body);
      setForm(blank);
      setEditing(null);
      list.reload();
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { message?: string; fields?: Record<string, string> } | undefined) : undefined;
      setFields(b?.fields ?? {});
      setProblem(b?.fields ? null : (b?.message ?? "That did not save. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: Row) {
    setProblem(null);
    try {
      await api.delete(`/api/facility/in-charges/${r.id}`);
      list.reload();
    } catch {
      setProblem("That could not be removed. Try again.");
    }
  }

  const rows = list.data.inCharges;
  return (
    <>
      <PageHeader title="In-charges" description="Name each in-charge with their rank and ward. When they sign up with the same name, their ward and rank are filled in for them." />
      <div className="space-y-6">
        <Panel title={editing ? "Change an in-charge" : "Add an in-charge"}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Full name" hint="As they will type it when they sign up." error={fields.fullName}>{(a) => <Input {...a} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />}</Field>
            <Field label="Rank" error={fields.rank}>{(a) => <Input {...a} value={form.rank} onChange={(e) => setForm({ ...form, rank: e.target.value })} />}</Field>
            {byWard && (
              <Field label="Ward" error={fields.departmentId}>
                {(a) => (
                  <Select {...a} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                    <option value="">Choose</option>
                    {wards.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </Select>
                )}
              </Field>
            )}
          </div>
          {problem && <div className="mt-3"><Notice tone="warning">{problem}</Notice></div>}
          <div className="mt-4 flex gap-2">
            <Button disabled={busy || !form.fullName.trim() || !form.rank.trim() || (byWard && !form.departmentId)} onClick={save}>{busy ? "Saving…" : editing ? "Save changes" : "Add to the list"}</Button>
            {editing && <Button variant="secondary" onClick={() => { setEditing(null); setForm(blank); setFields({}); }}>Cancel</Button>}
          </div>
        </Panel>
        <Panel title="The list">
          {rows.length === 0 ? (
            <EmptyState title="No in-charges listed yet">Add them here before they sign up. Someone who signs up with a name that is not on this list cannot register as an in-charge.</EmptyState>
          ) : (
            <TableScroll label="In-charges">
              <table className="w-full min-w-[40rem] border-collapse text-sm">
                <thead><tr><th className={TH}>Name</th><th className={TH}>Rank</th>{byWard && <th className={TH}>Ward</th>}<th className={TH}>Status</th><th className={TH}><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className={TD}>{r.fullName}</td>
                      <td className={TD}>{r.rank}</td>
                      {byWard && <td className={TD}>{r.ward ?? ""}</td>}
                      <td className={TD}><StatusBadge tone={r.signedUp ? "success" : "neutral"}>{r.signedUp ? "Signed up" : "Waiting to sign up"}</StatusBadge></td>
                      <td className={TD}>
                        <span className="flex gap-2">
                          <Button variant="secondary" onClick={() => { setEditing(r.id); setForm({ fullName: r.fullName, rank: r.rank, departmentId: r.departmentId ?? "" }); setFields({}); }}>Change</Button>
                          <Button variant="quiet" onClick={() => remove(r)}>Remove</Button>
                        </span>
                      </td>
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
