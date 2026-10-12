"use client";

import { FormEvent, useCallback, useState } from "react";
import { api } from "@/lib/api";
import { useSave } from "@/lib/useApi";
import type { CycleRule } from "@/lib/types";
import { Button, Checkbox, Field, Input, Notice, SaveStatus, Select } from "@/components/ui";
import { ShiftStrip, buildStrip } from "@/components/ShiftStrip";
import { PatternPreview } from "@/components/PatternPreview";

interface Lookups {
  shifts: { id: string; code: string; name: string; colour: string | null }[];
  cadres: { id: string; name: string }[];
  departments: { id: string; name: string }[];
}

export function CycleForm({ rule, lookups, onSaved, onCancel }: { rule: CycleRule | null; lookups: Lookups; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(rule?.name ?? "");
  const [n, setN] = useState(String(rule?.consecutiveDuties ?? 5));
  const [m, setM] = useState(String(rule?.offDaysRequired ?? 2));
  const [consecutive, setConsecutive] = useState(rule?.offDaysConsecutive ?? true);
  const [shiftIds, setShiftIds] = useState<string[]>(rule?.countingShiftIds ?? []);
  const [cadreIds, setCadreIds] = useState<string[]>(rule?.applicableCadreIds ?? []);
  const [deptIds, setDeptIds] = useState<string[]>(rule?.applicableDepartmentIds ?? []);
  const [enforcement, setEnforcement] = useState<"BLOCK" | "PREFER">(rule?.enforcement ?? "PREFER");
  const [priority, setPriority] = useState(rule ? String(rule.priority) : "");
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [afterRest, setAfterRest] = useState(rule?.nextShiftAfterRestId ?? "");
  const [pattern, setPattern] = useState<string[]>(rule?.blockShiftPatternIds ?? []);

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
      nextShiftAfterRestId: afterRest || null,
      blockShiftPatternIds: pattern.filter((id) => shiftIds.includes(id)),
      ...(priority ? { priority: Number(priority) } : {}),
      ...(switchingToBlock ? { confirmBlock } : {}),
    };
    return rule ? api.patch(`/api/facility/cycles/${rule.id}`, body) : api.post("/api/facility/cycles", body);
  }, [name, shiftIds, nNum, mNum, consecutive, cadreIds, deptIds, enforcement, afterRest, pattern, priority, switchingToBlock, confirmBlock, rule]);

  const save = useSave(submit);
  const e = save.fieldErrors;

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (await save.run()) onSaved();
  }

  const counting = lookups.shifts.filter((s) => shiftIds.includes(s.id));
  const livePattern = pattern.filter((id) => shiftIds.includes(id));
  const move = (i: number, by: number) => {
    const next = [...pattern];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setPattern(next);
  };
  const strip = buildStrip({ duties: nNum, off: mNum, pattern: livePattern, afterRest: afterRest || null });
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
      </div>

      <div>
        <p className="mb-1 text-sm font-medium">Pattern over 28 days</p>
        <PatternPreview duties={nNum} off={mNum} colour={colour} />
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Shifts that count toward the run</legend>
        <p className="text-sm text-[var(--muted)]">A run is broken by a day off, leave, or a duty not on this list.</p>
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

      <fieldset className="rounded-[var(--radius)] border border-[var(--border-strong)] p-4">
        <legend className="px-1 text-sm font-medium">Which shift comes when</legend>
        <p className="text-sm text-[var(--muted)]">
          Both settings are optional. The roster engine reads them when it builds a roster. Leave them empty and it picks any counted shift.
        </p>

        <div className="mt-4 max-w-sm">
          <Field label="After the days off, the first duty back is" optional hint="For example, after 4 nights and 3 days off, staff come back on Afternoon, never straight onto Morning." error={e.nextShiftAfterRestId}>
            {(a) => (
              <Select {...a} value={afterRest} onChange={(x) => setAfterRest(x.target.value)}>
                <option value="">Any shift</option>
                {lookups.shifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="mt-5">
          <p className="text-sm font-medium" id="order-label">
            Order of shifts inside a block
          </p>
          <p className="text-sm text-[var(--muted)]">
            Press a shift to add it as the next step. The order repeats until the block ends. For example Afternoon, Morning, Afternoon, Morning gives four duties, then the days off.
          </p>
          {counting.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--muted)]">Tick the shifts that count toward the run above, then build the order here.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Add a shift to the order">
              {counting.map((s) => (
                <Button key={s.id} variant="secondary" onClick={() => setPattern([...pattern, s.id])}>
                  Add {s.name}
                </Button>
              ))}
            </div>
          )}
          {livePattern.length > 0 && (
            <ol aria-labelledby="order-label" className="mt-3 max-w-md list-none space-y-1 p-0">
              {pattern.map((id, i) => {
                const s = lookups.shifts.find((x) => x.id === id);
                if (!s || !shiftIds.includes(id)) return null;
                return (
                  <li key={`${id}-${i}`} className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border-strong)] px-3 py-1.5">
                    <span className="figures w-14 text-sm text-[var(--muted)]">Duty {i + 1}</span>
                    <span className="flex-1 font-medium">{s.name}</span>
                    <Button variant="quiet" aria-label={`Move ${s.name}, duty ${i + 1}, up`} disabled={i === 0} onClick={() => move(i, -1)}>
                      Up
                    </Button>
                    <Button variant="quiet" aria-label={`Move ${s.name}, duty ${i + 1}, down`} disabled={i === pattern.length - 1} onClick={() => move(i, 1)}>
                      Down
                    </Button>
                    <Button variant="quiet" aria-label={`Remove ${s.name}, duty ${i + 1}`} onClick={() => setPattern(pattern.filter((_, k) => k !== i))}>
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ol>
          )}
          {livePattern.length > 0 && (
            <div className="mt-2">
              <Button variant="quiet" onClick={() => setPattern([])}>
                Clear the order
              </Button>
            </div>
          )}
          {e.blockShiftPatternIds && <p className="text-sm text-[var(--status-block)]">{e.blockShiftPatternIds}</p>}
        </div>

        <div className="mt-5">
          <p className="mb-1 text-sm font-medium">What the roster aims for, first 14 days</p>
          <ShiftStrip cells={strip} shifts={lookups.shifts} />
          <p className="mt-2 text-sm text-[var(--muted)]">
            {livePattern.length === 0 && !afterRest ? "No order set, so duty days show as Duty." : "Off marks a day off. The next block starts again from the first step."}
          </p>
        </div>
      </fieldset>

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
            <Notice tone="warning">Choose Block only if your facility would rather have an uncovered shift than an irregular roster.</Notice>
            <Checkbox label="We would rather leave a shift unfilled than break this pattern" checked={confirmBlock} onChange={setConfirmBlock} />
          </div>
        )}
      </fieldset>

      <div className="max-w-52">
        <Field label="Priority" optional hint="When two rules apply on the same duty, the lower number wins." error={e.priority}>
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
