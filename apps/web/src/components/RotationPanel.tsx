"use client";

import { FormEvent, useCallback, useState } from "react";
import { useFacility } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useResource, useSave } from "@/lib/useApi";
import { Button, Checkbox, ConfirmDialog, EmptyState, Field, Input, Loading, LoadError, Notice, Panel, SaveStatus, StatusBadge } from "@/components/ui";

interface Rotation {
  id: string;
  name: string;
  sequenceShiftIds: string[];
  applicableCadreIds: string[];
  applicableDepartmentIds: string[];
  enforcement: "BLOCK" | "PREFER";
  active: boolean;
}
interface Lookups {
  shifts: { id: string; code: string; name: string; colour: string | null }[];
  cadres: { id: string; name: string }[];
  departments: { id: string; name: string }[];
}
type Data = Lookups & { rotations: Rotation[] };

/** "After their rest, staff come back on Afternoon, then move to Morning." */
function sentence(names: string[]) {
  if (names.length < 2) return "";
  const [first, second, ...rest] = names;
  return `After a rest, staff come back on ${names[1]}${names.length > 2 ? `, then move to ${names[2]}` : ""}. The order runs ${[first, second, ...rest, first].join(", then ")}, and round again.`;
}

function Order({ ids, shifts }: { ids: string[]; shifts: Lookups["shifts"] }) {
  return (
    <ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0" aria-label={ids.map((id) => shifts.find((s) => s.id === id)?.name ?? "a shift").join(", then ")}>
      {ids.map((id, i) => {
        const s = shifts.find((x) => x.id === id);
        return (
          <li key={`${id}-${i}`} className="flex items-center gap-2">
            <span className="rounded-[var(--radius)] px-3 py-1.5 text-sm font-semibold text-white" style={{ background: s?.colour ?? "#5b6770" }}>
              {s?.code ?? "?"} <span className="font-normal opacity-90">{s?.name}</span>
            </span>
            <span aria-hidden="true" className="text-[var(--muted)]">
              {i < ids.length - 1 ? "then" : "and round again"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function RotationForm({ rotation, lookups, onSaved, onCancel }: { rotation: Rotation | null; lookups: Lookups; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(rotation?.name ?? "");
  const [order, setOrder] = useState<string[]>(rotation?.sequenceShiftIds ?? []);
  const [cadreIds, setCadreIds] = useState<string[]>(rotation?.applicableCadreIds ?? []);
  const [deptIds, setDeptIds] = useState<string[]>(rotation?.applicableDepartmentIds ?? []);
  const [enforcement, setEnforcement] = useState<"BLOCK" | "PREFER">(rotation?.enforcement ?? "PREFER");
  const [confirmBlock, setConfirmBlock] = useState(false);
  const switchingToBlock = enforcement === "BLOCK" && rotation?.enforcement !== "BLOCK";

  const submit = useCallback(async () => {
    const body = {
      name,
      sequenceShiftIds: order,
      applicableCadreIds: cadreIds,
      applicableDepartmentIds: deptIds,
      enforcement,
      ...(switchingToBlock ? { confirmBlock } : {}),
    };
    return rotation ? api.patch(`/api/facility/rotations/${rotation.id}`, body) : api.post("/api/facility/rotations", body);
  }, [name, order, cadreIds, deptIds, enforcement, switchingToBlock, confirmBlock, rotation]);
  const save = useSave(submit);
  const e = save.fieldErrors;

  const move = (i: number, by: number) => {
    const next = [...order];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };
  const toggle = (list: string[], set: (v: string[]) => void, id: string, on: boolean) => set(on ? [...list, id] : list.filter((x) => x !== id));
  const available = lookups.shifts.filter((s) => !order.includes(s.id));
  const names = order.map((id) => lookups.shifts.find((s) => s.id === id)?.name ?? "a shift");

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (await save.run()) onSaved();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <Field label="Name" error={e.name}>
        {(a) => <Input {...a} value={name} onChange={(x) => setName(x.target.value)} />}
      </Field>

      <div>
        <p className="text-sm font-medium" id="rot-order">
          Order of shifts
        </p>
        <p className="text-sm text-[var(--muted)]">Add the shifts in the order your staff move through them. After the last one it starts again from the first.</p>
        {available.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Add a shift to the order">
            {available.map((s) => (
              <Button key={s.id} variant="secondary" onClick={() => setOrder([...order, s.id])}>
                Add {s.name}
              </Button>
            ))}
          </div>
        )}
        {order.length > 0 && (
          <ol aria-labelledby="rot-order" className="mt-3 max-w-md list-none space-y-1 p-0">
            {order.map((id, i) => {
              const s = lookups.shifts.find((x) => x.id === id);
              return (
                <li key={id} className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border-strong)] px-3 py-1.5">
                  <span className="figures w-14 text-sm text-[var(--muted)]">Step {i + 1}</span>
                  <span className="flex-1 font-medium">{s?.name ?? "A shift"}</span>
                  <Button variant="quiet" aria-label={`Move ${s?.name}, step ${i + 1}, up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    Up
                  </Button>
                  <Button variant="quiet" aria-label={`Move ${s?.name}, step ${i + 1}, down`} disabled={i === order.length - 1} onClick={() => move(i, 1)}>
                    Down
                  </Button>
                  <Button variant="quiet" aria-label={`Remove ${s?.name}, step ${i + 1}`} onClick={() => setOrder(order.filter((_, k) => k !== i))}>
                    Remove
                  </Button>
                </li>
              );
            })}
          </ol>
        )}
        {e.sequenceShiftIds && <p className="mt-1 text-sm text-[var(--status-block)]">{e.sequenceShiftIds}</p>}
        {order.length > 1 && (
          <div className="mt-3">
            <Order ids={order} shifts={lookups.shifts} />
            <p className="mt-2 text-sm text-[var(--muted)]">{sentence(names)}</p>
          </div>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <fieldset>
          <legend className="text-sm font-medium">Applies to cadres</legend>
          <p className="text-sm text-[var(--muted)]">Tick none to apply to every cadre.</p>
          {lookups.cadres.map((c) => (
            <Checkbox key={c.id} label={c.name} checked={cadreIds.includes(c.id)} onChange={(on) => toggle(cadreIds, setCadreIds, c.id, on)} />
          ))}
        </fieldset>
        <fieldset>
          <legend className="text-sm font-medium">Applies to departments</legend>
          <p className="text-sm text-[var(--muted)]">Tick none to apply to every department.</p>
          {lookups.departments.map((d) => (
            <Checkbox key={d.id} label={d.name} checked={deptIds.includes(d.id)} onChange={(on) => toggle(deptIds, setDeptIds, d.id, on)} />
          ))}
        </fieldset>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">How firmly the roster follows it</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="How firmly the roster follows the order">
          {(
            [
              ["PREFER", "Prefer", "The roster leans toward the order when it brings people back from a rest, but fairness and cover come first."],
              ["BLOCK", "Block", "Nobody comes back from a rest on a shift out of the order. In a thin month a shift may be left unfilled."],
            ] as const
          ).map(([value, title, text]) => (
            <label
              key={value}
              className={`flex cursor-pointer gap-3 rounded-[var(--radius)] border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ${
                enforcement === value ? "border-[var(--foreground)]" : "border-[var(--border-strong)]"
              }`}
            >
              <input type="radio" name="rot-enforcement" className="mt-1 size-5 accent-[var(--accent)]" checked={enforcement === value} onChange={() => setEnforcement(value)} />
              <span>
                <span className="block font-medium">{title}</span>
                <span className="block text-sm text-[var(--muted)]">{text}</span>
              </span>
            </label>
          ))}
        </div>
        {switchingToBlock && (
          <div className="mt-3 space-y-2">
            <Notice tone="warning">Choose Block only if your facility would rather have an uncovered shift than a break in the order.</Notice>
            <Checkbox label="We would rather leave a shift unfilled than break the order" checked={confirmBlock} onChange={setConfirmBlock} />
          </div>
        )}
      </fieldset>

      {save.state === "failed" && save.message && <Notice tone="block">{save.message}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={save.state === "saving" || (switchingToBlock && !confirmBlock)}>
          {save.state === "saving" ? "Saving…" : rotation ? "Save changes" : "Add rotation"}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={save.state === "saving"}>
          Cancel
        </Button>
        <SaveStatus state={save.state} onRetry={save.retry} />
      </div>
    </form>
  );
}

export function RotationPanel() {
  const { isAdmin } = useFacility();
  const { data, error, reload } = useResource<Data>("/api/facility/rotations");
  const [editing, setEditing] = useState<Rotation | "new" | null>(null);
  const [deleting, setDeleting] = useState<Rotation | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading the rotation order" />;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setProblem(null);
    try {
      await fn();
      reload();
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { message?: string }) : undefined;
      setProblem(body?.message ?? "This could not be changed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[65ch] text-[var(--muted)]">
          The order shifts follow one another, for example Night, then Afternoon, then Morning. After a rest the roster brings people back in this order, so nobody goes from nights straight onto a morning.
        </p>
        {isAdmin && editing === null && data.shifts.length > 1 && <Button onClick={() => setEditing("new")}>Add rotation</Button>}
      </div>
      {problem && <Notice tone="block">{problem}</Notice>}

      {editing !== null && (
        <Panel title={editing === "new" ? "Add a rotation" : `Edit ${editing.name}`}>
          <RotationForm
            key={editing === "new" ? "new" : editing.id}
            rotation={editing === "new" ? null : editing}
            lookups={data}
            onSaved={() => {
              setEditing(null);
              reload();
            }}
            onCancel={() => setEditing(null)}
          />
        </Panel>
      )}

      {data.rotations.length === 0 && editing === null ? (
        <EmptyState title="No rotation order yet">
          {data.shifts.length < 2 ? "Add at least two duty shifts first, then set the order they follow." : "Add a rotation to set the order shifts follow after a rest."}
        </EmptyState>
      ) : (
        <ul className="space-y-4">
          {data.rotations.map((r) => (
            <li key={r.id} className={r.active ? "" : "opacity-70"}>
              <Panel
                title={r.name}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={r.enforcement === "BLOCK" ? "warning" : "neutral"}>{r.enforcement === "BLOCK" ? "Block" : "Prefer"}</StatusBadge>
                    {!r.active && <StatusBadge tone="neutral">Off</StatusBadge>}
                  </div>
                }
              >
                <Order ids={r.sequenceShiftIds} shifts={data.shifts} />
                <p className="mt-3 text-[15px]">{sentence(r.sequenceShiftIds.map((id) => data.shifts.find((s) => s.id === id)?.name ?? "a shift"))}</p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Applies to {r.applicableCadreIds.length ? r.applicableCadreIds.map((id) => data.cadres.find((c) => c.id === id)?.name).filter(Boolean).join(", ") : "all cadres"} in{" "}
                  {r.applicableDepartmentIds.length ? r.applicableDepartmentIds.map((id) => data.departments.find((d) => d.id === id)?.name).filter(Boolean).join(", ") : "all departments"}.
                </p>
                {isAdmin && editing === null && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setEditing(r)}>
                      Edit
                    </Button>
                    <Button variant="quiet" disabled={busy} onClick={() => run(() => api.patch(`/api/facility/rotations/${r.id}/active`, { active: !r.active }))}>
                      {r.active ? "Turn off" : "Turn on"}
                    </Button>
                    <Button variant="quiet" disabled={busy} onClick={() => setDeleting(r)}>
                      Delete
                    </Button>
                  </div>
                )}
              </Panel>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? "this rotation"}?`}
        confirmLabel="Delete rotation"
        tone="danger"
        busy={busy}
        onConfirm={async () => {
          const d = deleting;
          setDeleting(null);
          if (d) await run(() => api.delete(`/api/facility/rotations/${d.id}`));
        }}
        onCancel={() => setDeleting(null)}
      >
        The roster will no longer follow this order, and it will not be set up again. Past rosters are not changed.
      </ConfirmDialog>
    </div>
  );
}
