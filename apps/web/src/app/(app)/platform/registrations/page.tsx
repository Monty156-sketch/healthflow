"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import { Button, EmptyState, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, StatusBadge } from "@/components/ui";

interface Row {
  id: string; name: string; type: string; region: string | null; district: string | null; status: string; note: string | null; registeredAt: string;
  plan: string | null; departments: number; cadres: number; administrator: { name: string | null; email: string; phone: string | null } | null;
}
interface Data { pending: Row[]; declined: Row[] }

const words = (t: string) => t.toLowerCase().replace(/_/g, " ");

export default function RegistrationsPage() {
  const { data, error, reload } = useResource<Data>("/api/platform/registrations");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [declining, setDeclining] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "block"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading registrations" />;

  async function decide(id: string, action: "approve" | "decline") {
    setMsg(null);
    setBusy(id);
    try {
      await api.post(`/api/platform/facilities/${id}/${action}`, action === "decline" ? { reason: reasons[id] ?? "" } : {});
      setMsg({ tone: "success", text: action === "approve" ? "Approved. The 30 day trial has started and the administrator has been emailed." : "Declined. The administrator has been told why." });
      setDeclining(null);
      reload();
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { message?: string; fields?: Record<string, string> }) : undefined;
      setMsg({ tone: "block", text: b?.message ?? (b?.fields ? Object.values(b.fields)[0] : "That did not work. Try again.") });
    } finally { setBusy(null); }
  }

  const card = (r: Row, declined: boolean) => (
    <li key={r.id} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{r.name}</h3>
          <p className="text-sm text-[var(--muted)]">{[words(r.type), r.district, r.region].filter(Boolean).join(" · ")}</p>
        </div>
        <StatusBadge tone={declined ? "block" : "warning"}>{declined ? "Declined" : `Registered ${showDate(r.registeredAt)}`}</StatusBadge>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-[15px] sm:grid-cols-[10rem_1fr]">
        <dt className="text-[var(--muted)]">Administrator</dt><dd>{r.administrator?.name ?? "Not recorded"}</dd>
        <dt className="text-[var(--muted)]">Contact</dt><dd>{[r.administrator?.phone, r.administrator?.email].filter(Boolean).join(" · ")}</dd>
        <dt className="text-[var(--muted)]">Plan chosen</dt><dd>{r.plan ?? "None"}</dd>
        <dt className="text-[var(--muted)]">Set up with</dt><dd>{r.departments} departments, {r.cadres} cadres</dd>
        {declined && r.note && <><dt className="text-[var(--muted)]">Reason given</dt><dd>{r.note}</dd></>}
      </dl>
      <p className="mt-2 text-sm text-[var(--muted)]">Check it is real before you approve: telephone the number above and, where you can, confirm the facility with the district.</p>
      {declining === r.id ? (
        <div className="mt-3 max-w-lg space-y-2">
          <Field label="Why is it not approved? The facility will read this.">{(a) => <Input {...a} value={reasons[r.id] ?? ""} onChange={(e) => setReasons((x) => ({ ...x, [r.id]: e.target.value }))} />}</Field>
          <div className="flex gap-2">
            <Button variant="danger" disabled={busy === r.id} onClick={() => decide(r.id, "decline")}>Decline registration</Button>
            <Button variant="quiet" onClick={() => setDeclining(null)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={busy === r.id} onClick={() => decide(r.id, "approve")}>{declined ? "Approve after all" : "Approve and start trial"}</Button>
          {!declined && <Button variant="secondary" onClick={() => setDeclining(r.id)}>Decline</Button>}
        </div>
      )}
    </li>
  );

  return (
    <>
      <PageHeader title="Registrations" description="New facilities register themselves, then wait here. Nothing opens for them, and their staff cannot join, until you approve. The 30 day trial starts on approval." />
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <Panel title={`Waiting for approval (${data.pending.length})`}>
        {data.pending.length === 0 ? <EmptyState title="Nothing waiting">New registrations appear here and in your email.</EmptyState> : <ul className="space-y-3">{data.pending.map((r) => card(r, false))}</ul>}
      </Panel>
      {data.declined.length > 0 && (
        <div className="mt-6">
          <Panel title="Declined"><ul className="space-y-3">{data.declined.map((r) => card(r, true))}</ul></Panel>
        </div>
      )}
    </>
  );
}
