"use client";

import { useState } from "react";
import { useFacility } from "@/components/AppShell";
import { ShiftForm } from "@/components/ShiftForm";
import { GridChip } from "@/components/MonthGrid";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import type { Shift } from "@/lib/types";
import { Button, EmptyState, Loading, LoadError, Notice, PageHeader, Panel, StatusBadge, TD, TH, TableScroll } from "@/components/ui";

const hours = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)}`;

export default function ShiftsPage() {
  const { isAdmin } = useFacility();
  const { data, error, reload } = useResource<{ shifts: Shift[]; cadres: { id: string; name: string }[] }>("/api/facility/shifts");
  const [editing, setEditing] = useState<Shift | "new" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading shifts" />;
  const cadreName = new Map(data.cadres.map((c) => [c.id, c.name]));
  const duty = data.shifts.filter((s) => s.countsAsDuty);

  async function run(fn: () => Promise<unknown>, fail: string) {
    setBusy(true);
    setProblem(null);
    try {
      await fn();
      reload();
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { message?: string }) : undefined;
      setProblem(body?.message ?? fail);
    } finally {
      setBusy(false);
    }
  }

  function who(s: Shift) {
    if (!s.countsAsDuty) return "Fills every blank";
    if (!s.eligibleCadreIds.length) return "All cadres";
    return s.eligibleCadreIds.map((id) => cadreName.get(id) ?? "Removed cadre").join(", ");
  }

  function minimum(s: Shift) {
    if (!s.countsAsDuty) return "None";
    const by = Object.entries(s.minByCadre).map(([id, n]) => `${n} ${cadreName.get(id) ?? "from a removed cadre"}`);
    const base = by.length ? `${s.minStaff} (${by.join(", ")})` : String(s.minStaff);
    const extra = [s.weekendMinStaff != null ? `weekends ${s.weekendMinStaff}` : null, s.holidayMinStaff != null ? `holidays ${s.holidayMinStaff}` : null].filter(Boolean);
    return extra.length ? `${base}; ${extra.join(", ")}` : base;
  }

  return (
    <>
      <PageHeader
        title="Shifts"
        description="The shifts your facility works. Rosters, rest checks and staffing minimums are all built from these."
        actions={isAdmin && editing === null && <Button onClick={() => setEditing("new")}>Add shift</Button>}
      />
      {problem && (
        <div className="mb-4">
          <Notice tone="block">{problem}</Notice>
        </div>
      )}
      {editing !== null && (
        <div className="mb-6">
          <Panel title={editing === "new" ? "Add a shift" : `Edit ${editing.name}`}>
            <ShiftForm
              key={editing === "new" ? "new" : editing.id}
              shift={editing === "new" ? null : editing}
              cadres={data.cadres}
              onSaved={() => {
                setEditing(null);
                reload();
              }}
              onCancel={() => setEditing(null)}
            />
          </Panel>
        </div>
      )}

      {duty.length === 0 && editing === null && (
        <EmptyState
          title="No shifts yet"
          action={
            isAdmin && (
              <Button disabled={busy} onClick={() => run(() => api.post("/api/facility/shifts/starter"), "The starting shifts could not be added. Try again.")}>
                Add Morning, Afternoon and Night
              </Button>
            )
          }
        >
          Add your own, or start with Morning 08:00 to 14:00, Afternoon 14:00 to 20:00 and Night 20:00 to 08:00. You can change all of it afterwards.
        </EmptyState>
      )}

      <TableScroll label="Shifts">
        <table className="w-full text-[15px]">
          <thead>
            <tr>
              <th className={TH}>Shift</th>
              <th className={TH}>Time</th>
              <th className={TH}>Hours</th>
              <th className={TH}>Minimum staff</th>
              <th className={TH}>Who can work it</th>
              <th className={TH}>Status</th>
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.shifts.map((s) => (
              <tr key={s.id} className={s.active ? "" : "text-[var(--muted)]"}>
                <td className={TD}>
                  <span className="flex items-center gap-2">
                    <GridChip code={s.code} tone="neutral" colour={s.colour ?? undefined} />
                    <span className="font-medium">{s.name}</span>
                  </span>
                  {s.isOnCall && <span className="mt-1 block text-sm text-[var(--muted)]">On call, counts as {s.onCallHoursFactor} of its hours</span>}
                </td>
                <td className={`${TD} figures whitespace-nowrap`}>
                  {s.countsAsDuty ? (
                    <>
                      {s.startTime} to {s.endTime}
                      {s.isOvernight && <span className="block font-sans text-sm text-[var(--muted)]">Ends next morning</span>}
                    </>
                  ) : (
                    "None"
                  )}
                </td>
                <td className={`${TD} figures`}>{hours(s.durationHours)}</td>
                <td className={TD}>{minimum(s)}</td>
                <td className={`${TD} max-w-56`}>{who(s)}</td>
                <td className={TD}>{s.active ? <StatusBadge tone="success">In use</StatusBadge> : <StatusBadge tone="neutral">Off</StatusBadge>}</td>
                <td className={TD}>
                  {isAdmin && editing === null && (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => setEditing(s)}>
                        Edit
                      </Button>
                      {s.countsAsDuty && (
                        <Button
                          variant="quiet"
                          disabled={busy}
                          onClick={() => run(() => api.patch(`/api/facility/shifts/${s.id}/active`, { active: !s.active }), "This could not be changed. Try again.")}
                        >
                          {s.active ? "Turn off" : "Turn on"}
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <p className="mt-3 max-w-[65ch] text-sm text-[var(--muted)]">
        Shifts are never deleted. A shift that is turned off disappears from new rosters but stays on past ones.
      </p>
    </>
  );
}
