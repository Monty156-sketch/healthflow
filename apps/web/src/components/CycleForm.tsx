"use client";

import { FormEvent, useCallback, useState } from "react";
import { api } from "@/lib/api";
import { useSave } from "@/lib/useApi";
import type { CycleRule } from "@/lib/types";
import { Button, Checkbox, Field, Input, Notice, SaveStatus } from "@/components/ui";
import { PatternPreview } from "@/components/PatternPreview";

interface Lookups {
  shifts: { id: string; code: string; name: string; colour: string | null; isOvernight?: boolean }[];
  cadres: { id: string; name: string }[];
  departments: { id: string; name: string }[];
}

export function CycleForm({ rule, kind, lookups, onSaved, onCancel }: { rule: CycleRule | null; kind?: "NIGHT" | "DAY" | null; lookups: Lookups; onSaved: () => void; onCancel: () => void }) {
  // A new night or day rule starts with the right shifts ticked and the usual numbers; a saved rule keeps its own.
  const preset = !rule && kind ? lookups.shifts.filter((s) => (kind === "NIGHT" ? s.isOvernight : !s.isOvernight)) : [];
  const [name, setName] = useState(rule?.name ?? (kind === "NIGHT" ? "4 nights on, 3 off" : kind === "DAY" ? "4 days on, 2 off" : ""));
  const [n, setN] = useState(String(rule?.consecutiveDuties ?? (kind ? 4 : 5)));
  const [m, setM] = useState(String(rule?.offDaysRequired ?? (kind === "NIGHT" ? 3 : 2)));
  const [consecutive, setConsecutive] = useState(rule?.offDaysConsecutive ?? true);
  const [shiftIds, setShiftIds] = useState<string[]>(rule?.countingShiftIds ?? preset.map((s) => s.id));
  const [cadreIds, setCadreIds] = useState<string[]>(rule?.applicableCadreIds ?? []);
  const [deptIds, setDeptIds] = useState<string[]>(rule?.applicableDepartmentIds ?? []);
  const [enforcement, setEnforcement] = useState<"BLOCK" | "PREFER">(rule?.enforcement ?? "PREFER");
  const [priority, setPriority] = useState(rule ? String(rule.priority) : "");
  const [confirmBlock, setConfirmBlock] = useState(false);

  const nNum = Number(n);
  const mNum = Number(m);
  const colour = lookups.shifts.find((s) => shiftIds.includes(s.id))?.colour ?? "#25619f";
  const switchingToBlock = enforcement === "BLOCK" && rule?.enforcement !== "BLOCK";

  const submit = useCallback(async () => {
    const body = {
      name,
      countingShiftIds: shiftIds,
      consecutiveDuties: nNum,
      offDaysRequired: mNum,
      offDaysConsecutive: consecutive,
      applicableCadreIds: cadreIds,
      applicableDepartmentIds: deptIds,
      enforcement,
      nextShiftAfterRestId: null,
      blockShiftPatternIds: [],
      ...(priority ? { priority: Number(priority) } : {}),
      ...(switchingToBlock ? { confirmBlock } : {}),
    };
    return rule ? api.patch(`/api/facility/cycles/${rule.id}`, body) : api.post("/api/facility/cycles", body);
  }, [name, shiftIds, nNum, mNum, consecutive, cadreIds, deptIds, enforcement, priority, switchingToBlock, confirmBlock, rule]);

  const save = useSave(submit);
  const e = save.fieldErrors;

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (await save.run()) onSaved();
  }

  const toggle = (list: string[], set: (v: string[]) => void, id: string, on: boolean) => set(on ? [...list, id] : list.filter((x) => x !== id));

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <Field label="Name" error={e.name}>
        {(a) => <Input {...a} value={name} onChange={(x) => setName(x.target.value)} />}
      </Field>

      <div>
        <p className="text-sm font-medium" id="sentence-label">
          The rule
        </p>
        <div role="group" aria-labelledby="sentence-label" className="mt-1 flex flex-wrap items-center gap-2 text-[17px]">
          <span>After</span>
          <Input aria-label="Number of consecutive duties" inputMode="numeric" className="figures !w-16 text-center" value={n} onChange={(x) => setN(x.target.value)} aria-invalid={Boolean(e.consecutiveDuties)} />
          <span>consecutive duties, give</span>
          <Input aria-label="Number of days off" inputMode="numeric" className="figures !w-16 text-center" value={m} onChange={(x) => setM(x.target.value)} aria-invalid={Boolean(e.offDaysRequired)} />
          <span>days off</span>
        </div>
        {(e.consecutiveDuties || e.offDaysRequired) && <p className="mt-1 text-sm text-[var(--status-block)]">{e.consecutiveDuties ?? e.offDaysRequired}</p>}
        <div className="mt-2">
          <Checkbox label="The days off must be consecutive" checked={consecutive} onChange={setConsecutive} />
        </div>
        <p className="mt-2 text-sm text-[var(--muted)]">Which shift comes next is set in Rotation order.</p>
      </div>

      <div>
        <p className="mb-1 text-sm font-medium">Pattern over 28 days</p>
        <PatternPreview duties={nNum} off={mNum} colour={colour} />
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Shifts that count toward the run</legend>
        <p className="text-sm text-[var(--muted)]">A day off or leave ends a run.</p>
        <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
          {lookups.shifts.map((s) => (
            <Checkbox key={s.id} label={`${s.name} (${s.code})`} checked={shiftIds.includes(s.id)} onChange={(on) => toggle(shiftIds, setShiftIds, s.id, on)} />
          ))}
        </div>
        {e.countingShiftIds && <p className="text-sm text-[var(--status-block)]">{e.countingShiftIds}</p>}
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <fieldset>
          <legend className="text-sm font-medium">Applies to cadres</legend>
          <p className="text-sm text-[var(--muted)]">Tick none to apply to every cadre.</p>
          {lookups.cadres.map((c) => (
            <Checkbox key={c.id} label={c.name} checked={cadreIds.includes(c.id)} onChange={(on) => toggle(cadreIds, setCadreIds, c.id, on)} />
          ))}
          {e.applicableCadreIds && <p className="text-sm text-[var(--status-block)]">{e.applicableCadreIds}</p>}
        </fieldset>
        <fieldset>
          <legend className="text-sm font-medium">Applies to departments</legend>
          <p className="text-sm text-[var(--muted)]">Tick none to apply to every department.</p>
          {lookups.departments.map((d) => (
            <Checkbox key={d.id} label={d.name} checked={deptIds.includes(d.id)} onChange={(on) => toggle(deptIds, setDeptIds, d.id, on)} />
          ))}
          {e.applicableDepartmentIds && <p className="text-sm text-[var(--status-block)]">{e.applicableDepartmentIds}</p>}
        </fieldset>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">When coverage is short</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="When coverage is short">
          {(
            [
              ["PREFER", "Prefer", "The roster tries to give the off days, but breaks the pattern rather than leave a shift short."],
              ["BLOCK", "Block", "The off days are mandatory. In a thin month the roster leaves a shift unfilled rather than break the pattern."],
            ] as const
          ).map(([value, title, text]) => (
            <label
              key={value}
              className={`flex cursor-pointer gap-3 rounded-[var(--radius)] border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ${
                enforcement === value ? "border-[var(--foreground)]" : "border-[var(--border-strong)]"
              }`}
            >
              <input type="radio" name="enforcement" className="mt-1 size-5 accent-[var(--accent)]" checked={enforcement === value} onChange={() => setEnforcement(value)} />
              <span>
                <span className="block font-medium">{title}</span>
                <span className="block text-sm text-[var(--muted)]">{text}</span>
              </span>
            </label>
          ))}
        </div>
        {switchingToBlock && (
          <div className="mt-3 space-y-2">
            <Notice tone="warning">Block leaves a shift empty rather than break the rule.</Notice>
            <Checkbox label="Never break this pattern" checked={confirmBlock} onChange={setConfirmBlock} />
          </div>
        )}
      </fieldset>

      <div className="max-w-52">
        <Field label="Priority" optional hint="Lower number wins." error={e.priority}>
          {(a) => <Input {...a} inputMode="numeric" className="figures" value={priority} onChange={(x) => setPriority(x.target.value)} />}
        </Field>
      </div>

      {save.state === "failed" && save.message && <Notice tone="block">{save.message}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={save.state === "saving" || (switchingToBlock && !confirmBlock)}>
          {save.state === "saving" ? "Saving…" : rule ? "Save changes" : "Add rule"}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={save.state === "saving"}>
          Cancel
        </Button>
        <SaveStatus state={save.state} onRetry={save.retry} />
      </div>
    </form>
  );
}
