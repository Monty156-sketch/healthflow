"use client";

import { FormEvent, useCallback, useState } from "react";
import { useFacility } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useResource, useSave } from "@/lib/useApi";
import type { Cadre, Department } from "@/lib/types";
import {
  Button,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Loading,
  LoadError,
  Notice,
  PageHeader,
  Panel,
  SaveStatus,
  Select,
  StatusBadge,
  TableScroll,
  TD,
  TH,
} from "@/components/ui";

type Group = Department | Cadre;

interface Kind {
  key: "departments" | "cadres";
  singular: string;
  title: string;
  description: string;
  namePlaceholder: string;
  codeHint: string;
  empty: string;
}

const KINDS: Record<"departments" | "cadres", Kind> = {
  departments: {
    key: "departments",
    singular: "department",
    title: "Departments",
    description: "Where staff work.",
    namePlaceholder: "For example, Maternity",
    codeHint: "A short code, for example MAT.",
    empty: "Add the departments that appear on your roster, such as OPD, Maternity or Ward.",
  },
  cadres: {
    key: "cadres",
    singular: "cadre",
    title: "Cadres",
    description: "Professional groups, in roster order.",
    namePlaceholder: "For example, Midwife",
    codeHint: "A short code shown on the roster, for example RM.",
    empty: "Add the cadres at your facility, such as Nurse, Midwife or Community Health Nurse.",
  },
};

function AddForm({ kind, onAdded }: { kind: Kind; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const add = useCallback(
    (body: { name: string; code: string }) => api.post(`/api/facility/${kind.key}`, body),
    [kind.key]
  );
  const save = useSave(add);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await save.run({ name, code });
    if (ok) {
      setName("");
      setCode("");
      onAdded();
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mb-4 grid items-start gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
      <Field label={`New ${kind.singular} name`} error={save.fieldErrors.name}>
        {(a) => <Input {...a} placeholder={kind.namePlaceholder} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field label="Code" optional error={save.fieldErrors.code}>
        {(a) => <Input {...a} className="figures" value={code} onChange={(e) => setCode(e.target.value)} />}
      </Field>
      <div className="flex items-center gap-3 sm:pt-6">
        <Button type="submit" disabled={save.state === "saving"}>
          Add {kind.singular}
        </Button>
        <SaveStatus state={save.state} />
      </div>
      {save.state === "failed" && save.message && !Object.keys(save.fieldErrors).length && (
        <div className="sm:col-span-3">
          <Notice tone="block">{save.message}</Notice>
        </div>
      )}
    </form>
  );
}

function EditRow({ kind, item, onDone }: { kind: Kind; item: Group; onDone: (changed: boolean) => void }) {
  const [name, setName] = useState(item.name);
  const [code, setCode] = useState(item.code ?? "");
  const [runsNights, setRunsNights] = useState((item as Department).runsNights !== false);
  const [unit, setUnit] = useState((item as Department).kind ?? "WARD");
  const c = item as Cadre;
  const [works, setWorks] = useState<"shifts" | "days" | "office" | "off">(
    c.onRoster === false ? "off" : c.weekdaysOnly ? "office" : c.takesNights === false ? "days" : "shifts"
  );
  const update = useCallback(
    (body: { name: string; code: string }) => api.patch(`/api/facility/${kind.key}/${item.id}`, body),
    [kind.key, item.id]
  );
  const save = useSave(update);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const flags =
      kind.key === "departments"
        ? { runsNights, kind: unit }
        : { onRoster: works !== "off", takesNights: works === "shifts", weekdaysOnly: works === "office" };
    if (await save.run({ name, code, ...flags } as { name: string; code: string })) onDone(true);
  }

  return (
    <tr>
      <td colSpan={4} className={TD}>
        <form onSubmit={onSubmit} noValidate className="grid items-start gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
          <Field label="Name" error={save.fieldErrors.name}>
            {(a) => <Input {...a} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Code" optional error={save.fieldErrors.code}>
            {(a) => <Input {...a} className="figures" value={code} onChange={(e) => setCode(e.target.value)} />}
          </Field>
          <div className="space-y-1 sm:col-span-3">
            {kind.key === "departments" ? (
              <>
                <Field label="Type">
                  {(a) => (
                    <Select {...a} value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}>
                      <option value="WARD">Ward: its in-charge makes the roster</option>
                      <option value="SUPPORT">Support unit: the administrator makes the roster</option>
                      <option value="OFFICE">Office: no roster</option>
                    </Select>
                  )}
                </Field>
                <Checkbox label="Runs night duty" checked={runsNights} onChange={setRunsNights} />
              </>
            ) : (
              <Field label="How this cadre works">
                {(a) => (
                  <Select {...a} value={works} onChange={(e) => setWorks(e.target.value as typeof works)}>
                    <option value="shifts">Shifts, nights included</option>
                    <option value="days">Shifts, day shifts only</option>
                    <option value="office">Weekday office hours (mornings, Monday to Friday)</option>
                    <option value="off">Not on the duty roster</option>
                  </Select>
                )}
              </Field>
            )}
            <p className="text-sm text-[var(--muted)]">
              {kind.key === "departments" ? "Untick for a department closed at night." : "Usually: nurses and midwives on shifts, pharmacy and lab on office hours."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:pt-6">
            <Button type="submit" disabled={save.state === "saving"}>
              Save
            </Button>
            <Button variant="secondary" onClick={() => onDone(false)}>
              Cancel
            </Button>
            <SaveStatus state={save.state} onRetry={save.retry} />
          </div>
          {save.state === "failed" && save.message && !Object.keys(save.fieldErrors).length && (
            <div className="sm:col-span-3">
              <Notice tone="block">{save.message}</Notice>
            </div>
          )}
        </form>
      </td>
    </tr>
  );
}

function GroupSection({ kind }: { kind: Kind }) {
  const { isAdmin, reload: reloadFacility } = useFacility();
  const list = useResource<Record<string, Group[]>>(`/api/facility/${kind.key}`);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const items = list.data?.[kind.key] ?? [];

  const refresh = () => {
    list.reload();
    reloadFacility();
  };

  async function onToggle(item: Group) {
    setProblem(null);
    setBusyId(item.id);
    try {
      await api.patch(`/api/facility/${kind.key}/${item.id}/active`, { active: !item.active });
      refresh();
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { message?: string }) : undefined;
      setProblem(
        body?.message ??
          (e instanceof ApiError
            ? `${item.name} could not be ${item.active ? "deactivated" : "reactivated"}. Try again.`
            : "No connection. Try again when you are back online.")
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Panel title={kind.title} description={kind.description}>
      <div id={kind.key} className="scroll-mt-24" />
      {isAdmin && <AddForm kind={kind} onAdded={refresh} />}
      {problem && (
        <div className="mb-4">
          <Notice tone="warning">{problem}</Notice>
        </div>
      )}
      {list.error && !list.data && <LoadError onRetry={list.reload} />}
      {!list.data && !list.error && <Loading />}
      {list.data && items.length === 0 && <EmptyState title={`No ${kind.key} yet`}>{kind.empty}</EmptyState>}
      {items.length > 0 && (
        <TableScroll label={kind.title}>
          <table className="w-full min-w-[32rem] border-collapse text-[15px]">
            <thead>
              <tr>
                <th scope="col" className={TH}>Name</th>
                <th scope="col" className={TH}>Code</th>
                <th scope="col" className={`${TH} text-right`}>Current staff</th>
                <th scope="col" className={TH}>
                  <span className={isAdmin ? "" : "sr-only"}>{isAdmin ? "Status and actions" : "Status"}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) =>
                editingId === item.id ? (
                  <EditRow
                    key={item.id}
                    kind={kind}
                    item={item}
                    onDone={(changed) => {
                      setEditingId(null);
                      if (changed) refresh();
                    }}
                  />
                ) : (
                  <tr key={item.id} className={item.active ? "" : "text-[var(--muted)]"}>
                    <td className={`${TD} font-medium`}>{item.name}</td>
                    <td className={`${TD} figures`}>{item.code ?? ""}</td>
                    <td className={`${TD} figures text-right`}>{item.staffCount}</td>
                    <td className={TD}>
                      <div className="flex flex-wrap items-center gap-2">
                        {!item.active && <StatusBadge tone="neutral">Inactive</StatusBadge>}
                        {kind.key === "departments" && (item as Department).kind === "SUPPORT" && <StatusBadge tone="neutral">Support unit</StatusBadge>}
                        {kind.key === "departments" && (item as Department).kind === "OFFICE" && <StatusBadge tone="neutral">No roster</StatusBadge>}
                        {kind.key === "departments" && (item as Department).kind !== "OFFICE" && (item as Department).runsNights === false && <StatusBadge tone="neutral">No nights</StatusBadge>}
                        {kind.key === "cadres" && (item as Cadre).onRoster === false && <StatusBadge tone="neutral">Not on roster</StatusBadge>}
                        {kind.key === "cadres" && (item as Cadre).onRoster !== false && (item as Cadre).weekdaysOnly && <StatusBadge tone="neutral">Office hours</StatusBadge>}
                        {kind.key === "cadres" && (item as Cadre).onRoster !== false && !(item as Cadre).weekdaysOnly && (item as Cadre).takesNights === false && <StatusBadge tone="neutral">No nights</StatusBadge>}
                        {isAdmin && (
                          <>
                            {item.active && (
                              <Button variant="quiet" onClick={() => setEditingId(item.id)} aria-label={`Edit ${item.name}`}>
                                Edit
                              </Button>
                            )}
                            <Button
                              variant="quiet"
                              onClick={() => onToggle(item)}
                              disabled={busyId === item.id}
                              aria-label={`${item.active ? "Deactivate" : "Reactivate"} ${item.name}`}
                            >
                              {item.active ? "Deactivate" : "Reactivate"}
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Panel>
  );
}

export default function DepartmentsAndCadresPage() {
  return (
    <>
      <PageHeader
        title="Departments and cadres"
        description="Deactivate what you no longer use. Nothing is deleted."
      />
      <div className="space-y-6">
        <GroupSection kind={KINDS.departments} />
        <GroupSection kind={KINDS.cadres} />
      </div>
    </>
  );
}
