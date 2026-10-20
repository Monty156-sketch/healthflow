"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { showDate } from "@/lib/format";
import type { LeaveRequestRow } from "@/lib/types";
import { Button, Field, Input, Notice, Textarea } from "@/components/ui";

const todayIso = () => new Date().toISOString().slice(0, 10);

const next = (iso: string) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

/**
 * Confirming a return, or asking for more time. A date passing never counts as a
 * return, so someone has to say the day they are back.
 */
export function ReturnActions({ request: r, onDone }: { request: LeaveRequestRow; onDone: () => void }) {
  const [mode, setMode] = useState<"back" | "more" | null>(null);
  const [date, setDate] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const openLeave = r.status === "APPROVED" && !r.actualReturnDate && r.returnStatus !== "EXTENDED";
  if (!openLeave) return null;
  const started = r.startDate <= todayIso();
  const canExtend = !r.isOpenEnded;

  async function send(path: string, body: object) {
    setBusy(true);
    setProblem(null);
    setFieldError(null);
    try {
      await api.post(`/api/facility/leave/requests/${r.id}/${path}`, body);
      setMode(null);
      onDone();
    } catch (err) {
      const b = err instanceof ApiError ? (err.body as { message?: string; fields?: Record<string, string> }) : undefined;
      if (b?.fields) setFieldError(Object.values(b.fields)[0] ?? null);
      else setProblem(b?.message ?? "That did not work. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
      <h3 className="text-[15px] font-semibold">Back on duty</h3>
      {r.isOpenEnded && <p className="text-[15px] text-[var(--muted)]">No end date. Off the roster until return is confirmed.</p>}
      {!mode && (
        <div className="flex flex-wrap gap-2">
          {started && (
            <Button variant="secondary" onClick={() => setMode("back")}>
              Report back
            </Button>
          )}
          {canExtend && (
            <Button variant="secondary" onClick={() => { setMode("more"); setDate(next(r.endDate)); }}>
              Needs more time
            </Button>
          )}
        </div>
      )}
      {mode === "back" && (
        <div className="max-w-sm space-y-3">
          <Field label="Day back on duty" error={fieldError ?? undefined} hint={`Leave started ${showDate(r.startDate)}.`}>
            {(a) => <Input {...a} type="date" min={next(r.startDate)} max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
          <div className="flex gap-2">
            <Button disabled={busy || !date} onClick={() => send("report-back", { date })}>
              Confirm return
            </Button>
            <Button variant="quiet" onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {mode === "more" && (
        <div className="max-w-sm space-y-3">
          <Field label="New last day of leave" error={fieldError ?? undefined} hint={`The extension starts ${showDate(next(r.endDate))}. Your in-charge decides.`}>
            {(a) => <Input {...a} type="date" min={next(r.endDate)} value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
          <Field label="Reason" optional hint="Keep it operational. Do not write a diagnosis or symptoms.">
            {(a) => <Textarea {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <div className="flex gap-2">
            <Button disabled={busy || !date} onClick={() => send("extend", { endDate: date, reason })}>
              Ask for more time
            </Button>
            <Button variant="quiet" onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {problem && <Notice tone="block">{problem}</Notice>}
    </div>
  );
}
