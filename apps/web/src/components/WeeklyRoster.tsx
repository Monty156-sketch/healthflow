"use client";

// Weekly roster. A unit that plans a week at a time (public health, for one) picks the unit and the first day,
// and the week is drawn with the same rules as the monthly roster, then shared with each person on it.
// An in-charge sees only their own unit.
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import { Button, Field, Input, Loading, Notice, Panel, Select } from "@/components/ui";

interface Week { from: string; to: string; department: string | null; days: { date: string; weekday: string; shifts: { shift: string; people: string[] }[] }[]; unfilled: { date: string; shift: string }[]; rosterIds: string[]; duties: number }
const message = (e: unknown) => (e instanceof ApiError ? (e.body as { message?: string; fields?: Record<string, string> } | undefined)?.message ?? Object.values((e.body as { fields?: Record<string, string> } | undefined)?.fields ?? {})[0] ?? "That did not go through." : "That did not go through. Check your connection and try again.");

/** The next Monday, or today when it is one. */
function nextMonday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}

export function WeeklyRoster() {
  const units = useResource<{ byUnit: boolean; departments: { id: string; name: string }[] }>("/api/facility/weekly-rosters/units");
  const [dept, setDept] = useState("");
  const [start, setStart] = useState(nextMonday());
  const [week, setWeek] = useState<Week | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [drawn, setDrawn] = useState(false);
  if (units.error && !units.data) return null;
  if (!units.data) return <Loading label="Loading weekly rosters" />;
  const { byUnit, departments } = units.data;
  const unit = byUnit ? (departments.length === 1 ? departments[0].id : dept) : "";
  const query = `startDate=${start}${unit ? `&departmentId=${unit}` : ""}`;

  async function run(draw: boolean) {
    setBusy(true);
    setProblem(null);
    try {
      const r = draw
        ? await api.post<{ week: Week }>("/api/facility/weekly-rosters", { startDate: start, departmentId: unit || null })
        : await api.get<{ week: Week }>(`/api/facility/weekly-rosters?${query}`);
      setWeek(r.week);
      setDrawn(draw);
    } catch (e) {
      setProblem(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Weekly roster">
      <p className="text-sm text-[var(--muted)]">For a unit that plans one week at a time. The week is drawn into the unit&apos;s monthly roster with the same rules, and each person is told their duties. Days outside the week are not touched.</p>
      <div className="mt-3 grid max-w-2xl gap-3 sm:grid-cols-2">
        {byUnit && departments.length !== 1 && (
          <Field label="Unit">{(a) => (
            <Select {...a} value={dept} onChange={(e) => { setDept(e.target.value); setWeek(null); }}>
              <option value="">Choose the unit</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          )}</Field>
        )}
        {byUnit && departments.length === 1 && <p className="self-end text-[15px]">Unit: <strong>{departments[0].name}</strong></p>}
        <Field label="First day of the week">{(a) => <Input {...a} type="date" value={start} onChange={(e) => { setStart(e.target.value); setWeek(null); }} />}</Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy || (byUnit && !unit)} onClick={() => void run(false)}>Show this week</Button>
        <Button disabled={busy || (byUnit && !unit)} onClick={() => void run(true)}>{busy ? "Working…" : "Draw this week"}</Button>
      </div>
      {problem && <div className="mt-3"><Notice tone="block">{problem}</Notice></div>}
      {week && (
        <div className="mt-4">
          {drawn && <Notice tone="success">The week is drawn and each person has been told. {week.duties} duties{week.unfilled.length ? `, ${week.unfilled.length} not filled without breaking a rule` : ""}.</Notice>}
          {drawn && week.unfilled.length > 0 && <p className="mt-2 text-sm text-[var(--muted)]">Not filled: {week.unfilled.slice(0, 6).map((u) => `${u.shift} on ${showDate(u.date)}`).join(", ")}{week.unfilled.length > 6 ? ` and ${week.unfilled.length - 6} more` : ""}.</p>}
          <p className="mt-3 text-sm text-[var(--muted)]">{week.department ? `${week.department}, ` : ""}{showDate(week.from)} to {showDate(week.to)}</p>
          {week.duties === 0 ? (
            <p className="mt-2 text-[15px]">Nobody is on duty this week yet. Choose Draw this week.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full border-collapse text-left text-[15px]">
                <thead><tr className="text-sm text-[var(--muted)]"><th className="border-b border-[var(--border-strong)] px-3 py-2 font-medium">Day</th><th className="border-b border-[var(--border-strong)] px-3 py-2 font-medium">Shift</th><th className="border-b border-[var(--border-strong)] px-3 py-2 font-medium">On duty</th></tr></thead>
                <tbody>
                  {week.days.flatMap((d) => d.shifts.map((s, i) => (
                    <tr key={d.date + s.shift}>
                      <td className="border-b border-[var(--border)] px-3 py-2">{i === 0 ? `${d.weekday} ${showDate(d.date)}` : ""}</td>
                      <td className="border-b border-[var(--border)] px-3 py-2">{s.shift}</td>
                      <td className="border-b border-[var(--border)] px-3 py-2">{s.people.join(", ")}</td>
                    </tr>
                  )))}
                </tbody>
              </table>
              <div className="mt-2 flex flex-wrap gap-2 print:hidden">
                <Button variant="secondary" onClick={() => window.print()}>Print this week</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
