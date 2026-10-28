"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import { Button, Field, Input, Loading, LoadError, Notice, Panel, StatusBadge } from "@/components/ui";

interface View {
  configured: boolean; enabled: boolean; optedIn: number; withoutNumber: number; sent30: number; failed30: number;
  recent: { id: string; at: string; staff: string | null; dutyDate: string; status: "SENT" | "FAILED" | "SKIPPED"; attempts: number; error: string | null }[];
}
const TONE = { SENT: "success", FAILED: "block", SKIPPED: "neutral" } as const;

function TestMessage({ onSent }: { onSent: () => void }) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  async function send() {
    setBusy(true); setResult(null);
    try {
      await api.post("/api/facility/whatsapp/test", { phone });
      setResult({ ok: true, text: "WhatsApp accepted it. Check that the message arrives on that phone." });
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { message?: string; fields?: { phone?: string } }) : undefined;
      setResult({ ok: false, text: b?.fields?.phone ?? b?.message ?? "The test could not be sent. Try again." });
    } finally { setBusy(false); onSent(); }
  }
  return (
    <div className="mt-5 max-w-md border-t border-[var(--border)] pt-4">
      <h3 className="mb-2 text-sm font-medium text-[var(--muted)]">Check that it works</h3>
      <Field label="Send a test message to">{(a) => <Input {...a} type="tel" placeholder="024 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />}</Field>
      <div className="mt-2"><Button variant="secondary" disabled={busy || !phone.trim()} onClick={send}>{busy ? "Sending…" : "Send test message"}</Button></div>
      {result && <div className="mt-2"><Notice tone={result.ok ? "success" : "block"}>{result.text}</Notice></div>}
    </div>
  );
}

interface Person { id: string; name: string; staffNo: string; optIn: boolean }

/** People with a number but no login: the administrator records that they agreed. */
function NoLogin() {
  const { data, error, reload } = useResource<{ people: Person[] }>("/api/facility/whatsapp/people");
  const [busy, setBusy] = useState<string | null>(null);
  if (error || !data || data.people.length === 0) return null;
  async function set(p: Person, optIn: boolean) {
    setBusy(p.id);
    try { await api.put(`/api/facility/whatsapp/people/${p.id}`, { optIn }); reload(); } finally { setBusy(null); }
  }
  return (
    <div className="mt-5 border-t border-[var(--border)] pt-4">
      <h3 className="mb-1 text-sm font-medium text-[var(--muted)]">People without a login</h3>
      <p className="mb-2 text-sm text-[var(--muted)]">They cannot choose for themselves. Tick a person only after they have told you they want their duty reminders on WhatsApp. Your name is recorded against it.</p>
      <ul className="divide-y divide-[var(--border)] text-[15px]">
        {data.people.map((p) => (
          <li key={p.id} className="flex min-h-11 items-center justify-between gap-3 py-1">
            <span>{p.name} <span className="text-sm text-[var(--muted)]">{p.staffNo}</span></span>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={p.optIn} disabled={busy === p.id} onChange={(e) => set(p, e.target.checked)} />Agreed</label>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Whether the facility sends WhatsApp duty reminders, how many people chose them, and what went out. */
export function WhatsAppSettings() {
  const { data, error, reload } = useResource<View>("/api/facility/whatsapp");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading WhatsApp settings" />;

  async function toggle() {
    setBusy(true); setProblem(null);
    try {
      await api.put("/api/facility/whatsapp", { enabled: !data!.enabled });
      reload();
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { message?: string }) : undefined;
      setProblem(b?.message ?? "That could not be changed. Try again.");
    } finally { setBusy(false); }
  }

  return (
    <Panel title="WhatsApp duty reminders" description="Each morning, a message to every person on duty that day who chose to receive it, naming their shift." actions={<StatusBadge tone={data.enabled ? "success" : "neutral"}>{data.enabled ? "On" : "Off"}</StatusBadge>}>
      {problem && <div className="mb-3"><Notice tone="block">{problem}</Notice></div>}
      {!data.configured && <div className="mb-3"><Notice>WhatsApp is not set up yet. PS Tech turns it on once the business number and message template are approved.</Notice></div>}
      <dl className="mb-4 grid gap-3 text-[15px] sm:grid-cols-4">
        {([["Chose WhatsApp", data.optedIn], ["No usable number", data.withoutNumber], ["Sent, last 30 days", data.sent30], ["Failed, last 30 days", data.failed30]] as [string, number][]).map(([k, n]) => (
          <div key={k}><dt className="text-sm text-[var(--muted)]">{k}</dt><dd className="figures text-xl font-semibold">{n}</dd></div>
        ))}
      </dl>
      <Button variant={data.enabled ? "secondary" : "primary"} disabled={busy || (!data.enabled && !data.configured)} onClick={toggle}>
        {data.enabled ? "Turn WhatsApp reminders off" : "Turn WhatsApp reminders on"}
      </Button>
      <p className="mt-2 text-sm text-[var(--muted)]">Staff choose this for themselves under their account. You cannot switch it on for them. Numbers come from staff records.</p>
      {data.configured && <TestMessage onSent={reload} />}
      <NoLogin />
      {data.recent.length > 0 && (
        <div className="mt-5" role="region" aria-label="Recent WhatsApp messages" tabIndex={0}>
          <h3 className="mb-2 text-sm font-medium text-[var(--muted)]">Recent messages (kept 90 days)</h3>
          <ul className="divide-y divide-[var(--border)] text-[15px]">
            {data.recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <span><strong>{r.staff ?? "Staff member"}</strong>, duty on {showDate(r.dutyDate)}{r.error && <span className="block text-sm text-[var(--muted)]">{r.error}</span>}</span>
                <StatusBadge tone={TONE[r.status]}>{r.status === "SENT" ? "Sent" : r.status === "FAILED" ? `Failed, try ${r.attempts}` : "Skipped"}</StatusBadge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
