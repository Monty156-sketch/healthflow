"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import { Button, EmptyState, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Select, StatusBadge } from "@/components/ui";

interface Cred {
  id: string; staffId: string; kind: string; number: string | null; issuer: string | null; issuedOn: string | null; expiresOn: string | null; noExpiry: boolean;
  verified: boolean; verifiedBy: string | null; state: "VALID" | "EXPIRING" | "EXPIRED" | "NO_EXPIRY" | "NO_DATE"; daysLeft: number | null;
  name?: string; staffNo?: string; cadre?: string | null; department?: string | null;
}
interface Summary { expired: number; expiring: number; unverified: number; missingCount: number; missing: { staffId: string; name: string; staffNo: string; cadre: string; kind: string }[] }
interface Cadre { id: string; name: string; requiredCredentials: string[] }

const STATE = {
  EXPIRED: { tone: "block", word: (c: Cred) => `Lapsed ${Math.abs(c.daysLeft ?? 0)} ${Math.abs(c.daysLeft ?? 0) === 1 ? "day" : "days"} ago` },
  EXPIRING: { tone: "warning", word: (c: Cred) => `Lapses in ${c.daysLeft} ${c.daysLeft === 1 ? "day" : "days"}` },
  VALID: { tone: "success", word: () => "In date" },
  NO_EXPIRY: { tone: "neutral", word: () => "Does not lapse" },
  NO_DATE: { tone: "neutral", word: () => "No date" },
} as const;

function CredForm({ people, own, initial, onDone, onCancel }: { people: { id: string; fullName: string; staffNo: string }[]; own: boolean; initial?: Cred; onDone: () => void; onCancel: () => void }) {
  const kinds = useResource<{ kinds: string[] }>("/api/facility/credentials/kinds");
  const [staffId, setStaffId] = useState(initial?.staffId ?? "");
  const [kind, setKind] = useState(initial?.kind ?? "");
  const [number, setNumber] = useState(initial?.number ?? "");
  const [issuer, setIssuer] = useState(initial?.issuer ?? "");
  const [issuedOn, setIssuedOn] = useState(initial?.issuedOn ?? "");
  const [expiresOn, setExpiresOn] = useState(initial?.expiresOn ?? "");
  const [noExpiry, setNoExpiry] = useState(initial?.noExpiry ?? false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function save() {
    setBusy(true); setProblem(null); setFields({});
    const payload = { staffId: own ? undefined : staffId, kind, number: number || null, issuer: issuer || null, issuedOn: issuedOn || null, expiresOn: noExpiry ? null : expiresOn || null, noExpiry };
    try {
      if (initial) await api.put(`/api/facility/credentials/${initial.id}`, payload);
      else await api.post("/api/facility/credentials", payload);
      onDone();
    } catch (e) {
      const f = e instanceof ApiError && typeof e.body === "object" && e.body && "fields" in e.body ? ((e.body as { fields: Record<string, string> }).fields) : null;
      if (f) setFields(f);
      setProblem(f ? "Check the details marked below." : "It could not be saved. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  return (
    <Panel title={initial ? "Change licence or certificate" : "Add a licence or certificate"}>
      <div className="grid gap-4 sm:grid-cols-2">
        {!own && !initial && (
          <Field label="Person" error={fields.staffId}>{(a) => (
            <Select {...a} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">Choose a person</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.fullName} ({p.staffNo})</option>)}
            </Select>
          )}</Field>
        )}
        <Field label="What it is" error={fields.kind}>{(a) => (
          <>
            <Input {...a} list="credential-kinds" value={kind} onChange={(e) => setKind(e.target.value)} />
            <datalist id="credential-kinds">{(kinds.data?.kinds ?? []).map((k) => <option key={k} value={k} />)}</datalist>
          </>
        )}</Field>
        <Field label="Number" optional error={fields.number}>{(a) => <Input {...a} value={number} onChange={(e) => setNumber(e.target.value)} />}</Field>
        <Field label="Issued by" optional error={fields.issuer}>{(a) => <Input {...a} value={issuer} onChange={(e) => setIssuer(e.target.value)} />}</Field>
        <Field label="Issued on" optional error={fields.issuedOn}>{(a) => <Input {...a} type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />}</Field>
        <Field label="Lapses on" error={fields.expiresOn}>{(a) => <Input {...a} type="date" disabled={noExpiry} value={noExpiry ? "" : expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />}</Field>
      </div>
      <label className="mt-3 flex min-h-11 items-center gap-2 text-[15px]">
        <input type="checkbox" className="size-5" checked={noExpiry} onChange={(e) => setNoExpiry(e.target.checked)} />
        This one does not lapse
      </label>
      {own && <p className="mt-2 text-sm text-[var(--muted)]">Your administrator checks the original before it counts as verified.</p>}
      {problem && <div className="mt-3"><Notice tone="block">{problem}</Notice></div>}
      <div className="mt-4 flex gap-3">
        <Button disabled={busy || !kind.trim()} onClick={save}>{busy ? "Saving…" : "Save"}</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </Panel>
  );
}

function Requirements() {
  const { data, error, reload } = useResource<{ cadres: Cadre[] }>("/api/facility/credentials/requirements");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (error && !data) return null;
  if (!data) return null;
  async function save(c: Cadre) {
    setBusy(c.id);
    try {
      const kinds = (draft[c.id] ?? c.requiredCredentials.join("\n")).split("\n").map((s) => s.trim()).filter(Boolean);
      await api.put(`/api/facility/credentials/requirements/${c.id}`, { kinds });
      reload();
    } finally { setBusy(null); }
  }
  return (
    <Panel title="What each cadre must hold">
      <Button variant="secondary" onClick={() => setOpen(!open)}>{open ? "Hide" : "Set requirements"}</Button>
      {open && (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-[var(--muted)]">One per line, for example the council licence. Anyone in the cadre without a current one is listed as missing.</p>
          {data.cadres.map((c) => (
            <div key={c.id} className="grid gap-2 sm:grid-cols-[14rem_1fr_auto] sm:items-start">
              <p className="pt-2 text-[15px] font-medium">{c.name}</p>
              <textarea
                aria-label={`Required for ${c.name}`}
                className="min-h-20 w-full rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-[15px]"
                defaultValue={c.requiredCredentials.join("\n")}
                onChange={(e) => setDraft({ ...draft, [c.id]: e.target.value })}
              />
              <Button variant="secondary" disabled={busy === c.id || draft[c.id] === undefined} onClick={() => save(c)}>{busy === c.id ? "Saving…" : "Save"}</Button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export default function LicencesPage() {
  const { user } = useAuth();
  const manager = user?.role !== "STAFF";
  const admin = user?.role === "FACILITY_ADMIN";
  const [filter, setFilter] = useState<"attention" | "unverified" | "all">("attention");
  const list = useResource<{ credentials: Cred[]; total?: number }>(manager ? `/api/facility/credentials?filter=${filter}` : "/api/facility/credentials/mine");
  const summary = useResource<Summary>(manager ? "/api/facility/credentials/summary" : null);
  const people = useResource<{ staff: { id: string; fullName: string; staffNo: string }[] }>(admin ? "/api/facility/staff?show=current" : null);
  const [form, setForm] = useState<{ editing?: Cred } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = () => { list.reload(); summary.reload(); setForm(null); };
  async function act(fn: () => Promise<unknown>) {
    setProblem(null);
    try { await fn(); refresh(); } catch { setProblem("That did not go through. Check your connection and try again."); }
  }

  if (list.error && !list.data) return <LoadError onRetry={list.reload} />;
  if (!list.data) return <Loading />;
  const rows = list.data.credentials;
  const canAdd = admin || !manager || Boolean(user);

  return (
    <>
      <PageHeader
        title={manager ? "Licences and certificates" : "My licences"}
        description={manager ? "Council licences and training certificates, with the dates they lapse. People are reminded 60, 30 and 7 days ahead, and you get one summary." : "Keep your licence dates here. You are reminded before each one lapses."}
      />
      {manager && summary.data && (
        <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[["Lapsed", summary.data.expired], ["Lapsing within 60 days", summary.data.expiring], ["Missing a required one", summary.data.missingCount], ["Not yet checked", summary.data.unverified]].map(([label, n]) => (
            <div key={label as string} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <dd className="figures text-2xl font-semibold">{n as number}</dd>
              <dt className="text-sm text-[var(--muted)]">{label}</dt>
            </div>
          ))}
        </dl>
      )}
      {problem && <div className="mb-4"><Notice tone="block">{problem}</Notice></div>}
      {form ? (
        <CredForm people={people.data?.staff ?? []} own={!admin} initial={form.editing} onDone={refresh} onCancel={() => setForm(null)} />
      ) : (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          {manager && (
            <div className="max-w-[16rem]">
              <Field label="Show">{(a) => (
                <Select {...a} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                  <option value="attention">Lapsed or lapsing</option>
                  <option value="unverified">Not yet checked</option>
                  <option value="all">Everything</option>
                </Select>
              )}</Field>
            </div>
          )}
          {canAdd && (admin || !manager) && <Button onClick={() => setForm({})}>Add a licence</Button>}
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState title={manager ? (filter === "attention" ? "Nothing is lapsing" : "Nothing recorded") : "You have not added any"}>
          {manager ? "Add licences and certificates so the dates are watched for you." : "Add your council licence and any training certificates."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[15px]">
            <thead>
              <tr className="text-sm text-[var(--muted)]">
                {[...(manager ? ["Name"] : []), "Licence or certificate", "Lapses on", "Status", "Checked", ""].map((h, i) => <th key={i} className="border-b border-[var(--border-strong)] px-3 py-2 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  {manager && <td className="border-b border-[var(--border)] px-3 py-2">{c.name}<span className="block text-xs text-[var(--muted)]">{c.staffNo}{c.cadre ? `, ${c.cadre}` : ""}{c.department ? `, ${c.department}` : ""}</span></td>}
                  <td className="border-b border-[var(--border)] px-3 py-2">{c.kind}<span className="block text-xs text-[var(--muted)]">{[c.number, c.issuer].filter(Boolean).join(", ")}</span></td>
                  <td className="figures border-b border-[var(--border)] px-3 py-2">{c.expiresOn ? showDate(c.expiresOn) : "None"}</td>
                  <td className="border-b border-[var(--border)] px-3 py-2"><StatusBadge tone={STATE[c.state].tone}>{STATE[c.state].word(c)}</StatusBadge></td>
                  <td className="border-b border-[var(--border)] px-3 py-2 text-sm">{c.verified ? `Checked by ${c.verifiedBy}` : "Not yet"}</td>
                  <td className="border-b border-[var(--border)] px-3 py-2 text-right whitespace-nowrap">
                    {admin && !c.verified && <Button variant="secondary" onClick={() => act(() => api.post(`/api/facility/credentials/${c.id}/verify`))}>Mark checked</Button>}{" "}
                    {(admin || !manager) && <Button variant="secondary" onClick={() => setForm({ editing: c })}>Change</Button>}{" "}
                    {(admin || !manager) && <Button variant="secondary" onClick={() => act(() => api.delete(`/api/facility/credentials/${c.id}`))}>Remove</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {manager && summary.data && summary.data.missing.length > 0 && (
        <div className="mt-6">
          <Panel title="Missing something required">
            <ul className="divide-y divide-[var(--border)] text-[15px]">
              {summary.data.missing.map((m) => <li key={`${m.staffId}-${m.kind}`} className="py-2">{m.name} <span className="text-sm text-[var(--muted)]">({m.staffNo}, {m.cadre})</span>: {m.kind}</li>)}
            </ul>
          </Panel>
        </div>
      )}
      {admin && <div className="mt-6"><Requirements /></div>}
    </>
  );
}
