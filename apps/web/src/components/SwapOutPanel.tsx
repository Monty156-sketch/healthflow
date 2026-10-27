"use client";

// A member of staff steps out of duty for a few days. Their duties are covered
// at once, with no approval, and they are brought back by the in-charge under Returns due.
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, Field, Input, Notice, Panel } from "@/components/ui";

export function SwapOutPanel({ onDone }: { onDone?: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(today);
  const [days, setDays] = useState("1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setProblem(null);
    setDone(null);
    try {
      const r = await api.post<{ roster: { removed: number; filled: number; unfilled: unknown[] } }>("/api/facility/deployments/swap-out", { startDate: start, days: Number(days), reason: reason || undefined });
      setDone(`Done. ${r.roster.removed} of your ${r.roster.removed === 1 ? "duty was" : "duties were"} taken off and colleagues were put in${r.roster.unfilled.length ? `; ${r.roster.unfilled.length} could not be covered without breaking a rule, and your in-charge has been told` : ""}. Tell your in-charge when you are back so you are added to the rest of the month.`);
      onDone?.();
    } catch (e) {
      setProblem(e instanceof ApiError ? ((e.body as { message?: string; fields?: Record<string, string> } | undefined)?.message ?? Object.values((e.body as { fields?: Record<string, string> } | undefined)?.fields ?? {})[0] ?? "That did not go through.") : "That did not go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Step out of duty" description="For one to seven days. Your duties are covered straight away. Your in-charge confirms when you are back, and you are added to the rest of the month.">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="First day">{(a) => <Input {...a} type="date" min={today} value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
        <Field label="Number of days">{(a) => <Input {...a} type="number" min={1} max={7} value={days} onChange={(e) => setDays(e.target.value)} />}</Field>
        <Field label="Reason" optional>{(a) => <Input {...a} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />}</Field>
      </div>
      {done && <div className="mt-3"><Notice tone="success">{done}</Notice></div>}
      {problem && <div className="mt-3"><Notice tone="block">{problem}</Notice></div>}
      <div className="mt-4"><Button disabled={busy || !start || !Number(days)} onClick={() => void go()}>Step out and have my duties covered</Button></div>
    </Panel>
  );
}
