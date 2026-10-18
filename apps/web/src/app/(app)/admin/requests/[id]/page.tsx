"use client";

import Link from "next/link";
import { use, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDateTime } from "@/lib/format";
import { REQUEST_STATUS } from "@/lib/console";
import { Button, Field, Loading, LoadError, Notice, PageHeader, Panel, Select, StatusBadge, Textarea } from "@/components/ui";

interface Detail {
  request: {
    id: string; facilityName: string; facilityType: string | null; district: string | null; region: string | null; contactName: string; contactRole: string | null;
    contactEmail: string; contactPhone: string | null; staffCountEstimate: number | null; currentMethod: string | null; message: string | null; status: string;
    assignedTo: string | null; source: string; createdAt: string; firstResponseAt: string | null; declineReason: string | null;
  };
  notes: { id: string; author: string; body: string; createdAt: string }[];
  facility: { id: string; name: string } | null;
}

const ROWS: [string, (r: Detail["request"]) => string | null][] = [
  ["Facility type", (r) => r.facilityType?.replace(/_/g, " ").toLowerCase() ?? null],
  ["District and region", (r) => [r.district, r.region].filter(Boolean).join(", ") || null],
  ["Contact", (r) => [r.contactName, r.contactRole].filter(Boolean).join(", ")],
  ["Email", (r) => r.contactEmail],
  ["Telephone", (r) => r.contactPhone],
  ["Staff", (r) => (r.staffCountEstimate ? String(r.staffCountEstimate) : null)],
  ["Roster done now", (r) => r.currentMethod],
  ["Message", (r) => r.message],
  ["Came from", (r) => r.source.replace(/_/g, " ").toLowerCase()],
];

export default function RequestDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, reload } = useResource<Detail>(`/api/platform/requests/${id}`);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [closing, setClosing] = useState<"DECLINED" | "DORMANT" | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading the request" />;
  const r = data.request;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setProblem(null);
    try {
      await fn();
      setClosing(null);
      setReason("");
      reload();
    } catch (err) {
      const b = err instanceof ApiError ? (err.body as { message?: string; fields?: Record<string, string> }) : undefined;
      setProblem(b?.message ?? Object.values(b?.fields ?? {})[0] ?? "That did not work. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  const set = (status: string) => act(() => api.patch(`/api/platform/requests/${id}`, { status }));
  const open = !["PROVISIONED", "DECLINED", "DORMANT"].includes(r.status);

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin/requests" className="text-[var(--accent-text)] underline underline-offset-2">Access requests</Link>
      </p>
      <PageHeader title={r.facilityName} description={`Submitted ${showDateTime(r.createdAt)}. ${r.firstResponseAt ? `First response ${showDateTime(r.firstResponseAt)}.` : "Not answered yet."}`} actions={<StatusBadge tone={r.status === "NEW" ? "warning" : r.status === "PROVISIONED" ? "success" : "neutral"}>{REQUEST_STATUS[r.status]}</StatusBadge>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Panel title="What they sent">
            <dl className="divide-y divide-[var(--border)]">
              {ROWS.map(([k, f]) => (
                <div key={k} className="grid gap-1 py-2 sm:grid-cols-[11rem_1fr]">
                  <dt className="text-[var(--muted)]">{k}</dt>
                  <dd className="min-w-0 break-words">{f(r) ?? <span className="text-[var(--muted)]">Not given</span>}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel title="Notes">
            {data.notes.length === 0 && <p className="mb-3 text-sm text-[var(--muted)]">No notes yet.</p>}
            <ul className="mb-4 space-y-3">
              {data.notes.map((n) => (
                <li key={n.id}>
                  <p className="text-sm text-[var(--muted)]">{n.author} · {showDateTime(n.createdAt)}</p>
                  <p>{n.body}</p>
                </li>
              ))}
            </ul>
            <Field label="Add a note">{(a) => <Textarea {...a} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
            <div className="mt-2">
              <Button variant="secondary" disabled={busy || !note.trim()} onClick={() => act(async () => { await api.post(`/api/platform/requests/${id}/notes`, { body: note }); setNote(""); })}>Add note</Button>
            </div>
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="What to do">
            {data.facility ? (
              <p>
                This became <Link href={`/admin/facilities/${data.facility.id}`} className="text-[var(--accent-text)] underline underline-offset-2">{data.facility.name}</Link>.
              </p>
            ) : open ? (
              <div className="space-y-2">
                {r.status === "NEW" && <Button className="w-full" disabled={busy} onClick={() => set("CONTACTED")}>Record a response</Button>}
                {r.status !== "DEMO_SCHEDULED" && <Button variant="secondary" className="w-full" disabled={busy} onClick={() => set("DEMO_SCHEDULED")}>Demonstration scheduled</Button>}
                {r.status !== "AGREEMENT_SENT" && <Button variant="secondary" className="w-full" disabled={busy} onClick={() => set("AGREEMENT_SENT")}>Agreement sent</Button>}
                <Button className="w-full" disabled={busy} onClick={() => act(async () => { const out = await api.post<{ facilityId: string }>(`/api/platform/requests/${id}/provision`, {}); window.location.href = `/admin/facilities/${out.facilityId}`; })}>Provision facility</Button>
                <p className="text-sm text-[var(--muted)]">Provisioning creates the facility as a trial, with no staff and no administrator. Send the agreement first.</p>
                <div className="flex gap-2 pt-2">
                  <Button variant="quiet" onClick={() => setClosing("DECLINED")}>Decline</Button>
                  <Button variant="quiet" onClick={() => setClosing("DORMANT")}>Mark dormant</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p>{REQUEST_STATUS[r.status]}.{r.declineReason ? ` ${r.declineReason}` : ""}</p>
                {r.status !== "PROVISIONED" && <Button variant="secondary" disabled={busy} onClick={() => set("CONTACTED")}>Reopen</Button>}
              </div>
            )}
            {closing && (
              <div className="mt-3 space-y-2">
                <Field label={closing === "DECLINED" ? "Why decline?" : "Why dormant?"}>{(a) => <Textarea {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
                <div className="flex gap-2">
                  <Button disabled={busy || !reason.trim()} onClick={() => act(() => api.patch(`/api/platform/requests/${id}`, { status: closing, reason }))}>Confirm</Button>
                  <Button variant="quiet" onClick={() => setClosing(null)}>Cancel</Button>
                </div>
              </div>
            )}
            {problem && <div className="mt-3"><Notice tone="block">{problem}</Notice></div>}
          </Panel>
          <Panel title="Assigned to">
            <Select value={r.assignedTo ?? ""} onChange={(e) => act(() => api.patch(`/api/platform/requests/${id}`, { assignedTo: e.target.value || null }))} aria-label="Assigned to">
              <option value="">Nobody</option>
              <option value="Muslim">Muslim</option>
              <option value="Joshua">Joshua</option>
            </Select>
          </Panel>
        </div>
      </div>
    </>
  );
}
