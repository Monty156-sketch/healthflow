"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import { Button, Loading, Notice } from "@/components/ui";

interface Swap {
  targetStaffId: string;
  targetAssignmentId: string;
  name: string;
  date: string;
  shift: string;
  reasons: string[];
  warnings: string[];
}
interface Cover {
  proposalId: string;
  name: string;
  reasons: string[];
  warnings: string[];
}
interface Duty {
  assignmentId: string;
  date: string;
  shift: string;
  swaps: Swap[];
  cover: Cover[];
  coverSummary: string | null;
  ledger: string;
  openSwap: boolean;
}
interface Plan {
  staff: { name: string };
  owedBack: boolean;
  duties: Duty[];
  more: number;
  note: string;
}

/**
 * Published duties this leave takes someone off. A swap comes first because it
 * leaves no debt on anyone; cover is the fallback. Nothing moves until the
 * in-charge chooses, and the colleague has to agree either way.
 */
export function LeaveCoverPlan({ requestId, onChanged }: { requestId: string; onChanged: () => void }) {
  const { data, error, reload } = useResource<Plan>(`/api/facility/leave/requests/${requestId}/cover-plan`);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  if (error && !data) return null; // a plan is a help, not a gate
  if (!data) return <Loading label="Looking at the duties this affects" />;
  if (data.duties.length === 0) return null;

  async function run(key: string, call: () => Promise<unknown>, done: string) {
    setBusy(key);
    setProblem(null);
    setSaid(null);
    try {
      await call();
      setSaid(done);
      onChanged();
      reload();
    } catch (err) {
      const b = err instanceof ApiError ? (err.body as { message?: string }) : undefined;
      setProblem(b?.message ?? "That did not work. Check your connection and try again.");
      reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
      <h3 className="text-[15px] font-semibold">Duties this leave affects</h3>
      <p className="text-[15px]">{data.note}</p>
      <ul className="space-y-3">
        {data.duties.map((d) => (
          <li key={d.assignmentId} className="rounded-md border border-[var(--border)] p-3">
            <p className="font-medium">
              {d.shift}, {showDate(d.date)}
            </p>
            {d.openSwap && <p className="mt-1 text-sm text-[var(--muted)]">A swap is already waiting on this duty.</p>}
            {d.swaps.length > 0 && (
              <div className="mt-2">
                <p className="text-sm font-medium">Swap first</p>
                <ul className="mt-1 space-y-2">
                  {d.swaps.map((s) => (
                    <li key={s.targetAssignmentId} className="flex flex-wrap items-start justify-between gap-2">
                      <span className="min-w-0 text-sm">
                        {data.staff.name} works {s.shift} on {showDate(s.date)}; {s.name} takes this duty. <span className="text-[var(--muted)]">{s.reasons.join(", ")}.</span>
                        {s.warnings.map((w) => (
                          <span key={w} className="block text-[var(--status-warning)]">
                            {w}
                          </span>
                        ))}
                      </span>
                      <Button
                        variant="secondary"
                        disabled={busy !== null}
                        onClick={() => run(s.targetAssignmentId, () => api.post(`/api/facility/leave/requests/${requestId}/swap-request`, { assignmentId: d.assignmentId, targetAssignmentId: s.targetAssignmentId }), `${s.name} has been asked to swap.`)}
                      >
                        Ask {s.name.split(" ")[0]}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!d.openSwap && d.swaps.length === 0 && <p className="mt-2 text-sm text-[var(--muted)]">No lawful swap was found within two weeks of the return.</p>}
            {d.cover.length > 0 && (
              <div className="mt-3">
                <p className="text-sm font-medium">Otherwise, cover</p>
                <ul className="mt-1 space-y-2">
                  {d.cover.map((c) => (
                    <li key={c.proposalId} className="flex flex-wrap items-start justify-between gap-2">
                      <span className="min-w-0 text-sm">
                        {c.name}. <span className="text-[var(--muted)]">{c.reasons.join(", ")}.</span>
                      </span>
                      <Button
                        variant="secondary"
                        disabled={busy !== null}
                        onClick={() => run(c.proposalId, () => api.post("/api/facility/cover/assign", { assignmentId: d.assignmentId, proposalId: c.proposalId, owedBack: data.owedBack }), `${c.name} has been asked to cover.`)}
                      >
                        Ask {c.name.split(" ")[0]}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {d.cover.length === 0 && d.coverSummary && !d.openSwap && <p className="mt-2 text-sm text-[var(--muted)]">{d.coverSummary}</p>}
            <p className="mt-2 text-sm text-[var(--muted)]">{d.ledger}</p>
          </li>
        ))}
      </ul>
      {data.more > 0 && <p className="text-sm text-[var(--muted)]">{data.more} more {data.more === 1 ? "duty is" : "duties are"} affected. Arrange these ones first, then open this again.</p>}
      {said && <Notice tone="success">{said}</Notice>}
      {problem && <Notice tone="block">{problem}</Notice>}
    </div>
  );
}
