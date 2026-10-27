"use client";

import { useState } from "react";
import { useFacility } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import { Button, EmptyState, Loading, LoadError, Notice, PageHeader, Panel } from "@/components/ui";

interface Move { id: string; status: "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED"; note: string | null; createdAt: string; decidedAt: string | null; fullName: string; staffNo: string; position: string | null; cadre: string | null; from: string; to: string }
const WORD = { PENDING: "Waiting for an answer", ACCEPTED: "Accepted", DECLINED: "Declined", CANCELLED: "Withdrawn" } as const;

export default function TransfersPage() {
  const { isAdmin } = useFacility();
  const list = useResource<{ incoming: Move[]; outgoing: Move[] }>(isAdmin ? "/api/facility/staff-moves" : null);
  const { reload: reloadFacility } = useFacility();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (!isAdmin) return <Notice tone="neutral">Only the facility administrator handles transfers between facilities.</Notice>;
  if (list.error && !list.data) return <LoadError onRetry={list.reload} />;
  if (!list.data) return <Loading label="Loading transfers" />;

  async function act(id: string, what: "accept" | "decline" | "cancel") {
    setBusy(id);
    setProblem(null);
    setDone(null);
    try {
      const r = await api.post<{ message?: string }>(`/api/facility/staff-moves/${id}/${what}`);
      if (r.message) setDone(r.message);
      list.reload();
      reloadFacility();
    } catch (e) {
      setProblem(e instanceof ApiError ? ((e.body as { message?: string } | undefined)?.message ?? "That did not go through.") : "That did not go through. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const { incoming, outgoing } = list.data;
  return (
    <>
      <PageHeader title="Transfers between facilities" description="Staff posted to or from a facility that is also on HealthFlow. When you accept, their details and sign in move to you, so nobody registers twice." />
      {done && <Notice tone="success">{done}</Notice>}
      {problem && <Notice tone="block">{problem}</Notice>}
      <div className="mt-4 space-y-6">
        <Panel title="Posted to us">
          {incoming.length === 0 ? (
            <EmptyState title="Nobody is being posted to you">When another facility asks you to take someone, it appears here for you to accept or decline.</EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {incoming.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium">{m.fullName}</p>
                    <p className="text-sm text-[var(--muted)]">{[m.cadre, m.position].filter(Boolean).join(", ") || "No cadre recorded"}. From {m.from}, asked {showDate(m.createdAt)}.{m.note ? ` Note: ${m.note}` : ""}</p>
                    {m.status !== "PENDING" && <p className="text-sm">{WORD[m.status]}</p>}
                  </div>
                  {m.status === "PENDING" && (
                    <div className="flex gap-2">
                      <Button disabled={busy === m.id} onClick={() => void act(m.id, "accept")}>Accept</Button>
                      <Button variant="secondary" disabled={busy === m.id} onClick={() => void act(m.id, "decline")}>Decline</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Posted from us">
          {outgoing.length === 0 ? (
            <EmptyState title="You have not posted anyone">Open a staff member and choose Transfer to another facility.</EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {outgoing.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium">{m.fullName}</p>
                    <p className="text-sm text-[var(--muted)]">To {m.to}, asked {showDate(m.createdAt)}. {WORD[m.status]}.</p>
                  </div>
                  {m.status === "PENDING" && <Button variant="secondary" disabled={busy === m.id} onClick={() => void act(m.id, "cancel")}>Withdraw</Button>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
