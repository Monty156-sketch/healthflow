"use client";

import { useState } from "react";
import { useResource } from "@/lib/useApi";
import { api } from "@/lib/api";
import { showDateTime } from "@/lib/format";
import { Button, EmptyState, Loading, LoadError, PageHeader, TD, TH, TableScroll } from "@/components/ui";

interface Entry { id: string; actorEmail: string | null; action: string; entityType: string; summary: string; createdAt: string }
interface Page { entries: Entry[]; next: string | null }

export default function ActivityPage() {
  const { data, error, reload } = useResource<Page>("/api/platform/activity");
  const [more, setMore] = useState<Entry[]>([]);
  const [next, setNext] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading activity" />;
  const cursor = next === undefined ? data.next : next;
  const entries = [...data.entries, ...more];
  async function older() {
    if (!cursor) return;
    setBusy(true);
    try {
      const r = await api.get<Page>(`/api/platform/activity?before=${encodeURIComponent(cursor)}`);
      setMore((m) => [...m, ...r.entries]);
      setNext(r.next);
    } finally { setBusy(false); }
  }
  return (
    <>
      <PageHeader title="Activity" description="What PS Tech staff have done in the console: setting up facilities, approving districts, changing plans and opening support sessions." />
      {entries.length === 0 ? (
        <EmptyState title="Nothing recorded yet" />
      ) : (
        <>
          <TableScroll label="Platform activity">
            <table className="w-full min-w-[44rem] border-collapse text-[15px]">
              <thead>
                <tr>
                  <th scope="col" className={TH}>When</th>
                  <th scope="col" className={TH}>Who</th>
                  <th scope="col" className={TH}>What</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className={`${TD} whitespace-nowrap`}>{showDateTime(e.createdAt)}</td>
                    <td className={TD}>{e.actorEmail ?? "System"}</td>
                    <td className={TD}>{e.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          {cursor && <div className="mt-4"><Button variant="secondary" onClick={older} disabled={busy}>{busy ? "Loading" : "Show older"}</Button></div>}
        </>
      )}
    </>
  );
}
