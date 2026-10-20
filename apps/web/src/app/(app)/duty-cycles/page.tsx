"use client";

import { useState } from "react";
import { useFacility } from "@/components/AppShell";
import { CycleForm } from "@/components/CycleForm";
import { ShiftStrip, buildStrip } from "@/components/ShiftStrip";
import { PatternPreview } from "@/components/PatternPreview";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { MONTHS } from "@/lib/format";
import type { CapacityRow, CycleRule } from "@/lib/types";
import { Button, ConfirmDialog, EmptyState, Loading, LoadError, Notice, PageHeader, Panel, Select, StatusBadge } from "@/components/ui";

interface Data {
  rules: CycleRule[];
  checks?: string[];
  shifts: { id: string; code: string; name: string; colour: string | null; isOvernight: boolean }[];
  cadres: { id: string; name: string }[];
  departments: { id: string; name: string }[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function CapacityLine({ r }: { r: CapacityRow }) {
  const rule = r.rule ? `"${r.rule.name}"` : "no off-day rule";
  if (r.achievable) {
    return (
      <p>
        <strong>{r.cadreName}: achievable.</strong> {plural(r.staffCount, "active staff member", "active staff")} under {rule} can cover about{" "}
        <span className="figures">{r.supply}</span> duties this month. Your shifts require <span className="figures">{r.demand}</span>.
      </p>
    );
  }
  return (
    <p>
      <strong>{r.cadreName}: not achievable.</strong> {plural(r.staffCount, "active staff member", "active staff")} under {rule} can cover about{" "}
      <span className="figures">{r.supply}</span> duties this month. Your shifts require <span className="figures">{r.demand}</span>.{" "}
      <strong>
        Short by <span className="figures">{r.shortBy}</span>.
      </strong>{" "}
      You need at least {plural(r.staffNeeded, "more person", "more people")} in this cadre
      {r.suggestion && (
        <>
          , or that rule relaxed to <span className="figures">{r.suggestion.consecutiveDuties}</span> on, <span className="figures">{r.suggestion.offDaysRequired}</span> off
        </>
      )}
      .
    </p>
  );
}

function CapacityPanel() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const { data, error, reload } = useResource<{ month: string; daysInMonth: number; cadres: CapacityRow[] }>(`/api/facility/cycles/capacity?month=${key}`);
  const years = Array.from({ length: 3 }, (_, i) => now.getFullYear() + i - 1);
  return (
    <Panel title="Capacity check" description="Can your staff cover your shifts under these rules?">
      <div className="mb-4 flex flex-wrap gap-2">
        <div>
          <label htmlFor="cap-month" className="sr-only">
            Month
          </label>
          <Select id="cap-month" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="cap-year" className="sr-only">
            Year
          </label>
          <Select id="cap-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </Select>
        </div>
      </div>
      {error && !data ? (
        <LoadError onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : data.cadres.length === 0 ? (
        <p className="text-[15px] text-[var(--muted)]">
          Set a cadre minimum on a shift to see this.
        </p>
      ) : (
        <div className="space-y-3 text-[15px]">
          {data.cadres.map((r) => (
            <CapacityLine key={r.cadreId} r={r} />
          ))}
        </div>
      )}
      <p className="mt-4 text-sm text-[var(--muted)]">
        An estimate. Leave is not counted.
      </p>
    </Panel>
  );
}

export default function DutyCyclesPage() {
  const { isAdmin } = useFacility();
  const { data, error, reload } = useResource<Data>("/api/facility/cycles");
  const [editing, setEditing] = useState<CycleRule | "new" | null>(null);
  const [newKind, setNewKind] = useState<"NIGHT" | "DAY" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [capKey, setCapKey] = useState(0);
  const [deleting, setDeleting] = useState<CycleRule | null>(null);

  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading duty cycles" />;

  const shiftCodes = (r: CycleRule) =>
    r.countingShiftIds.map((id) => data.shifts.find((s) => s.id === id)?.code).filter(Boolean).join(", ") || "Shifts turned off";
  const applies = (r: CycleRule) => {
    const c = r.applicableCadreIds.map((id) => data.cadres.find((x) => x.id === id)?.name).filter(Boolean);
    const d = r.applicableDepartmentIds.map((id) => data.departments.find((x) => x.id === id)?.name).filter(Boolean);
    return [c.length ? c.join(", ") : "All cadres", d.length ? d.join(", ") : "all departments"].join(" in ");
  };

  async function toggleActive(r: CycleRule) {
    setBusy(true);
    setProblem(null);
    try {
      await api.patch(`/api/facility/cycles/${r.id}/active`, { active: !r.active });
      reload();
      setCapKey((k) => k + 1);
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { message?: string }) : undefined;
      setProblem(body?.message ?? "This could not be changed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.delete(`/api/facility/cycles/${deleting.id}`);
      setDeleting(null);
      reload();
      setCapKey((k) => k + 1);
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { message?: string }) : undefined;
      setProblem(body?.message ?? "This could not be deleted. Try again.");
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Duty cycles"
        description="Duties in a row, then days off. One rule for nights, one for days."
        actions={
          isAdmin && editing === null && data.shifts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => { setNewKind("NIGHT"); setEditing("new"); }}>Add night rule</Button>
              <Button variant="secondary" onClick={() => { setNewKind("DAY"); setEditing("new"); }}>Add day rule</Button>
            </div>
          )
        }
      />
      {problem && (
        <div className="mb-4">
          <Notice tone="block">{problem}</Notice>
        </div>
      )}
      <div className="mb-6">
        <Notice>
          Staff work in whole blocks, each followed by its days off. Changes apply to the next roster.
        </Notice>
      </div>
      {data.checks && data.checks.length > 0 && (
        <div className="mb-6 space-y-2">
          {data.checks.map((c) => (
            <Notice key={c} tone="warning">{c}</Notice>
          ))}
        </div>
      )}

      {editing !== null && (
        <div className="mb-6">
          <Panel title={editing === "new" ? (newKind === "NIGHT" ? "Add a night rule" : newKind === "DAY" ? "Add a day rule" : "Add a duty cycle rule") : `Edit ${editing.name}`}>
            <CycleForm
              key={editing === "new" ? "new" : editing.id}
              rule={editing === "new" ? null : editing}
              kind={editing === "new" ? newKind : null}
              lookups={data}
              onSaved={() => {
                setEditing(null);
                reload();
                setCapKey((k) => k + 1);
              }}
              onCancel={() => setEditing(null)}
            />
          </Panel>
        </div>
      )}

      {data.rules.length === 0 && editing === null ? (
        <EmptyState title="No duty cycle rules yet">
          {data.shifts.length === 0 ? "Add your shifts first, under Shifts. Two starting rules are then set up for you." : "Add a rule to set how many days off follow a run of duties."}
        </EmptyState>
      ) : (
        <ul className="space-y-4">
          {[...data.rules].sort((x, y) => (x.kind === y.kind ? 0 : x.kind === "NIGHT" ? -1 : 1)).map((r) => {
            const colour = data.shifts.find((s) => r.countingShiftIds.includes(s.id))?.colour ?? "#25619f";
            return (
              <li key={r.id} className={r.active ? "" : "opacity-70"}>
                <Panel
                  title={r.name}
                  description={`Priority ${r.priority}. Counts ${shiftCodes(r)}. Applies to ${applies(r)}.`}
                  actions={
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone="neutral">{r.kind === "NIGHT" ? "Night rule" : "Day rule"}</StatusBadge>
                      <StatusBadge tone={r.enforcement === "BLOCK" ? "warning" : "neutral"}>{r.enforcement === "BLOCK" ? "Block" : "Prefer"}</StatusBadge>
                      {!r.active && <StatusBadge tone="neutral">Off</StatusBadge>}
                    </div>
                  }
                >
                  <p className="mb-3 text-[15px]">
                    After <span className="figures font-semibold">{r.consecutiveDuties}</span> consecutive duties, give{" "}
                    <span className="figures font-semibold">{r.offDaysRequired}</span> days off{r.offDaysConsecutive ? ", together" : ""}.
                  </p>
                  {r.nextShiftAfterRestId || r.blockShiftPatternIds.length > 0 ? (
                    <>
                      {r.blockShiftPatternIds.length > 0 && (
                        <p className="mb-1 text-[15px]">Inside a block: {r.blockShiftPatternIds.map((id) => data.shifts.find((s) => s.id === id)?.name ?? "a shift").join(", ")}.</p>
                      )}
                      {r.nextShiftAfterRestId && (
                        <p className="mb-3 text-[15px]">After the days off, the first duty back is {data.shifts.find((s) => s.id === r.nextShiftAfterRestId)?.name ?? "a shift"}.</p>
                      )}
                      <ShiftStrip
                        cells={buildStrip({ duties: r.consecutiveDuties, off: r.offDaysRequired, pattern: r.blockShiftPatternIds, afterRest: r.nextShiftAfterRestId })}
                        shifts={data.shifts}
                      />
                    </>
                  ) : (
                    <PatternPreview duties={r.consecutiveDuties} off={r.offDaysRequired} colour={colour} />
                  )}
                  {isAdmin && editing === null && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => setEditing(r)}>
                        Edit
                      </Button>
                      <Button variant="quiet" disabled={busy} onClick={() => toggleActive(r)}>
                        {r.active ? "Turn off" : "Turn on"}
                      </Button>
                      <Button variant="quiet" disabled={busy} onClick={() => setDeleting(r)}>
                        Delete
                      </Button>
                    </div>
                  )}
                </Panel>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-6">
        <CapacityPanel key={capKey} />
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? "this rule"}?`}
        confirmLabel="Delete rule"
        tone="danger"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      >
        Past rosters are not changed. Turn it off instead if you may want it back.
      </ConfirmDialog>
    </>
  );
}
