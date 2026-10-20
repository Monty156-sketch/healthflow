"use client";

import { useState } from "react";
import { useFacility } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import type { Ledger, LedgerEntryRow } from "@/lib/types";
import { Button, EmptyState, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Select, StatusBadge, TableScroll, Textarea } from "@/components/ui";

const STATUS: Record<LedgerEntryRow["status"], { word: string; tone: "neutral" | "success" | "warning" | "block" }> = {
  OPEN: { word: "Open", tone: "warning" },
  PARTLY_SETTLED: { word: "Partly settled", tone: "warning" },
  SETTLED: { word: "Settled", tone: "success" },
  WRITTEN_OFF: { word: "Written off", tone: "neutral" },
  EXPIRED: { word: "Expired", tone: "neutral" },
};
const WHY: Record<LedgerEntryRow["reason"], string> = { ABSENCE_COVER: "Absence cover", SWAP_HANDOVER: "Duty handed over", MANUAL_ADJUSTMENT: "Recorded by hand" };

function Adjust({ people, onDone }: { people: { id: string; name: string }[]; onDone: () => void }) {
  const [debtorId, setDebtor] = useState("");
  const [creditorId, setCreditor] = useState("");
  const [duties, setDuties] = useState("1");
  const [note, setNote] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setFields({});
    setProblem(null);
    try {
      await api.post("/api/facility/ledger/adjust", { debtorId, creditorId, duties: Number(duties), note });
      setNote("");
      setDebtor("");
      setCreditor("");
      onDone();
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { fields?: Record<string, string>; message?: string }) : undefined;
      if (b?.fields) setFields(b.fields);
      else setProblem(b?.message ?? "It was not saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  const opts = (
    <>
      <option value="">Choose a person</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </>
  );
  return (
    <Panel title="Record a debt by hand" description="Every entry has two sides: one person owes, the other is owed.">
      <div className="grid max-w-2xl gap-4 sm:grid-cols-3">
        <Field label="Owes the duties" error={fields.debtorId}>{(a) => <Select {...a} value={debtorId} onChange={(e) => setDebtor(e.target.value)}>{opts}</Select>}</Field>
        <Field label="Is owed them" error={fields.creditorId}>{(a) => <Select {...a} value={creditorId} onChange={(e) => setCreditor(e.target.value)}>{opts}</Select>}</Field>
        <Field label="Duties" error={fields.duties}>{(a) => <Input {...a} inputMode="numeric" value={duties} onChange={(e) => setDuties(e.target.value.replace(/\D/g, ""))} />}</Field>
      </div>
      <div className="mt-4 max-w-2xl">
        <Field label="Why" hint="At least 10 characters. It goes in the audit log." error={fields.note}>{(a) => <Textarea {...a} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
      {problem && <div className="mt-3"><Notice tone="block">{problem}</Notice></div>}
      <div className="mt-4">
        <Button disabled={busy || !debtorId || !creditorId || !Number(duties)} onClick={save}>Record</Button>
      </div>
    </Panel>
  );
}

function EntryActions({ e, admin, onDone }: { e: LedgerEntryRow; admin: boolean; onDone: () => void }) {
  const [mode, setMode] = useState<"off" | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!["OPEN", "PARTLY_SETTLED"].includes(e.status)) return null;
  async function run(path: string, body: object) {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/api/facility/ledger/entries/${e.id}/${path}`, body);
      setMode(null);
      onDone();
    } catch (x) {
      const b = x instanceof ApiError ? (x.body as { fields?: Record<string, string>; message?: string }) : undefined;
      setErr(b?.fields?.reason ?? b?.message ?? "That did not work. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => run("settle", { duties: 1 })} aria-label={`Settle one duty for ${e.staffName}`}>Settle one</Button>
        {admin && <Button variant="quiet" disabled={busy} onClick={() => setMode("off")}>Write off</Button>}
      </div>
      {mode === "off" && (
        <div className="w-64 space-y-2 text-left">
          <Field label="Why write this off?" error={err ?? undefined}>{(a) => <Textarea {...a} value={reason} onChange={(ev) => setReason(ev.target.value)} />}</Field>
          <p className="text-sm text-[var(--muted)]">Both sides of the entry are written off together.</p>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => run("write-off", { reason })}>Write off</Button>
            <Button variant="quiet" onClick={() => setMode(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {mode !== "off" && err && <span className="text-sm text-[var(--status-block)]">{err}</span>}
    </div>
  );
}

export default function LedgerPage() {
  const facility = useFacility();
  const admin = facility.me.role === "FACILITY_ADMIN";
  const { data, error, reload } = useResource<Ledger>("/api/facility/ledger");
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading the ledger" />;
  return (
    <>
      <PageHeader title="Duty ledger" description="Who owes duties and who is owed them." />
      <p className="figures mb-6 text-[15px] font-medium" aria-live="polite">{data.summary.line}</p>

      {data.people.length === 0 ? (
        <EmptyState title="Nobody owes or is owed any duties">Nothing owed.</EmptyState>
      ) : (
        <TableScroll label="Open balances, scrolls sideways on small screens">
          <table className="w-full min-w-[30rem] border-collapse text-left text-[15px]">
            <caption className="sr-only">Open balances</caption>
            <thead>
              <tr className="text-sm text-[var(--muted)]">
                {["Person", "Owes", "Is owed"].map((h) => (<th key={h} scope="col" className="border-b border-[var(--border-strong)] px-3 py-2 font-medium">{h}</th>))}
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.staffId}>
                  <th scope="row" className="border-b border-[var(--border)] px-3 py-2 font-medium">{p.name}{p.cadre && <span className="block text-sm font-normal text-[var(--muted)]">{p.cadre}</span>}</th>
                  <td className="figures border-b border-[var(--border)] px-3 py-2">{p.owes || ""}</td>
                  <td className="figures border-b border-[var(--border)] px-3 py-2">{p.owed || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      <h2 className="mb-2 mt-8 text-lg font-semibold">Entries</h2>
      {data.entries.length === 0 ? (
        <p className="text-[15px] text-[var(--muted)]">No entries yet.</p>
      ) : (
        <TableScroll label="Ledger entries, scrolls sideways on small screens">
          <table className="w-full min-w-[46rem] border-collapse text-left text-[15px]">
            <caption className="sr-only">Ledger entries</caption>
            <thead>
              <tr className="text-sm text-[var(--muted)]">
                {["Person", "Entry", "Duties", "What happened", "Status", ""].map((h, i) => (
                  <th key={i} scope="col" className="border-b border-[var(--border-strong)] px-3 py-2 font-medium">{h || <span className="sr-only">Actions</span>}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id} className="align-top">
                  <th scope="row" className="border-b border-[var(--border)] px-3 py-2 font-medium">{e.staffName}</th>
                  <td className="border-b border-[var(--border)] px-3 py-2">{e.type === "DEBT" ? "Owes" : "Is owed"}{e.counterparty ? <span className="block text-sm text-[var(--muted)]">{e.type === "DEBT" ? "to" : "by"} {e.counterparty}</span> : null}</td>
                  <td className="figures border-b border-[var(--border)] px-3 py-2">{e.duties - e.settled} of {e.duties}</td>
                  <td className="border-b border-[var(--border)] px-3 py-2">
                    {WHY[e.reason]}, {showDate(e.createdAt)}
                    {e.description && <span className="block text-sm text-[var(--muted)]">{e.description}</span>}
                    {e.writtenOffReason && <span className="block text-sm text-[var(--muted)]">Written off: {e.writtenOffReason}</span>}
                  </td>
                  <td className="border-b border-[var(--border)] px-3 py-2"><StatusBadge tone={STATUS[e.status].tone}>{STATUS[e.status].word}</StatusBadge></td>
                  <td className="border-b border-[var(--border)] px-3 py-2 text-right"><EntryActions e={e} admin={admin} onDone={reload} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      <div className="mt-8"><Adjust people={data.staff} onDone={reload} /></div>
    </>
  );
}
