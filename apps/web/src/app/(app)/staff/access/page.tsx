"use client";

import { useState } from "react";
import { useFacility } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import type { Cadre, Department } from "@/lib/types";
import { Button, Checkbox, EmptyState, ErrorText, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Select, TableScroll, TD, TH } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { QrCode } from "@/components/QrCode";

interface Code { code: string; active: boolean; requiresApproval: boolean; usesCount: number; maxUses: number | null; expiresAt: string | null; problem: string | null; joinUrl: string; phoneCheck: boolean }
interface Pending { id: string; fullName: string; requestedInCharge: boolean; staffNo: string; phone: string | null; email: string | null; position: string | null; requestedCadre: string | null; requestedDepartment: string | null; createdAt: string; cadre: { id: string; name: string } | null; department: { id: string; name: string } | null }

const say = (e: unknown, fallback: string) => (e instanceof ApiError ? ((e.body as { message?: string } | undefined)?.message ?? fallback) : fallback);

function Waiting({ onChanged, ward }: { onChanged: () => void; ward: boolean }) {
  const list = useResource<{ pending: Pending[] }>("/api/facility/join/pending");
  const cadres = useResource<{ cadres: Cadre[] }>("/api/facility/cadres");
  const departments = useResource<{ departments: Department[] }>("/api/facility/departments");
  const [picked, setPicked] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState({ fullName: "", cadreId: "", departmentId: "", inCharge: false });
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (list.error && !list.data) return <LoadError onRetry={list.reload} />;
  if (!list.data) return <Loading label="Loading people waiting" />;
  const rows = list.data.pending;

  async function run(path: string, body: object) {
    setBusy(true);
    setError(null);
    try {
      await api.post(path, body);
      setPicked([]);
      setEditing(null);
      setRejecting(false);
      setReason("");
      list.reload();
      onChanged();
    } catch (e) {
      setError(say(e, "That could not be done. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Waiting for approval" description="Approve each person before they can sign in.">
      {rows.length === 0 ? (
        <EmptyState title="No one is waiting">New registrations appear here.</EmptyState>
      ) : (
        <>
          <TableScroll label="People waiting for approval">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead><tr><th className={TH}>Select</th><th className={TH}>Name</th><th className={TH}>Staff number</th><th className={TH}>Cadre and department</th><th className={TH}>Contact</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td className={TD}><Checkbox label={`Select ${p.fullName}`} checked={picked.includes(p.id)} onChange={(on) => setPicked((x) => (on ? [...x, p.id] : x.filter((i) => i !== p.id)))} /></td>
                    <td className={TD}>{p.fullName}{p.requestedInCharge && <span className="block text-[13px] text-[var(--muted)]">Ward in-charge</span>}</td>
                    <td className={TD}>{p.staffNo}</td>
                    <td className={TD}>{p.cadre?.name ?? (p.requestedCadre ? `${p.requestedCadre} (typed)` : "Not given")}, {p.department?.name ?? (p.requestedDepartment ? `${p.requestedDepartment} (typed)` : "none")}</td>
                    <td className={TD}>{p.email}{p.phone ? `, ${p.phone}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          {error && <div className="mt-3"><ErrorText>{error}</ErrorText></div>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={busy || picked.length === 0} onClick={() => run("/api/facility/join/approve", { staffIds: picked })}>Approve selected</Button>
            <Button variant="secondary" disabled={busy || picked.length !== 1} onClick={() => { const p = rows.find((r) => r.id === picked[0])!; setEdit({ fullName: p.fullName, cadreId: p.cadre?.id ?? "", departmentId: p.department?.id ?? "", inCharge: p.requestedInCharge }); setEditing(p.id); }}>Correct, then approve</Button>
            <Button variant="secondary" disabled={busy || picked.length === 0} onClick={() => setRejecting(true)}>Decline selected</Button>
          </div>
          {editing && (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Field label="Full name">{(a) => <Input {...a} value={edit.fullName} onChange={(e) => setEdit({ ...edit, fullName: e.target.value })} />}</Field>
              <Field label="Cadre">{(a) => <Select {...a} value={edit.cadreId} onChange={(e) => setEdit({ ...edit, cadreId: e.target.value })}><option value="">None</option>{cadres.data?.cadres.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
              {!ward && <Field label="Department">{(a) => <Select {...a} value={edit.departmentId} onChange={(e) => setEdit({ ...edit, departmentId: e.target.value })}><option value="">None</option>{departments.data?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}</Field>}
              {rows.find((r) => r.id === editing)?.requestedInCharge && <div className="sm:col-span-3"><Checkbox label="Approve as in-charge of this ward" checked={edit.inCharge} onChange={(on) => setEdit({ ...edit, inCharge: on })} /></div>}
              <div className="sm:col-span-3"><Button disabled={busy || !edit.fullName.trim()} onClick={() => run("/api/facility/join/approve", { staffIds: [editing], fullName: edit.fullName, cadreId: edit.cadreId || null, ...(ward ? {} : { departmentId: edit.departmentId || null, asInCharge: edit.inCharge }) })}>Approve with these details</Button></div>
            </div>
          )}
          {rejecting && (
            <div className="mt-4 max-w-md space-y-3">
              <Field label="Reason (sent to them by text)">{(a) => <Input {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
              <Button disabled={busy || reason.trim().length < 3} onClick={() => run("/api/facility/join/reject", { staffIds: picked, reason })}>Decline</Button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

export default function AccessCodePage() {
  const { isAdmin, facility, me } = useFacility();
  const code = useResource<Code>(isAdmin ? "/api/facility/join/code" : null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);

  if (!isAdmin && me.departmentId) {
    return (
      <>
        <PageHeader title="Waiting for approval" description="Staff who registered for your ward." />
        <Waiting ward onChanged={() => undefined} />
      </>
    );
  }
  if (!isAdmin) return <Notice tone="warning">Only the facility administrator manages the access code.</Notice>;
  if (code.error && !code.data) return <LoadError onRetry={code.reload} />;
  if (!code.data) return <Loading label="Loading the access code" />;
  const c = code.data;

  async function act(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      code.reload();
      if (done) setNote(done);
    } catch (e) {
      setNote(say(e, "That could not be saved. Try again."));
    } finally {
      setBusy(false);
      setConfirmNew(false);
    }
  }
  const message = `Join ${facility?.name ?? "our facility"} on HealthFlow. Open ${c.joinUrl} or go to the HealthFlow site, choose "Join with your facility code" and enter ${c.code}.`;

  return (
    <>
      <div className="no-print">
        <PageHeader title="Staff access code" description="Staff register with this code." />
        <Panel title="Your code">
          <p className="figures text-3xl font-semibold tracking-wide" aria-label={`Access code ${c.code.split("").join(" ")}`}>{c.code}</p>
          <p className="mt-2 text-sm text-[var(--muted)]">{c.problem ? "People cannot use it right now." : "People can use it now."} Used {c.usesCount} {c.usesCount === 1 ? "time" : "times"}{c.maxUses !== null ? ` of ${c.maxUses}` : ""}.</p>
          {note && <div className="mt-3"><Notice tone="warning">{note}</Notice></div>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(c.code).then(() => setNote("Code copied."), () => setNote("Copy did not work. Select the code and copy it."))}>Copy code</Button>
            <a className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-4 text-sm font-medium" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>
            <PrintButton label="Print notice" />
            {confirmNew ? (
              <Button disabled={busy} onClick={() => act(() => api.post("/api/facility/join/code/regenerate", {}), "New code made. The old one no longer works.")}>Yes, make a new code</Button>
            ) : (
              <Button variant="secondary" onClick={() => setConfirmNew(true)}>Make a new code</Button>
            )}
          </div>
          {confirmNew && <p className="mt-2 text-sm text-[var(--muted)]">The old code stops working at once.</p>}
        </Panel>
        <div className="mt-6 space-y-6">
          <Panel title="Settings">
            <div className="space-y-3">
              <Checkbox label="The code is on" checked={c.active} disabled={busy} onChange={(on) => act(() => api.put("/api/facility/join/code", { active: on, requiresApproval: c.requiresApproval }))} />
              <Checkbox label="I approve each person before they can sign in" checked={c.requiresApproval} disabled={busy} onChange={(on) => act(() => api.put("/api/facility/join/code", { active: c.active, requiresApproval: on }))} />
              <p className="ml-8 text-sm text-[var(--muted)]">With approval off, anyone with the code gets in at once.</p>
            </div>
          </Panel>
          <Waiting ward={false} onChanged={code.reload} />
        </div>
      </div>
      <div className="hidden print:block">
        <h1 className="text-3xl font-semibold">Join {facility?.name ?? "our facility"} on HealthFlow</h1>
        <p className="mt-4 text-xl">Staff access code</p>
        <p className="figures mt-2 text-6xl font-semibold">{c.code}</p>
        <div className="mt-6 flex items-start gap-8">
          <QrCode value={c.joinUrl} size={220} label={`QR code that opens the sign-up page with the code ${c.code}`} />
          <ol className="list-decimal pl-6 text-xl leading-relaxed">
            <li>Point your phone camera at the square. The code is filled in for you.</li>
            <li>Or open {c.joinUrl.replace(/\/join\/.*/, "")} and choose “Join with your facility code”.</li>
            <li>Enter your name and staff number.</li>
            <li>Wait for your in-charge to approve you.</li>
          </ol>
        </div>
      </div>
    </>
  );
}
