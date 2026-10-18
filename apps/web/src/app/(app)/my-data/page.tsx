"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import { Button, Field, Loading, LoadError, Notice, PageHeader, Panel, Select, StatusBadge, Textarea } from "@/components/ui";

interface Data {
  linked: boolean;
  sections: { title: string; lines: string[] }[];
  consents: { id: string | null; type: string; active: boolean; grantedAt: string | null; withdrawnAt: string | null }[];
  privacyNotice: { version: string; publishedAt: string; accepted: string | null; body: string } | null;
  requests: { id: string; requestType: string; status: string; receivedAt: string; dueAt: string | null; completedAt: string | null; description: string | null; outcomeNote: string | null }[];
}

const CONSENT_WORD: Record<string, string> = { PHOTOGRAPH: "A photograph on your record", CASE_STUDY: "Being named in a case study", REFERENCE: "Being named as a reference", MARKETING: "Use in marketing material" };
const TYPE_WORD: Record<string, string> = { CORRECTION: "Correction", OBJECTION: "Objection", ERASURE: "Erasure", ACCESS: "Access", PORTABILITY: "Portability" };
const STATUS_WORD: Record<string, string> = { RECEIVED: "Received", IN_PROGRESS: "In progress", COMPLETED: "Answered", REFUSED: "Not granted" };

export default function MyData() {
  const { data, error, reload } = useResource<Data>("/api/facility/me/data");
  const [type, setType] = useState("CORRECTION");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "block"; text: string } | null>(null);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading what is held about you" />;
  if (!data.linked) return <Notice>Your login is not linked to a staff record yet.</Notice>;

  async function download(kind: "json" | "csv") {
    try {
      await api.download(`/api/facility/me/data/export.${kind}`, `my-healthflow-data.${kind}`);
    } catch {
      setMsg({ tone: "block", text: "The file could not be made. Check your connection and try again." });
    }
  }
  async function ask() {
    setMsg(null);
    try {
      await api.post("/api/facility/me/requests", { requestType: type, description: text });
      setText("");
      setMsg({ tone: "success", text: "Your request was sent. The facility must answer it within the time shown below." });
      reload();
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { fields?: Record<string, string> }) : undefined;
      setMsg({ tone: "block", text: b?.fields ? Object.values(b.fields)[0] : "It was not sent. Try again." });
    }
  }
  async function withdraw(id: string) {
    try {
      await api.post(`/api/facility/me/consents/${id}/withdraw`, {});
      reload();
    } catch {
      setMsg({ tone: "block", text: "It was not withdrawn. Try again." });
    }
  }

  return (
    <>
      <PageHeader title="My data" description="What your facility holds about you in HealthFlow, in plain words. You can take a copy at any time." />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="space-y-6">
        <Panel title="What we hold about you">
          <div className="space-y-4">
            {data.sections.map((s) => (
              <div key={s.title}>
                <h3 className="font-medium">{s.title}</h3>
                <ul className="text-[15px] text-[var(--muted)]">{s.lines.map((l) => <li key={l}>{l}</li>)}</ul>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Download everything">
          <p className="mb-3 text-[15px]">Your details, duties, leave and decisions, attendance and corrections, swaps, consents and the changes made to your record. It is ready at once and you do not need to ask anyone.</p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => download("csv")}>Download as a spreadsheet (CSV)</Button>
            <Button variant="secondary" onClick={() => download("json")}>Download as JSON</Button>
          </div>
        </Panel>
        <Panel title="Your consents">
          <p className="mb-3 text-sm text-[var(--muted)]">Withdrawing a consent never affects how you use the system.</p>
          <ul className="divide-y divide-[var(--border)]">
            {data.consents.map((c) => (
              <li key={c.type} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>
                  {CONSENT_WORD[c.type]}
                  <span className="block text-sm text-[var(--muted)]">{c.active ? `Given ${showDate(c.grantedAt)}` : c.withdrawnAt ? `Withdrawn ${showDate(c.withdrawnAt)}` : "Not given"}</span>
                </span>
                {c.active && c.id && <Button variant="secondary" onClick={() => withdraw(c.id!)}>Withdraw</Button>}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Ask for a change">
          <p className="mb-3 text-sm text-[var(--muted)]">A correction or objection is answered within 14 days. An erasure request within 30. Some records must be kept for a period; if so you will be told which, and why.</p>
          <div className="max-w-xl space-y-3">
            <Field label="What you are asking for">
              {(a) => (
                <Select {...a} value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="CORRECTION">Correct something that is wrong</option>
                  <option value="OBJECTION">Object to how my information is used</option>
                  <option value="ERASURE">Delete my information</option>
                </Select>
              )}
            </Field>
            <Field label="Tell us what you want">{(a) => <Textarea {...a} rows={3} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
            <Button onClick={ask} disabled={text.trim().length < 10}>Send request</Button>
          </div>
          {data.requests.length > 0 && (
            <ul className="mt-5 divide-y divide-[var(--border)] text-[15px]">
              {data.requests.map((r) => (
                <li key={r.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{TYPE_WORD[r.requestType]}</strong>
                    <StatusBadge tone={r.status === "COMPLETED" ? "success" : r.status === "REFUSED" ? "warning" : "neutral"}>{STATUS_WORD[r.status]}</StatusBadge>
                    <span className="text-sm text-[var(--muted)]">Sent {showDate(r.receivedAt)}{r.status === "RECEIVED" || r.status === "IN_PROGRESS" ? `, answer due ${showDate(r.dueAt)}` : ""}</span>
                  </div>
                  {r.outcomeNote && <p className="mt-1">{r.outcomeNote}</p>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {data.privacyNotice && (
          <Panel title="Privacy notice">
            <p className="text-[15px]">Current version {data.privacyNotice.version}, published {showDate(data.privacyNotice.publishedAt)}. {data.privacyNotice.accepted ? `You accepted version ${data.privacyNotice.accepted}.` : "You have not accepted it yet."}</p>
            <details className="mt-3">
              <summary className="min-h-11 cursor-pointer py-2 font-medium">Read the notice</summary>
              <p className="mt-2 text-[15px] whitespace-pre-line">{data.privacyNotice.body}</p>
            </details>
          </Panel>
        )}
      </div>
    </>
  );
}
