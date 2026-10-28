"use client";

// Emergency roster. For a national exercise or an emergency that takes clinical
// staff out of their unit for days: pick the department, then the cadre, then the
// people, give them one shift, and set the dates. They come off the usual roster
// and colleagues fill in. The emergency roster goes to them and is not published.
import { useMemo, useState } from "react";
import { useFacility } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import type { Cadre, Department, Shift, Staff } from "@/lib/types";
import { WeeklyRoster } from "@/components/WeeklyRoster";
import { Button, Checkbox, EmptyState, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Select, StatusBadge } from "@/components/ui";

interface Dep { id: string; name: string; kind: string; status: "ACTIVE" | "CLOSED"; startDate: string; endDate: string; dueBack: boolean; members: { id: string; name: string; cadre: string | null; department: string | null; shift: string; returnedOn: string | null }[] }
interface Sheet { name: string; days: string[]; rows: { name: string; staffNo: string; shift: string; from: string | null; to: string | null }[] }
interface Chosen { staffId: string; name: string; cadre: string; shiftId: string }
const message = (e: unknown) => (e instanceof ApiError ? (e.body as { message?: string; fields?: Record<string, string> } | undefined)?.message ?? Object.values((e.body as { fields?: Record<string, string> } | undefined)?.fields ?? {})[0] ?? "That did not go through." : "That did not go through. Check your connection and try again.");
const today = () => new Date().toISOString().slice(0, 10);

function Builder({ onMade }: { onMade: (text: string) => void }) {
  const staff = useResource<{ staff: Staff[] }>("/api/facility/staff?show=current");
  const shifts = useResource<{ shifts: Shift[] }>("/api/facility/shifts");
  const departments = useResource<{ departments: Department[] }>("/api/facility/departments");
  const cadres = useResource<{ cadres: Cadre[] }>("/api/facility/cadres");
  const [name, setName] = useState("");
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [dept, setDept] = useState("");
  const [cadre, setCadre] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  const [shiftId, setShiftId] = useState("");
  const [chosen, setChosen] = useState<Chosen[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const dutyShifts = useMemo(() => (shifts.data?.shifts ?? []).filter((s) => s.active && s.countsAsDuty && !s.isOnCall), [shifts.data]);
  const pool = useMemo(
    () => (staff.data?.staff ?? []).filter((s) => s.status === "ACTIVE" && (!dept || s.department?.id === dept) && (!cadre || s.cadre?.id === cadre) && !chosen.some((c) => c.staffId === s.id)),
    [staff.data, dept, cadre, chosen]
  );
  if ([staff, shifts, departments, cadres].some((r) => r.error && !r.data)) return <LoadError onRetry={() => { staff.reload(); shifts.reload(); }} />;
  if (!staff.data || !shifts.data || !departments.data || !cadres.data) return <Loading label="Loading staff and shifts" />;

  function addTicked() {
    const sh = dutyShifts.find((s) => s.id === shiftId);
    if (!sh || ticked.length === 0) return setProblem("Tick the people and choose their shift first.");
    setProblem(null);
    setChosen([...chosen, ...pool.filter((p) => ticked.includes(p.id)).map((p) => ({ staffId: p.id, name: p.fullName, cadre: p.cadre?.name ?? "", shiftId: sh.id }))]);
    setTicked([]);
  }
  async function make() {
    setBusy(true);
    setProblem(null);
    try {
      const r = await api.post<{ roster: { removed: number; filled: number; unfilled: unknown[] } }>("/api/facility/deployments", { name, startDate: start, endDate: end, members: chosen.map((c) => ({ staffId: c.staffId, shiftId: c.shiftId })) });
      onMade(`${chosen.length} ${chosen.length === 1 ? "person is" : "people are"} on ${name}. ${r.roster.removed} usual ${r.roster.removed === 1 ? "duty was" : "duties were"} taken off them and colleagues filled ${r.roster.filled}${r.roster.unfilled.length ? `; ${r.roster.unfilled.length} could not be covered without breaking a rule` : ""}.`);
      setChosen([]);
      setName("");
    } catch (e) {
      setProblem(message(e));
    } finally {
      setBusy(false);
    }
  }
  const nameOf = (id: string) => dutyShifts.find((s) => s.id === id)?.name ?? "";

  return (
    <Panel title="New emergency roster" description="For an exercise or emergency that takes people out of their unit. They leave the usual roster for these dates and come back only when you confirm it.">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="What is it">{(a) => <Input {...a} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="For example, national immunisation exercise" />}</Field>
        <Field label="First day">{(a) => <Input {...a} type="date" min={today()} value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
        <Field label="Last day">{(a) => <Input {...a} type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />}</Field>
      </div>
      <h3 className="mt-6 text-base font-semibold">1. Choose people</h3>
      <div className="mt-2 grid gap-4 sm:grid-cols-2">
        <Field label="Department">{(a) => <Select {...a} value={dept} onChange={(e) => { setDept(e.target.value); setTicked([]); }}><option value="">All departments</option>{departments.data!.departments.filter((d) => d.active !== false).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}</Field>
        <Field label="Cadre">{(a) => <Select {...a} value={cadre} onChange={(e) => { setCadre(e.target.value); setTicked([]); }}><option value="">All cadres</option>{cadres.data!.cadres.filter((c) => c.active !== false).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        <button type="button" className="min-h-11 underline underline-offset-4" onClick={() => setTicked(pool.map((p) => p.id))}>Select all {pool.length}</button>
        <button type="button" className="min-h-11 underline underline-offset-4" onClick={() => setTicked([])}>Clear</button>
      </div>
      <div className="grid max-h-72 gap-x-4 overflow-y-auto sm:grid-cols-2">
        {pool.length === 0 && <p className="py-2 text-sm text-[var(--muted)]">Nobody left under this department and cadre.</p>}
        {pool.map((p) => <Checkbox key={p.id} label={`${p.fullName}${p.cadre ? `, ${p.cadre.name}` : ""}`} checked={ticked.includes(p.id)} onChange={(on) => setTicked(on ? [...ticked, p.id] : ticked.filter((x) => x !== p.id))} />)}
      </div>
      <h3 className="mt-6 text-base font-semibold">2. Give them a shift</h3>
      <div className="mt-2 flex max-w-xl flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1"><Field label="Shift for the ticked people">{(a) => <Select {...a} value={shiftId} onChange={(e) => setShiftId(e.target.value)}><option value="">Choose</option>{dutyShifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}</Field></div>
        <Button type="button" variant="secondary" onClick={addTicked}>Add {ticked.length || ""} to the exercise</Button>
      </div>
      {chosen.length > 0 && (
        <>
          <h3 className="mt-6 text-base font-semibold">On this exercise ({chosen.length})</h3>
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {chosen.map((c) => (
              <li key={c.staffId} className="flex items-center justify-between gap-3 py-2 text-[15px]">
                <span>{c.name}{c.cadre && <span className="text-[var(--muted)]">, {c.cadre}</span>}</span>
                <span className="flex items-center gap-3"><span className="text-sm">{nameOf(c.shiftId)}</span><button type="button" className="min-h-11 text-sm underline underline-offset-4" onClick={() => setChosen(chosen.filter((x) => x.staffId !== c.staffId))}>Remove</button></span>
              </li>
            ))}
          </ul>
        </>
      )}
      {problem && <div className="mt-4"><Notice tone="block">{problem}</Notice></div>}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button disabled={busy || chosen.length === 0 || name.trim().length < 3} onClick={() => void make()}>Take them off the usual roster</Button>
        <span className="text-sm text-[var(--muted)]">Colleagues are put in their place automatically. Published rosters stay published.</span>
      </div>
    </Panel>
  );
}

function Sheet({ id }: { id: string }) {
  const sheet = useResource<Sheet>(`/api/facility/deployments/${id}/roster`);
  if (!sheet.data) return <Loading label="Loading emergency roster" />;
  const d = sheet.data;
  return (
    <div className="mt-3">
      <p className="text-sm text-[var(--muted)]">Every day from {showDate(d.days[0])} to {showDate(d.days[d.days.length - 1])}. Shared with the people on it only. It is not a published roster.</p>
      <table className="mt-2 w-full border-collapse text-left text-[15px]">
        <thead><tr className="text-sm text-[var(--muted)]"><th className="border-b border-[var(--border-strong)] px-3 py-2 font-medium">Person</th><th className="border-b border-[var(--border-strong)] px-3 py-2 font-medium">Shift</th><th className="border-b border-[var(--border-strong)] px-3 py-2 font-medium">Hours</th></tr></thead>
        <tbody>{d.rows.map((r) => <tr key={r.staffNo + r.name}><td className="border-b border-[var(--border)] px-3 py-2">{r.name}</td><td className="border-b border-[var(--border)] px-3 py-2">{r.shift}</td><td className="border-b border-[var(--border)] px-3 py-2">{r.from && r.to ? `${r.from} to ${r.to}` : ""}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

export default function DeploymentsPage() {
  const { isAdmin, me } = useFacility();
  const list = useResource<{ deployments: Dep[] }>("/api/facility/deployments");
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  if (list.error && !list.data) return <LoadError onRetry={list.reload} />;
  if (!list.data) return <Loading label="Loading emergency rosters" />;
  const deps = list.data.deployments;
  return (
    <>
      <PageHeader title="Emergency roster" description="Weekly rosters for units that plan a week at a time, and people taken out of their unit for an exercise or emergency. Those on an exercise are confirmed back under Returns due." />
      {done && <Notice tone="success">{done}</Notice>}
      <div className="mt-4 space-y-6">
        {me.role !== "SUPERVISOR" && <WeeklyRoster />}
        {isAdmin && <Builder onMade={(t) => { setDone(t); list.reload(); }} />}
        <Panel title="Exercises">
          {deps.length === 0 ? (
            <EmptyState title="No emergency rosters yet">When one is set up it is listed here, with who is on it.</EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {deps.map((d) => (
                <li key={d.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{d.name}</p>
                      <p className="text-sm text-[var(--muted)]">{showDate(d.startDate)} to {showDate(d.endDate)}. {d.members.length} {d.members.length === 1 ? "person" : "people"}, {d.members.filter((m) => !m.returnedOn).length} not yet confirmed back.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={d.status === "CLOSED" ? "neutral" : d.dueBack ? "warning" : "success"}>{d.status === "CLOSED" ? "Closed" : d.dueBack ? "Due back" : "Under way"}</StatusBadge>
                      <Button variant="secondary" onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? "Hide roster" : "Show roster"}</Button>
                    </div>
                  </div>
                  {open === d.id && <Sheet id={d.id} />}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
