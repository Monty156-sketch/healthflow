"use client";

import { useResource } from "@/lib/useApi";
import { showDateTime } from "@/lib/format";
import { EmptyState, Loading, LoadError, PageHeader, StatusBadge } from "@/components/ui";

interface R { id: string; createdAt: string; screen: string | null; description: string; status: "NEW" | "INVESTIGATING" | "RESOLVED"; reply: string | null; repliedAt: string | null }

const WORD = { NEW: "Received", INVESTIGATING: "Being looked at", RESOLVED: "Resolved" } as const;

export default function MyReports() {
  const { data, error, reload } = useResource<{ reports: R[] }>("/api/errors/mine");
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <>
      <PageHeader title="Reports I sent" description="Problems you reported with Report a problem, and what PS Tech answered." />
      {data.reports.length === 0 ? (
        <EmptyState title="You have not reported anything">If something goes wrong, use Report a problem at the bottom of the menu.</EmptyState>
      ) : (
        <ul className="divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 text-[15px]">
          {data.reports.map((r) => (
            <li key={r.id} className="py-3">
              <p><StatusBadge tone={r.status === "RESOLVED" ? "success" : r.status === "INVESTIGATING" ? "warning" : "neutral"}>{WORD[r.status]}</StatusBadge> <span className="figures text-sm text-[var(--muted)]">{showDateTime(r.createdAt)}</span>{r.screen ? <span className="text-sm text-[var(--muted)]">, {r.screen}</span> : null}</p>
              <p className="mt-1">{r.description}</p>
              {r.reply ? (
                <div className="mt-2 rounded-[var(--radius)] border border-[var(--border)] border-l-[3px] border-l-[var(--accent)] px-3 py-2">
                  <p className="text-sm text-[var(--muted)]">PS Tech replied{r.repliedAt ? `, ${showDateTime(r.repliedAt)}` : ""}</p>
                  <p>{r.reply}</p>
                </div>
              ) : <p className="mt-1 text-sm text-[var(--muted)]">No reply yet.</p>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
