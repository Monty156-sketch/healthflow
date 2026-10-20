"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import { Button } from "@/components/ui";

interface Notices {
  support: { startedAt: string; reason: string; accessLevel: string; expiresAt: string } | null;
  announcements: { id: string; title: string; body: string; severity: "INFO" | "IMPORTANT" | "MAINTENANCE"; dismissible: boolean }[];
  legalPending: { slug: string; title: string; version: string; summary: string | null; effectiveDate: string | null }[];
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** What PS Tech puts in front of a facility's own users. A support session is a banner, never a small icon. */
export function PlatformNotices() {
  const { data, reload } = useResource<Notices>("/api/facility/notices");
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  async function acknowledge(slug: string, version: string) {
    setBusy(true);
    try { await api.post("/api/facility/notices/legal/acknowledge", { slug, version }); reload(); } finally { setBusy(false); }
  }
  async function dismiss(id: string) {
    await api.post(`/api/facility/notices/announcements/${id}/seen`, {}).catch(() => undefined);
    reload();
  }
  return (
    <div className="no-print">
      {data.support && (
        <div role="alert" className="border-b-2 border-[var(--status-warning)] bg-[var(--status-warning-soft)] px-4 py-3 text-[15px] font-medium">
          PS Tech support is currently viewing this facility. Started {time(data.support.startedAt)}, reason: {data.support.reason}
          <span className="font-normal"> ({data.support.accessLevel === "FULL" ? "full access" : "read only"}, ends {time(data.support.expiresAt)})</span>
        </div>
      )}
      {data.announcements.map((a) => (
        <div key={a.id} role="status" className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2 text-[15px] ${a.severity === "IMPORTANT" ? "border-[var(--status-block)] bg-[var(--status-block-soft)]" : "border-[var(--border)] bg-[var(--surface)]"}`}>
          <span><strong>{a.title}.</strong> {a.body}</span>
          {a.dismissible && <Button variant="secondary" onClick={() => dismiss(a.id)}>Dismiss</Button>}
        </div>
      ))}
      {data.legalPending.length > 0 && (
        <div role="dialog" aria-modal="true" aria-labelledby="legal-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 id="legal-title" className="text-lg font-semibold">A document you agreed to has changed</h2>
            <p className="mt-1 text-[15px] text-[var(--muted)]">Read and acknowledge this change. Your name is recorded.</p>
            <ul className="mt-4 space-y-4">
              {data.legalPending.map((d) => (
                <li key={d.slug} className="border-t border-[var(--border)] pt-3 text-[15px]">
                  <p className="font-medium">{d.title}, version {d.version}</p>
                  {d.effectiveDate && <p className="text-sm text-[var(--muted)]">Effective {showDate(d.effectiveDate)}</p>}
                  {d.summary && <p className="mt-1">{d.summary}</p>}
                  <p className="mt-1"><Link href={`/${d.slug}`} target="_blank" className="text-[var(--accent-text)] underline underline-offset-2">Read the document</Link></p>
                  <div className="mt-2"><Button disabled={busy} onClick={() => acknowledge(d.slug, d.version)}>I have read it and I acknowledge it</Button></div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
