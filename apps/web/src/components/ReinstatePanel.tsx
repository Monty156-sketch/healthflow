"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import { Button, Checkbox, Loading, LoadError, Notice } from "@/components/ui";

interface Item {
  kind: "FILL" | "RELIEVE" | "CREDIT";
  day: number;
  date: string;
  shiftId: string;
  shift: string;
  assignmentId: string | null;
  fromName: string | null;
  sentence: string;
  warnings: string[];
}
interface Plan {
  staff: { id: string; name: string };
  roster: { id: string; label: string } | null;
  target: number;
  have: number;
  items: Item[];
  note: string;
}
interface Applied {
  done: string[];
  skipped: { what: string; why: string }[];
}

const key = (i: Item) => `${i.kind}:${i.assignmentId ?? `${i.day}:${i.shiftId}`}`;

/**
 * After someone returns, the rest of the month was built without them. This
 * shows what would give them their fair share, and nothing moves until the
 * in-charge ticks it and applies it. Each item is checked again when applied.
 */
export function ReinstatePanel({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const { data, error, reload } = useResource<Plan>(`/api/facility/leave/requests/${requestId}/reinstatement`);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<Applied | null>(null);

  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Working out the rest of the month" />;
  const picks = chosen ?? new Set(data.items.map(key));

  async function apply() {
    if (!data) return;
    setBusy(true);
    setProblem(null);
    try {
      const items = data.items.filter((i) => picks.has(key(i))).map((i) => ({ kind: i.kind, day: i.day, shiftId: i.shiftId, assignmentId: i.assignmentId ?? undefined }));
      const out = await api.post<Applied>(`/api/facility/leave/requests/${requestId}/reinstate`, { items });
      setResult(out);
      onDone();
    } catch (err) {
      const b = err instanceof ApiError ? (err.body as { message?: string }) : undefined;
      setProblem(b?.message ?? "That did not work. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
      <h3 className="text-[15px] font-semibold">Back on the roster</h3>
      <p className="text-[15px]">{data.note}</p>
      {data.roster && data.target > 0 && (
        <p className="text-sm text-[var(--muted)]">
          Share for the rest of {data.roster.label}: {data.target}. Already has {data.have}.
        </p>
      )}
      {!result && data.items.length > 0 && (
        <>
          <ul className="space-y-2">
            {data.items.map((i) => (
              <li key={key(i)} className="rounded-md border border-[var(--border)] p-3">
                <Checkbox
                  label={`${i.shift}, ${showDate(i.date)}`}
                  checked={picks.has(key(i))}
                  onChange={(on) => {
                    const next = new Set(picks);
                    if (on) next.add(key(i));
                    else next.delete(key(i));
                    setChosen(next);
                  }}
                />
                <p className="mt-1 text-sm text-[var(--muted)]">{i.sentence}</p>
                {i.warnings.map((w) => (
                  <p key={w} className="mt-1 text-sm text-[var(--status-warning)]">
                    {w}
                  </p>
                ))}
              </li>
            ))}
          </ul>
          <p className="text-sm text-[var(--muted)]">Colleagues who lose a duty are told. {data.staff.name} is asked to confirm the duties added.</p>
          <Button disabled={busy || picks.size === 0} onClick={apply}>
            Apply {picks.size} {picks.size === 1 ? "duty" : "duties"}
          </Button>
        </>
      )}
      {result && (
        <div className="space-y-2">
          {result.done.length > 0 && <Notice tone="success">Added: {result.done.join("; ")}.</Notice>}
          {result.skipped.map((s) => (
            <Notice key={s.what} tone="warning">
              {s.what} was not moved. {s.why}
            </Notice>
          ))}
        </div>
      )}
      {problem && <Notice tone="block">{problem}</Notice>}
    </div>
  );
}
