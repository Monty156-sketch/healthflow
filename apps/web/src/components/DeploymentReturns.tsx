"use client";

// Return due, for emergency rosters. People on an exercise stay off the usual
// roster until the in-charge confirms they are back, after the rest they were given.
// Confirming re-plans the rest of the month with them in.
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import { Button, Checkbox, Field, Input, Notice, Panel, StatusBadge } from "@/components/ui";

interface Dep { id: string; name: string; kind: string; status: "ACTIVE" | "CLOSED"; startDate: string; endDate: string; dueBack: boolean; members: { id: string; name: string; cadre: string | null; shift: string; returnedOn: string | null }[] }

export function DeploymentReturns() {
  const list = useResource<{ deployments: Dep[] }>("/api/facility/deployments");
  const [ticked, setTicked] = useState<Record<string, string[]>>({});
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const open = (list.data?.deployments ?? []).filter((d) => d.status === "ACTIVE");
  if (open.length === 0) return null;

  async function confirm(d: Dep) {
    setBusy(d.id);
    setProblem(null);
    setDone(null);
    try {
      const r = await api.post<{ confirmed: number; replan: { removed: number; filled: number; unfilled: unknown[] } }>(`/api/facility/deployments/${d.id}/back`, { memberIds: ticked[d.id] ?? [], date });
      setDone(`${r.confirmed} confirmed back from ${d.name}. The rest of the month was planned again with them in${r.replan.unfilled.length ? `; ${r.replan.unfilled.length} duties could not be filled without breaking a rule` : ""}.`);
      setTicked({ ...ticked, [d.id]: [] });
      list.reload();
    } catch (e) {
      setProblem(e instanceof ApiError ? ((e.body as { message?: string; fields?: Record<string, string> } | undefined)?.message ?? Object.values((e.body as { fields?: Record<string, string> } | undefined)?.fields ?? {})[0] ?? "That did not go through.") : "That did not go through. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-6 space-y-4">
      {done && <Notice tone="success">{done}</Notice>}
      {problem && <Notice tone="block">{problem}</Notice>}
      {open.map((d) => {
        const waiting = d.members.filter((m) => !m.returnedOn);
        const picked = ticked[d.id] ?? [];
        return (
          <Panel key={d.id} title={d.kind === "SWAP" ? d.name : `${d.name}: emergency roster`} description={`${showDate(d.startDate)} to ${showDate(d.endDate)}. They stay off the usual roster until you confirm them back.`} actions={<StatusBadge tone={d.dueBack ? "warning" : "success"}>{d.dueBack ? "Due back" : "Under way"}</StatusBadge>}>
            <div className="mb-2 flex flex-wrap gap-2 text-sm">
              <button type="button" className="min-h-11 underline underline-offset-4" onClick={() => setTicked({ ...ticked, [d.id]: waiting.map((m) => m.id) })}>Select all {waiting.length}</button>
              <button type="button" className="min-h-11 underline underline-offset-4" onClick={() => setTicked({ ...ticked, [d.id]: [] })}>Clear</button>
            </div>
            <div className="grid gap-x-4 sm:grid-cols-2">
              {waiting.map((m) => <Checkbox key={m.id} label={`${m.name}${m.cadre ? `, ${m.cadre}` : ""} (${m.shift})`} checked={picked.includes(m.id)} onChange={(on) => setTicked({ ...ticked, [d.id]: on ? [...picked, m.id] : picked.filter((x) => x !== m.id) })} />)}
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="w-48"><Field label="First day back on the usual roster">{(a) => <Input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field></div>
              <Button disabled={busy === d.id || picked.length === 0} onClick={() => void confirm(d)}>Confirm {picked.length || ""} back</Button>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
