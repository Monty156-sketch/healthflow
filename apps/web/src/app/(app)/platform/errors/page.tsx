"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDateTime } from "@/lib/format";
import { failure, type Say } from "@/lib/adminBits";
import { Button, EmptyState, Loading, LoadError, Notice, PageHeader, StatusBadge, Textarea } from "@/components/ui";

interface R { id: string; createdAt: string; facility: string | null; reportedBy: string | null; screen: string | null; description: string; status: string; resolutionNote: string | null; reply: string | null; repliedAt: string | null }

export default function ErrorsPage() {
  const { data, error, reload } = useResource<{ reports: R[] }>("/api/platform/errors");
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [say, setSay] = useState<Say>(null);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading />;
  async function reply(id: string, resolve: boolean) {
    setSay(null);
    try { await api.post(`/api/platform/errors/${id}/reply`, { message: text, resolve }); setOpen(null); setText(""); reload(); } catch (e) { setSay({ tone: "block", text: failure(e) }); }
  }
  return (
    <>
      <PageHeader title="Error reports" description="What people sent through Report a problem. A reply goes to them as a notice in the app and by email when email is set up." />
      {say && <Notice tone={say.tone}>{say.text}</Notice>}
      {data.reports.length === 0 ? <EmptyState title="No reports" /> : (
        <ul className="divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 text-[15px]">
          {data.reports.map((r) => (
            <li key={r.id} className="py-3">
              <p><StatusBadge tone={r.status === "RESOLVED" ? "success" : r.status === "INVESTIGATING" ? "warning" : "block"}>{r.status.toLowerCase()}</StatusBadge> <span className="figures text-sm text-[var(--muted)]">{showDateTime(r.createdAt)}</span> {r.facility}{r.screen ? `, ${r.screen}` : ""}</p>
              <p className="mt-1">{r.description}</p>
              {r.reportedBy && <p className="text-sm text-[var(--muted)]">From {r.reportedBy}</p>}
              {r.reply && <p className="mt-1 text-[var(--muted)]">Reply: {r.reply}</p>}
              {open === r.id ? (
                <div className="mt-2 max-w-xl space-y-2">
                  <Textarea aria-label="Reply" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
                  <div className="flex gap-2"><Button onClick={() => reply(r.id, false)} disabled={text.trim().length < 5}>Send reply</Button><Button variant="secondary" onClick={() => reply(r.id, true)} disabled={text.trim().length < 5}>Reply and mark resolved</Button><Button variant="secondary" onClick={() => setOpen(null)}>Cancel</Button></div>
                </div>
              ) : r.reportedBy && r.status !== "RESOLVED" ? <div className="mt-2"><Button variant="secondary" onClick={() => setOpen(r.id)}>Reply</Button></div> : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
