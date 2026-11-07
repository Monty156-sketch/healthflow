"use client";

// Rosters waiting on the person looking, and the facility-wide switch for the approval chain.
import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { Button, EmptyState, Loading, LoadError, Notice, Panel } from "@/components/ui";

export interface Approvals {
  enabled: boolean;
  nursingManager: string[];
  medicalSuperintendent: string[];
  waitingForYou: Row[];
  inProgress: Row[];
}
interface Row { id: string; label: string; ward: string | null; status: string; returnNote: string | null; returnedBy: string | null }

const STEP: Record<string, string> = {
  UNDER_REVIEW: "With the nursing manager",
  WITH_ADMINISTRATOR: "With the administrator",
  WITH_SUPERINTENDENT: "With the medical superintendent",
};

function List({ rows, empty }: { rows: Row[]; empty: string }) {
  if (rows.length === 0) return <EmptyState title={empty} />;
  return (
    <ul className="divide-y divide-[var(--border)]">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <div>
            <Link href={`/roster/${r.id}`} className="font-medium underline">{r.ward ? `${r.label}, ${r.ward}` : r.label}</Link>
            <p className="text-sm text-[var(--muted)]">{STEP[r.status] ?? r.status}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ApprovalQueue({ canSwitch, compact = false }: { canSwitch: boolean; compact?: boolean }) {
  const q = useResource<Approvals>("/api/facility/approvals");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (q.error && !q.data) return <LoadError onRetry={q.reload} />;
  if (!q.data) return <Loading label="Loading" />;
  const d = q.data;

  async function flip(enabled: boolean) {
    setBusy(true);
    setProblem(null);
    try {
      await api.put("/api/facility/approvals", { enabled });
      q.reload();
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { message?: string } | undefined) : undefined;
      setProblem(b?.message ?? "That did not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {problem && <Notice tone="block">{problem}</Notice>}
      {canSwitch && !compact && (
        <Panel title="Approval chain">
          <p className="text-sm">
            {d.enabled
              ? "On. Each roster goes from the ward in-charge to the nursing manager, then the administrator, then the medical superintendent, who publishes it."
              : "Off. The administrator approves and publishes rosters, as before."}
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Nursing manager: {d.nursingManager.join(", ") || "not invited yet"}. Medical superintendent: {d.medicalSuperintendent.join(", ") || "not invited yet"}.
          </p>
          <div className="mt-3">
            <Button onClick={() => flip(!d.enabled)} disabled={busy}>{d.enabled ? "Switch off" : "Switch on"}</Button>
          </div>
        </Panel>
      )}
      {d.enabled && (
        <Panel title="Waiting for you">
          <List rows={d.waitingForYou} empty="Nothing is waiting for you." />
        </Panel>
      )}
      {d.enabled && !compact && (
        <Panel title="Elsewhere in the chain">
          <List rows={d.inProgress} empty="No other roster is moving through approval." />
        </Panel>
      )}
    </div>
  );
}
