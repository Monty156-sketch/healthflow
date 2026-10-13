"use client";

import Link from "next/link";
import { api } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDateTime } from "@/lib/format";
import type { NotificationRow } from "@/lib/types";
import { Button, EmptyState, Loading, LoadError, PageHeader } from "@/components/ui";

export default function NotificationsPage() {
  const { data, error, reload } = useResource<{ unread: number; notifications: NotificationRow[] }>("/api/facility/notifications");

  async function readAll() {
    await api.post("/api/facility/notifications/read-all");
    reload();
  }
  async function read(id: string) {
    await api.post(`/api/facility/notifications/${id}/read`).catch(() => undefined);
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Things that need you, or that were decided about you."
        actions={data && data.unread > 0 ? <Button variant="secondary" onClick={readAll}>Mark all as read</Button> : undefined}
      />
      {error && !data ? (
        <LoadError onRetry={reload} />
      ) : !data ? (
        <Loading label="Loading notifications" />
      ) : data.notifications.length === 0 ? (
        <EmptyState title="Nothing here yet">Leave decisions, attendance checks and similar messages will appear here.</EmptyState>
      ) : (
        <ul className="divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
          {data.notifications.map((n) => (
            <li key={n.id} className="px-4 py-3" style={n.read ? undefined : { boxShadow: "inset 3px 0 0 var(--accent)" }}>
              <p className="text-[15px] font-medium">
                {n.title}
                {!n.read && <span className="sr-only"> (unread)</span>}
              </p>
              <p className="mt-0.5 text-[15px] text-[var(--muted)]">{n.body}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-4 text-sm text-[var(--muted)]">
                <span>{showDateTime(n.createdAt)}</span>
                {n.linkUrl && (
                  <Link href={n.linkUrl} onClick={() => read(n.id)} className="inline-flex min-h-11 items-center font-medium text-[var(--accent-text)] underline-offset-4 hover:underline">
                    Open
                  </Link>
                )}
                {!n.read && (
                  <button type="button" onClick={() => read(n.id).then(reload)} className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
                    Mark as read
                  </button>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
