"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import type { SwapCandidates } from "@/lib/types";
import { Button, Field, Loading, LoadError, Notice, Select, Textarea } from "./ui";

interface TheirDuty {
  assignmentId: string;
  date: string;
  shift: string;
  lawful: boolean;
  why: string | null;
  warnings: string[];
}

/** Ask a colleague to take one of your duties, or to trade it for one of theirs. Only lawful options are offered. */
export function SwapAsk({ assignmentId, onDone }: { assignmentId: string; onDone: (sent: boolean) => void }) {
  const { data, error, reload } = useResource<SwapCandidates>(`/api/facility/swaps/candidates?assignmentId=${assignmentId}`);
  const [mode, setMode] = useState<"handover" | "exchange">("handover");
  const [who, setWho] = useState("");
  const [theirs, setTheirs] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const duties = useResource<{ duties: TheirDuty[] }>(mode === "exchange" && who ? `/api/facility/swaps/candidates?assignmentId=${assignmentId}&withStaffId=${who}` : null);

  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Finding who can take this duty" />;

  async function send() {
    setBusy(true);
    setProblem(null);
    try {
      await api.post("/api/facility/swaps", { assignmentId, targetStaffId: who, ...(mode === "exchange" ? { targetAssignmentId: theirs } : {}), reason });
      onDone(true);
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { message?: string }) : undefined;
      setProblem(b?.message ?? "The request was not sent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  const ready = mode === "handover" ? Boolean(who) : Boolean(who && theirs);

  return (
    <div className="mt-3 space-y-3 rounded-[var(--radius)] border border-[var(--border)] p-4">
      <p className="text-[15px] font-medium">
        Swap {data.duty.shift} on {showDate(data.duty.date)}
      </p>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">How</legend>
        <div className="flex flex-wrap gap-4 text-[15px]">
          {(["handover", "exchange"] as const).map((m) => (
            <label key={m} className="flex min-h-11 items-center gap-2">
              <input type="radio" name="swap-mode" checked={mode === m} onChange={() => { setMode(m); setWho(""); setTheirs(""); }} />
              {m === "handover" ? "Hand it over to someone who is free" : "Trade for one of their duties"}
            </label>
          ))}
        </div>
      </fieldset>
      {mode === "handover" ? (
        data.handover.length === 0 ? (
          <Notice tone="warning">Nobody can take this duty without breaking a rule. Try a trade instead.</Notice>
        ) : (
          <Field label="Who">
            {(a) => (
              <Select {...a} value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">Choose a colleague</option>
                {data.handover.map((p) => (
                  <option key={p.staffId} value={p.staffId}>
                    {p.name}{p.cadre ? `, ${p.cadre}` : ""}{p.warnings.length ? " (with a warning)" : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )
      ) : (
        <>
          <Field label="Trade with">
            {(a) => (
              <Select {...a} value={who} onChange={(e) => { setWho(e.target.value); setTheirs(""); }}>
                <option value="">Choose a colleague</option>
                {data.colleagues.map((p) => (
                  <option key={p.staffId} value={p.staffId}>
                    {p.name}{p.cadre ? `, ${p.cadre}` : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {who && (duties.loading || !duties.data ? (
            <Loading label="Checking their duties" />
          ) : duties.data.duties.length === 0 ? (
            <p className="text-[15px] text-[var(--muted)]">They have no coming duties to trade.</p>
          ) : (
            <Field label="Their duty">
              {(a) => (
                <Select {...a} value={theirs} onChange={(e) => setTheirs(e.target.value)}>
                  <option value="">Choose a duty</option>
                  {duties.data!.duties.map((d) => (
                    <option key={d.assignmentId} value={d.assignmentId} disabled={!d.lawful}>
                      {showDate(d.date)}, {d.shift}{d.lawful ? "" : ` (not allowed: ${d.why})`}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ))}
        </>
      )}
      <Field label="Reason" optional>{(a) => <Textarea {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      {problem && <Notice tone="block">{problem}</Notice>}
      <div className="flex gap-2">
        <Button disabled={busy || !ready} onClick={send}>{busy ? "Sending…" : "Send request"}</Button>
        <Button variant="secondary" onClick={() => onDone(false)}>Cancel</Button>
      </div>
    </div>
  );
}
