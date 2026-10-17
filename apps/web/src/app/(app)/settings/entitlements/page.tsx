"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import type { EntitlementRow } from "@/lib/types";
import { Button, EmptyState, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Select, TableScroll } from "@/components/ui";

interface Data {
  year: number;
  types: { id: string; name: string; code: string }[];
  leaveTypeId: string | null;
  rows: EntitlementRow[];
}

function Sheet({ data, reload }: { data: Data; reload: () => void }) {
  const [edits, setEdits] = useState<Record<string, { e: string; c: string }>>({});
  const [bulk, setBulk] = useState("");
  const [onlyUnset, setOnlyUnset] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "block"; text: string } | null>(null);
  const unset = data.rows.filter((r) => !r.configured).length;
  const val = (r: EntitlementRow) => edits[r.staffId] ?? { e: r.daysEntitled === null ? "" : String(r.daysEntitled), c: String(r.daysCarriedOver) };
  const put = (id: string, r: EntitlementRow, patch: Partial<{ e: string; c: string }>) => setEdits((o) => ({ ...o, [id]: { ...val(r), ...patch } }));
  const fail = (err: unknown) => setMsg({ tone: "block", text: err instanceof ApiError && (err.body as { fields?: Record<string, string> })?.fields ? "Check the figures. Days cannot be negative or more than a year." : "It was not saved. Check your connection and try again." });

  async function saveEdits() {
    const entries = Object.entries(edits).filter(([, v]) => v.e !== "").map(([staffId, v]) => ({ staffId, daysEntitled: Number(v.e), daysCarriedOver: Number(v.c) || 0 }));
    if (!entries.length) return setMsg({ tone: "block", text: "Nothing to save yet. Enter the days for at least one person." });
    setBusy(true);
    try {
      const r = await api.put<{ saved: number }>("/api/facility/entitlements", { year: data.year, leaveTypeId: data.leaveTypeId, entries });
      setMsg({ tone: "success", text: `Saved ${r.saved} ${r.saved === 1 ? "person" : "people"}.` });
      setEdits({});
      reload();
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function setAll() {
    if (bulk === "") return;
    setBusy(true);
    try {
      const r = await api.post<{ saved: number }>("/api/facility/entitlements/set-all", { year: data.year, leaveTypeId: data.leaveTypeId, daysEntitled: Number(bulk), onlyUnset });
      setMsg({ tone: "success", text: `Set ${bulk} days for ${r.saved} ${r.saved === 1 ? "person" : "people"}.` });
      setBulk("");
      setEdits({});
      reload();
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      {unset > 0 && <Notice tone="warning">{unset} {unset === 1 ? "person has" : "people have"} no figure set. The figure comes from your conditions of service and can differ by grade, so nothing is filled in for you.</Notice>}
      <Panel title="Set for all staff" description="For a figure that is the same for everyone. Anyone can still be changed below.">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Days a year">{(a) => <Input {...a} className="figures w-28" inputMode="decimal" value={bulk} onChange={(e) => setBulk(e.target.value.replace(/[^\d.]/g, ""))} />}</Field>
          <label className="flex min-h-11 items-center gap-2 text-[15px]"><input type="checkbox" checked={onlyUnset} onChange={(e) => setOnlyUnset(e.target.checked)} /> Only people with no figure yet</label>
          <Button disabled={busy || bulk === ""} onClick={setAll}>Set for all</Button>
        </div>
      </Panel>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <TableScroll label="Entitlements, scrolls sideways on small screens">
        <table className="w-full min-w-[42rem] border-collapse text-left text-[15px]">
          <caption className="sr-only">Leave entitlements by person</caption>
          <thead>
            <tr className="text-sm text-[var(--muted)]">
              {["Person", "Days a year", "Carried over", "Taken", "Pending", "Left"].map((h) => (<th key={h} scope="col" className="border-b border-[var(--border-strong)] px-3 py-2 font-medium">{h}</th>))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const v = val(r);
              return (
                <tr key={r.staffId}>
                  <th scope="row" className="border-b border-[var(--border)] px-3 py-2 font-medium">{r.name}{r.cadre && <span className="font-normal text-[var(--muted)]">, {r.cadre}</span>}</th>
                  <td className="border-b border-[var(--border)] px-3 py-1">
                    <Input aria-label={`Days a year for ${r.name}`} className="figures w-24" inputMode="decimal" placeholder="Not set" value={v.e} onChange={(e) => put(r.staffId, r, { e: e.target.value.replace(/[^\d.]/g, "") })} />
                  </td>
                  <td className="border-b border-[var(--border)] px-3 py-1">
                    <Input aria-label={`Days carried over for ${r.name}`} className="figures w-24" inputMode="decimal" value={v.c} onChange={(e) => put(r.staffId, r, { c: e.target.value.replace(/[^\d.]/g, "") })} />
                  </td>
                  <td className="figures border-b border-[var(--border)] px-3 py-2">{r.taken}</td>
                  <td className="figures border-b border-[var(--border)] px-3 py-2">{r.pending}</td>
                  <td className="figures border-b border-[var(--border)] px-3 py-2">{r.remaining === null ? "Not set" : r.remaining}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
      <Button disabled={busy || Object.keys(edits).length === 0} onClick={saveEdits}>{busy ? "Saving…" : "Save changes"}</Button>
    </div>
  );
}

export default function EntitlementsPage() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [typeId, setTypeId] = useState("");
  const { data, error, reload } = useResource<Data>(`/api/facility/entitlements?year=${year}${typeId ? `&leaveTypeId=${typeId}` : ""}`);

  return (
    <>
      <PageHeader title="Leave entitlements" description="Days each person has for the year. Taken, pending and left are worked out from approved and waiting requests." />
      <div className="mb-4 flex flex-wrap gap-3">
        <div>
          <label htmlFor="en-year" className="mb-1 block text-sm font-medium">Year</label>
          <Select id="en-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[thisYear - 1, thisYear, thisYear + 1].map((y) => (<option key={y}>{y}</option>))}
          </Select>
        </div>
        <div>
          <label htmlFor="en-type" className="mb-1 block text-sm font-medium">Leave type</label>
          <Select id="en-type" value={typeId || data?.leaveTypeId || ""} onChange={(e) => setTypeId(e.target.value)}>
            {(data?.types ?? []).map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
          </Select>
        </div>
      </div>
      {error && !data ? (
        <LoadError onRetry={reload} />
      ) : !data ? (
        <Loading label="Loading entitlements" />
      ) : !data.leaveTypeId ? (
        <EmptyState title="No leave type counts against an entitlement">Turn that on for a leave type under Leave types first.</EmptyState>
      ) : (
        <Sheet key={`${data.year}-${data.leaveTypeId}`} data={data} reload={reload} />
      )}
    </>
  );
}
