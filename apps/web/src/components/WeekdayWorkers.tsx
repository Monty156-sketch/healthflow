"use client";

// Which departments work Monday to Friday and rest on Saturday, Sunday and public holidays.
// The roster engine reads this the same way it reads a duty cycle: those departments are staffed
// to their minimum on weekday mornings and nobody is put on at weekends or on a public holiday.
import { useState } from "react";
import { useFacility } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import type { Department } from "@/lib/types";
import { Checkbox, EmptyState, Loading, LoadError, Notice, Panel } from "@/components/ui";

export function WeekdayWorkers() {
  const { isAdmin } = useFacility();
  const list = useResource<{ departments: Department[] }>("/api/facility/departments");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (list.error && !list.data) return <LoadError onRetry={list.reload} />;
  if (!list.data) return <Loading label="Loading departments" />;
  const rows = list.data.departments.filter((d) => d.active !== false && (d.kind ?? "WARD") !== "OFFICE");

  async function set(d: Department, weekdaysOnly: boolean) {
    setBusy(d.id);
    setProblem(null);
    try {
      await api.patch(`/api/facility/departments/${d.id}`, { name: d.name, code: d.code ?? "", weekdaysOnly });
      list.reload();
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { message?: string } | undefined) : undefined;
      setProblem(b?.message ?? "That did not save. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {problem && <Notice tone="block">{problem}</Notice>}
      {!isAdmin && <Notice>Only the facility administrator changes this.</Notice>}
      <Panel title="Departments that work Monday to Friday" description="Tick a department and its staff work weekday mornings only. They rest on Saturday, Sunday and public holidays. The roster is built to the department's minimum for the morning shift.">
        {rows.length === 0 ? (
          <EmptyState title="No departments yet" />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {rows.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="font-medium">{d.name}</span>
                <Checkbox label="Monday to Friday" checked={d.weekdaysOnly === true} disabled={!isAdmin || busy === d.id} onChange={(c) => set(d, c)} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <p className="text-sm text-[var(--muted)]">Public health is set to Monday to Friday by default. A cadre that works office hours is set on Departments and cadres.</p>
    </div>
  );
}
