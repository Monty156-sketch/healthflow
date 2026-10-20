"use client";

import { FormEvent, useCallback, useMemo, useState } from "react";
import { SHIFT_COLOURS } from "@healthflow/shared";
import { api } from "@/lib/api";
import { useSave } from "@/lib/useApi";
import type { Shift } from "@/lib/types";
import { Button, Checkbox, Field, Input, Notice, SaveStatus, Select } from "@/components/ui";

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The same rule the server applies, so a wrong overnight setting shows as you type. */
export function liveDuration(start: string, end: string, overnight: boolean): { hours: number | null; problem: string | null } {
  if (!TIME.test(start) || !TIME.test(end)) return { hours: null, problem: null };
  const diff = toMinutes(end) - toMinutes(start);
  if (overnight && diff >= 0) return { hours: null, problem: "Overnight shifts end the next morning, so the end time should be earlier than the start time. Untick overnight if this shift ends the same day." };
  if (!overnight && diff <= 0) return { hours: null, problem: "The end time is not after the start time. If this shift runs past midnight, tick overnight." };
  return { hours: (overnight ? diff + 1440 : diff) / 60, problem: null };
}

const hoursText = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(2).replace(/0+$/, "")} ${h === 1 ? "hour" : "hours"}`;

export function ShiftForm({
  shift,
  cadres,
  onSaved,
  onCancel,
}: {
  shift: Shift | null;
  cadres: { id: string; name: string }[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const isOff = shift ? !shift.countsAsDuty : false;
  const [name, setName] = useState(shift?.name ?? "");
  const [code, setCode] = useState(shift?.code ?? "");
  const [start, setStart] = useState(shift?.startTime ?? "");
  const [end, setEnd] = useState(shift?.endTime ?? "");
  const [overnight, setOvernight] = useState(shift?.isOvernight ?? false);
  const [onCall, setOnCall] = useState(shift?.isOnCall ?? false);
  const [factor, setFactor] = useState(String(shift?.onCallHoursFactor ?? 0));
  const [advice, setAdvice] = useState(shift?.onCallAdviceNote ?? "");
  const [minStaff, setMinStaff] = useState(String(shift?.minStaff ?? 0));
  const [weekendMin, setWeekendMin] = useState(shift?.weekendMinStaff == null ? "" : String(shift.weekendMinStaff));
  const [holidayMin, setHolidayMin] = useState(shift?.holidayMinStaff == null ? "" : String(shift.holidayMinStaff));
  const [keepFull, setKeepFull] = useState(String(shift?.keepFull ?? 0));
  const [minLeads, setMinLeads] = useState(String(shift?.minLeads ?? 0));
  const [minBy, setMinBy] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(shift?.minByCadre ?? {}).map(([k, v]) => [k, String(v)]))
  );
  const [eligible, setEligible] = useState<string[]>(shift?.eligibleCadreIds ?? []);
  const [colour, setColour] = useState(shift?.colour ?? SHIFT_COLOURS[0].value);

  const dur = useMemo(() => liveDuration(start, end, overnight), [start, end, overnight]);

  const submit = useCallback(async () => {
    const minByCadre: Record<string, number> = {};
    for (const [id, v] of Object.entries(minBy)) if (v.trim() !== "" && Number(v) > 0) minByCadre[id] = Number(v);
    const body = {
      name,
      code,
      startTime: start || null,
      endTime: end || null,
      isOvernight: overnight,
      isOnCall: onCall,
      onCallHoursFactor: onCall ? Number(factor) || 0 : 0,
      onCallAdviceNote: advice || null,
      minStaff: Number(minStaff),
      weekendMinStaff: weekendMin.trim() === "" ? null : Number(weekendMin),
      holidayMinStaff: holidayMin.trim() === "" ? null : Number(holidayMin),
      keepFull: Number(keepFull),
      minLeads: Number(minLeads) || 0,
      minByCadre,
      eligibleCadreIds: eligible,
      colour,
    };
    return shift ? api.patch(`/api/facility/shifts/${shift.id}`, body) : api.post("/api/facility/shifts", body);
  }, [name, code, start, end, overnight, onCall, factor, advice, minStaff, weekendMin, holidayMin, keepFull, minLeads, minBy, eligible, colour, shift]);

  const save = useSave(submit);
  const e = save.fieldErrors;

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (await save.run()) onSaved();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Field label="Name" error={e.name}>
          {(a) => <Input {...a} value={name} onChange={(x) => setName(x.target.value)} />}
        </Field>
        <Field label="Code" hint={isOff ? "Fixed." : "Up to 5 characters."} error={e.code}>
          {(a) => <Input {...a} className="figures uppercase" maxLength={5} value={code} disabled={isOff} onChange={(x) => setCode(x.target.value)} />}
        </Field>
      </div>

      {isOff ? (
        <p className="text-sm text-[var(--muted)]">Fills every blank on the roster. It has no hours.</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" error={e.startTime}>
              {(a) => <Input {...a} type="time" className="figures" value={start} onChange={(x) => setStart(x.target.value)} />}
            </Field>
            <Field label="Ends" error={e.endTime}>
              {(a) => <Input {...a} type="time" className="figures" value={end} onChange={(x) => setEnd(x.target.value)} />}
            </Field>
          </div>
          <Checkbox label="Overnight" hint="Ends the next morning, after midnight." checked={overnight} onChange={setOvernight} />
          <div aria-live="polite" className="min-h-6 text-[15px]">
            {dur.hours !== null && (
              <p>
                Duration: <span className="figures font-semibold">{hoursText(dur.hours)}</span>
              </p>
            )}
            {dur.problem && <Notice tone="warning">{dur.problem}</Notice>}
          </div>

          <div>
            <Checkbox label="On call" hint="Staff are available but not necessarily working." checked={onCall} onChange={setOnCall} />
            {onCall && (
              <div className="mt-2 space-y-3 border-l-2 border-[var(--border)] pl-4">
                <p className="text-sm text-[var(--muted)]">
                  Set only on legal advice, and record it.
                </p>
                <div className="max-w-40">
                  <Field label="Counts as" hint="0 to 1 of its hours" error={e.onCallHoursFactor}>
                    {(a) => <Input {...a} inputMode="decimal" className="figures" value={factor} onChange={(x) => setFactor(x.target.value)} />}
                  </Field>
                </div>
                {Number(factor) !== 0 && (
                  <Field label="The advice this is based on" error={e.onCallAdviceNote}>
                    {(a) => <Input {...a} value={advice} onChange={(x) => setAdvice(x.target.value)} />}
                  </Field>
                )}
              </div>
            )}
          </div>

          <fieldset>
            <legend className="text-sm font-medium">Minimum staff</legend>
            <div className="mt-1 grid max-w-xl gap-3 sm:grid-cols-3">
              <Field label="Monday to Friday" error={e.minStaff}>
                {(a) => <Input {...a} inputMode="numeric" className="figures" value={minStaff} onChange={(x) => setMinStaff(x.target.value)} />}
              </Field>
              <Field label="Saturday and Sunday" optional hint="Blank: same as weekdays" error={e.weekendMinStaff}>
                {(a) => <Input {...a} inputMode="numeric" className="figures" value={weekendMin} onChange={(x) => setWeekendMin(x.target.value)} />}
              </Field>
              <Field label="Public holidays" optional hint="Blank: same as weekends" error={e.holidayMinStaff}>
                {(a) => <Input {...a} inputMode="numeric" className="figures" value={holidayMin} onChange={(x) => setHolidayMin(x.target.value)} />}
              </Field>
            </div>
            <div className="mt-3 max-w-xs">
              <Field label="Of those, able to lead the shift" hint="People marked Can lead a shift on their record. 0 for no requirement." error={e.minLeads}>
                {(a) => <Input {...a} inputMode="numeric" className="figures" value={minLeads} onChange={(x) => setMinLeads(x.target.value)} />}
              </Field>
            </div>
            <div className="mt-3 max-w-md">
              <Field label="If there are not enough people" hint="Where a gap may fall when the month cannot be covered in full." error={e.keepFull}>
                {(a) => (
                  <Select {...a} value={keepFull} onChange={(x) => setKeepFull(x.target.value)}>
                    <option value="1">Keep this shift full first</option>
                    <option value="0">No preference</option>
                    <option value="-1">This shift may run short first</option>
                  </Select>
                )}
              </Field>
            </div>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Weekend and holiday duties are shared evenly.
            </p>
            {cadres.length > 0 && (
              <div className="mt-3">
                <p className="text-sm text-[var(--muted)]">Of those, at least this many from a cadre (leave blank for no minimum):</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {cadres.map((c) => (
                    <Field key={c.id} label={c.name}>
                      {(a) => (
                        <Input
                          {...a}
                          inputMode="numeric"
                          className="figures"
                          value={minBy[c.id] ?? ""}
                          onChange={(x) => setMinBy({ ...minBy, [c.id]: x.target.value })}
                        />
                      )}
                    </Field>
                  ))}
                </div>
                {e.minByCadre && <p className="mt-1 text-sm text-[var(--status-block)]">{e.minByCadre}</p>}
              </div>
            )}
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">Who can work this shift</legend>
            <p className="text-sm text-[var(--muted)]">Tick the cadres allowed. Tick none to allow every cadre.</p>
            <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
              {cadres.map((c) => (
                <Checkbox
                  key={c.id}
                  label={c.name}
                  checked={eligible.includes(c.id)}
                  onChange={(on) => setEligible(on ? [...eligible, c.id] : eligible.filter((x) => x !== c.id))}
                />
              ))}
            </div>
            {e.eligibleCadreIds && <p className="mt-1 text-sm text-[var(--status-block)]">{e.eligibleCadreIds}</p>}
          </fieldset>
        </>
      )}

      <fieldset>
        <legend className="text-sm font-medium">Colour on the roster</legend>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Colour on the roster">
          {SHIFT_COLOURS.map((c) => {
            const on = colour === c.value;
            return (
              <label
                key={c.value}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius)] border px-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ${
                  on ? "border-[var(--foreground)] font-medium" : "border-[var(--border-strong)]"
                }`}
              >
                <input type="radio" name="colour" className="sr-only" checked={on} onChange={() => setColour(c.value)} />
                <span aria-hidden="true" className="size-4 rounded-[3px]" style={{ background: c.value }} />
                {c.name}
              </label>
            );
          })}
        </div>
        {e.colour && <p className="mt-1 text-sm text-[var(--status-block)]">{e.colour}</p>}
      </fieldset>

      {save.state === "failed" && save.message && <Notice tone="block">{save.message}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={save.state === "saving" || dur.problem !== null}>
          {save.state === "saving" ? "Saving…" : shift ? "Save changes" : "Add shift"}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={save.state === "saving"}>
          Cancel
        </Button>
        <SaveStatus state={save.state} onRetry={save.retry} />
      </div>
    </form>
  );
}
