"use client";

import { useResource } from "@/lib/useApi";
import { showDate, showDateTime } from "@/lib/format";
import type { CoverWaiting } from "@/lib/types";
import { EmptyState, Loading, LoadError, PageHeader, StatusBadge, TableScroll } from "@/components/ui";

export default function CoverPage() {
  const { data, error, reload } = useResource<{ cover: CoverWaiting[] }>("/api/facility/cover/awaiting");
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading cover" />;
  return (
    <>
      <PageHeader title="Cover" description="Duties covered for an absent colleague." />
      {data.cover.length === 0 ? (
        <EmptyState title="Nothing is waiting for an answer">Ask for cover from Daily attendance.</EmptyState>
      ) : (
        <TableScroll label="Cover waiting for an answer, scrolls sideways on small screens">
          <table className="w-full min-w-[38rem] border-collapse text-left text-[15px]">
            <caption className="sr-only">Cover waiting for an answer</caption>
            <thead>
              <tr className="text-sm text-[var(--muted)]">
                {["Duty", "Asked to cover", "For", "Asked at", "Status"].map((h) => (
                  <th key={h} scope="col" className="border-b border-[var(--border-strong)] px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.cover.map((c) => (
                <tr key={c.assignmentId}>
                  <th scope="row" className="figures border-b border-[var(--border)] px-3 py-2 font-medium">{showDate(c.date)}, {c.shift}</th>
                  <td className="border-b border-[var(--border)] px-3 py-2">{c.coverName}</td>
                  <td className="border-b border-[var(--border)] px-3 py-2">{c.forName ?? ""}</td>
                  <td className="figures border-b border-[var(--border)] px-3 py-2">{showDateTime(c.notifiedAt)}</td>
                  <td className="border-b border-[var(--border)] px-3 py-2">
                    <StatusBadge tone={c.state === "ESCALATED" ? "block" : "warning"}>{c.state === "ESCALATED" ? "Not confirmed in time" : "Waiting"}</StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </>
  );
}
