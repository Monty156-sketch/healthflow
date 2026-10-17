"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import type { CoverOptions } from "@/lib/types";
import { Button, Checkbox, Loading, LoadError, Notice, Panel } from "@/components/ui";

/**
 * Who could lawfully take an absent person's duty, best first, with the reason
 * for each. Nothing moves until someone is chosen, and the person chosen is
 * asked to confirm: a duty nobody has confirmed is not covered.
 */
export function CoverPanel({ assignmentId, personName, onDone, onClose }: { assignmentId: string; personName: string; onDone: () => void; onClose: () => void }) {
  const { data, error, reload } = useResource<CoverOptions>(`/api/facility/cover/options?assignmentId=${assignmentId}`);
  const [owedBack, setOwedBack] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function assign(proposalId: string) {
    setBusy(proposalId);
    setProblem(null);
    try {
      await api.post("/api/facility/cover/assign", { assignmentId, proposalId, owedBack });
      onDone();
    } catch (err) {
      const b = err instanceof ApiError ? (err.body as { message?: string }) : undefined;
      setProblem(b?.message ?? "That did not work. Check your connection and try again.");
      reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel
      title={`Cover for ${personName}`}
      description={data ? `${data.duty.shift} on ${showDate(data.duty.date)}` : undefined}
      actions={
        <Button variant="quiet" onClick={onClose}>
          Close
        </Button>
      }
    >
      {error && !data ? (
        <ErrorOrReason error={error} reload={reload} />
      ) : !data ? (
        <Loading label="Checking who could take this duty" />
      ) : (
        <div className="space-y-4">
          <p className="text-[15px]">{data.summary}</p>
          {data.options.length > 0 && (
            <div className="space-y-2">
              <Checkbox label="This duty is to be worked back" checked={owedBack} onChange={setOwedBack} />
              <p className="text-sm text-[var(--muted)]">
                Tick this for time off that is made up later, such as permission. Leave it off for sickness and bereavement: asking people to work back time lost to illness
                discourages them from reporting it. If ticked, {personName} owes one duty and the person covering is owed one, once they confirm.
              </p>
            </div>
          )}
          <ol className="divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)]">
            {data.options.map((o) => (
              <li key={o.proposalId} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium">
                    {o.rank}. {o.name}
                    {o.cadre && <span className="font-normal text-[var(--muted)]">, {o.cadre}</span>}
                  </p>
                  <p className="text-sm text-[var(--muted)]">{o.reasons.join("; ")}.</p>
                  {o.warnings.map((w) => (
                    <p key={w} className="text-sm text-[var(--status-warning)]">
                      {w}
                    </p>
                  ))}
                </div>
                <Button disabled={busy !== null} onClick={() => assign(o.proposalId)} aria-label={`Ask ${o.name} to cover`}>
                  {busy === o.proposalId ? "Asking…" : "Ask to cover"}
                </Button>
              </li>
            ))}
          </ol>
          {data.ruledOut.length > 0 && (
            <details className="text-[15px]">
              <summary className="cursor-pointer font-medium">Why others cannot ({data.ruledOut.length})</summary>
              <ul className="mt-2 space-y-1 text-[var(--muted)]">
                {data.ruledOut.map((r) => (
                  <li key={r.name}>
                    {r.name}: {r.why}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {problem && <Notice tone="block">{problem}</Notice>}
        </div>
      )}
    </Panel>
  );
}

function ErrorOrReason({ error, reload }: { error: unknown; reload: () => void }) {
  const b = error instanceof ApiError && error.status === 409 ? (error.body as { message?: string }) : undefined;
  if (b?.message) return <Notice tone="warning">{b.message}</Notice>;
  return <LoadError onRetry={reload} />;
}
