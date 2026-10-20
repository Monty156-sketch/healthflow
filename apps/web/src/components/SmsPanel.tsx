"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { Button, Field, Input, Loading, LoadError, Notice, Panel, StatusBadge } from "@/components/ui";

interface View {
  configured: boolean;
  provider: string;
  enabled: boolean;
  sent30: number;
  failed30: number;
  reachable: number;
  withoutNumber: number;
  optedOut: number;
  recent: { id: string; at: string; staff: string | null; type: string; body: string; status: "SENT" | "FAILED" | "SKIPPED"; error: string | null }[];
}

const WHAT: Record<string, string> = {
  test: "Test text", join_decision: "Sign-up answer", roster_published: "Roster published", duty_moved: "Duty moved", reinstated: "Back on the roster", cover_asked: "Asked to cover", cover_arranged: "Cover arranged",
  swap_requested: "Swap asked", swap_decided: "Swap decided", leave_decided: "Leave decided", return_due: "Due back",
};
const TONE = { SENT: "success", FAILED: "block", SKIPPED: "neutral" } as const;

/** Sends one real text, so the gateway is proven before anyone relies on it. */
function TestText({ onSent }: { onSent: () => void }) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  async function send() {
    setBusy(true);
    setResult(null);
    try {
      await api.post("/api/facility/sms/test", { phone });
      setResult({ ok: true, text: "The gateway accepted it. Check that the text arrives on that phone." });
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { message?: string; fields?: { phone?: string } }) : undefined;
      setResult({ ok: false, text: b?.fields?.phone ?? b?.message ?? "The test could not be sent. Try again." });
    } finally {
      setBusy(false);
      onSent();
    }
  }
  return (
    <div className="mt-5 max-w-md border-t border-[var(--border)] pt-4">
      <h3 className="mb-2 text-sm font-medium text-[var(--muted)]">Check that it works</h3>
      <Field label="Send a test text to">{(a) => <Input {...a} type="tel" placeholder="024 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />}</Field>
      <div className="mt-2"><Button variant="secondary" disabled={busy || !phone.trim()} onClick={send}>{busy ? "Sending…" : "Send test text"}</Button></div>
      {result && <div className="mt-2"><Notice tone={result.ok ? "success" : "block"}>{result.text}</Notice></div>}
    </div>
  );
}

/** Whether the facility texts its staff, and what has been sent. */
export function SmsPanel() {
  const { data, error, reload } = useResource<View>("/api/facility/sms");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading text message settings" />;

  async function toggle() {
    setBusy(true);
    setProblem(null);
    try {
      await api.put("/api/facility/sms", { enabled: !data!.enabled });
      reload();
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { message?: string }) : undefined;
      setProblem(b?.message ?? "That could not be changed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Text messages"
      description="Texts for published rosters, duty changes, cover, swaps and leave."
      actions={<StatusBadge tone={data.enabled ? "success" : "neutral"}>{data.enabled ? "On" : "Off"}</StatusBadge>}
    >
      {problem && <div className="mb-3"><Notice tone="block">{problem}</Notice></div>}
      {!data.configured && <div className="mb-3"><Notice>Texts are not set up yet. PS Tech turns them on.</Notice></div>}
      <dl className="mb-4 grid gap-3 text-[15px] sm:grid-cols-4">
        {([["Can be reached", data.reachable], ["No usable number", data.withoutNumber], ["Asked not to be texted", data.optedOut], ["Sent, last 30 days", data.sent30]] as [string, number][]).map(([k, n]) => (
          <div key={k}><dt className="text-sm text-[var(--muted)]">{k}</dt><dd className="figures text-xl font-semibold">{n}</dd></div>
        ))}
      </dl>
      {data.failed30 > 0 && <p className="mb-3 text-[15px]">{data.failed30} could not be sent in the last 30 days. See the list below.</p>}
      <Button variant={data.enabled ? "secondary" : "primary"} disabled={busy || (!data.enabled && !data.configured)} onClick={toggle}>
        {data.enabled ? "Turn text messages off" : "Turn text messages on"}
      </Button>
      <p className="mt-2 text-sm text-[var(--muted)]">Numbers come from staff records.</p>

      {data.configured && <TestText onSent={reload} />}

      {data.recent.length > 0 && (
        <div className="mt-5" role="region" aria-label="Recent text messages" tabIndex={0}>
          <h3 className="mb-2 text-sm font-medium text-[var(--muted)]">Recent texts (kept 90 days)</h3>
          <ul className="divide-y divide-[var(--border)] text-[15px]">
            {data.recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <span>
                  <strong>{r.staff ?? "Staff member"}</strong>, {WHAT[r.type] ?? r.type}
                  <span className="block text-sm text-[var(--muted)]">{r.error ?? r.body}</span>
                </span>
                <span className="flex items-center gap-2 text-sm text-[var(--muted)]">
                  {new Date(r.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  <StatusBadge tone={TONE[r.status]}>{r.status === "SENT" ? "Sent" : r.status === "FAILED" ? "Failed" : "Skipped"}</StatusBadge>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
