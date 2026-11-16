"use client";

// Clock devices: the administrator registers a machine the facility already has, gives each person their
// number on it, and imports its punches file. The punches become attendance (arrival, lateness, earliness).
import { FormEvent, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { Button, EmptyState, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, TD, TH, TableScroll, Textarea } from "@/components/ui";

interface Device { id: string; name: string; brand: string | null; model: string | null; serialNumber: string | null; ipAddress: string | null; notes: string | null; active: boolean; lastImportAt: string | null }
interface Person { id: string; fullName: string; staffNo: string; clockNumber: string | null }
interface Row { name: string; dutyDate: string; arrived: string; left: string | null; status: string; minutesLate: number | null; minutesEarly: number | null; action: "new" | "already_recorded" | "month_locked" }
interface Unknown { pin: string; count: number; name: string | null; department: string | null; suggestion: { staffId: string; fullName: string } | null }
interface Summary { punchesRead: number; unreadableLines: number; notOnStaffList: Unknown[]; punchesWithNoDuty: number; people: number; attendanceNew: number; alreadyRecorded: number; monthLocked: number; noCheckOut: number; checkOutWithoutCheckIn: number }
interface Result { applied: boolean; summary: Summary; rows: Row[]; toCheck: { name: string; date: string; time: string }[] }

const say = (e: unknown, fallback: string) => (e instanceof ApiError ? ((e.body as { message?: string } | undefined)?.message ?? fallback) : fallback);

function AddDevice({ onAdded }: { onAdded: () => void }) {
  const [f, setF] = useState({ name: "", brand: "", model: "", serialNumber: "", ipAddress: "", notes: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function add(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api.post("/api/facility/clock-devices", f);
      setF({ name: "", brand: "", model: "", serialNumber: "", ipAddress: "", notes: "" });
      onAdded();
    } catch (x) { setErr(say(x, "It was not saved. Check the name and try again.")); }
  }
  return (
    <Panel title="Add a clock device" description="Any machine the facility already uses to clock staff in and out.">
      <form onSubmit={add} noValidate className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">{(a) => <Input {...a} placeholder="Main gate clock" value={f.name} onChange={set("name")} />}</Field>
        <Field label="Brand">{(a) => <Input {...a} placeholder="ZKTeco" value={f.brand} onChange={set("brand")} />}</Field>
        <Field label="Model">{(a) => <Input {...a} value={f.model} onChange={set("model")} />}</Field>
        <Field label="Serial number">{(a) => <Input {...a} value={f.serialNumber} onChange={set("serialNumber")} />}</Field>
        <Field label="IP address on the facility network (optional)">{(a) => <Input {...a} placeholder="192.168.1.201" value={f.ipAddress} onChange={set("ipAddress")} />}</Field>
        <Field label="Notes">{(a) => <Input {...a} value={f.notes} onChange={set("notes")} />}</Field>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          <Button type="submit">Add device</Button>
          {err && <span className="text-sm text-[var(--danger,#b42318)]">{err}</span>}
        </div>
      </form>
    </Panel>
  );
}

function Numbers() {
  const { data, error, reload } = useResource<{ staff: Person[] }>("/api/facility/clock-devices/people");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading staff" />;
  const value = (p: Person) => edits[p.id] ?? p.clockNumber ?? "";
  async function save() {
    const numbers = data!.staff.filter((p) => edits[p.id] !== undefined && edits[p.id] !== (p.clockNumber ?? "")).map((p) => ({ staffId: p.id, clockNumber: edits[p.id].trim() || null }));
    if (!numbers.length) return setMsg({ tone: "warning", text: "Nothing has changed." });
    try {
      await api.put("/api/facility/clock-devices/people", { numbers });
      setEdits({});
      setMsg({ tone: "success", text: "Saved." });
      reload();
    } catch (x) { setMsg({ tone: "warning", text: say(x, "It was not saved. Try again.") }); }
  }
  return (
    <Panel title="Each person's number on the machine" description="Type the number (user ID) each person has on the clock. This is how punches are matched to people.">
      <TableScroll label="Staff clock numbers">
        <table className="w-full text-sm">
          <thead><tr><th className={TH}>Name</th><th className={TH}>Staff number</th><th className={TH}>Number on the machine</th></tr></thead>
          <tbody>
            {data.staff.map((p) => (
              <tr key={p.id}>
                <td className={TD}>{p.fullName}</td>
                <td className={TD}>{p.staffNo}</td>
                <td className={TD}><Input aria-label={`Clock number for ${p.fullName}`} className="max-w-[8rem]" value={value(p)} onChange={(e) => setEdits({ ...edits, [p.id]: e.target.value })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={save}>Save numbers</Button>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </div>
    </Panel>
  );
}

function ImportPunches({ device, onDone }: { device: Device; onDone: () => void }) {
  const [text, setText] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(apply: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<Result>(`/api/facility/clock-devices/${device.id}/import`, { text, apply });
      setRes(r);
      if (apply) onDone();
    } catch (x) { setErr(say(x, "That could not be read. Check the file and try again.")); } finally { setBusy(false); }
  }
  async function pick(file: File | undefined) {
    if (!file) return;
    setRes(null);
    setText(await file.text());
  }
  const s = res?.summary;
  async function useSuggestions() {
    setBusy(true);
    setErr(null);
    try {
      const numbers = res!.summary.notOnStaffList.filter((u) => u.suggestion).map((u) => ({ staffId: u.suggestion!.staffId, clockNumber: u.pin }));
      await api.put("/api/facility/clock-devices/people", { numbers });
      await run(false);
    } catch (x) { setErr(say(x, "The numbers were not saved.")); } finally { setBusy(false); }
  }
  return (
    <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
      <p className="text-sm text-[var(--muted)]">In ZKBio Time, open the Transaction report, set the dates, and export it as CSV or Excel saved as CSV. Then choose that file here. (The machine\u2019s own USB file also works.) A month at a time works.</p>
      <input type="file" accept=".dat,.txt,.csv,.log" aria-label="Punches file" onChange={(e) => pick(e.target.files?.[0])} />
      <Field label="Or paste the punches here">{(a) => <Textarea {...a} rows={4} value={text} onChange={(e) => { setText(e.target.value); setRes(null); }} />}</Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy || !text.trim()} onClick={() => run(false)}>Check the file</Button>
        <Button disabled={busy || !res || res.applied || s?.attendanceNew === 0} onClick={() => run(true)}>Import into attendance</Button>
      </div>
      {err && <Notice tone="warning">{err}</Notice>}
      {s && (
        <div className="space-y-3">
          <Notice tone={res!.applied ? "success" : "warning"}>
            {res!.applied ? `Done. ${s.attendanceNew} attendance records were made.` : `${s.attendanceNew} new attendance records will be made.`} {s.punchesRead} punches read for {s.people} people.
            {s.alreadyRecorded > 0 && ` ${s.alreadyRecorded} days were already recorded and are left as they are.`}
            {s.monthLocked > 0 && ` ${s.monthLocked} days are in an approved month and were not changed.`}
            {s.punchesWithNoDuty > 0 && ` ${s.punchesWithNoDuty} punches had no published duty to match.`}
            {s.unreadableLines > 0 && ` ${s.unreadableLines} lines could not be read.`}
          </Notice>
          {s.notOnStaffList.length > 0 && (
            <div className="space-y-2">
              <Notice tone="warning">These people in the file are not matched to anyone yet. Matching uses the employee ID, so confirm each match, then check the file again.</Notice>
              <TableScroll label="People not matched">
                <table className="w-full text-sm">
                  <thead><tr><th className={TH}>ID in the file</th><th className={TH}>Name in the file</th><th className={TH}>Punches</th><th className={TH}>Suggested staff</th></tr></thead>
                  <tbody>
                    {s.notOnStaffList.slice(0, 200).map((u) => (
                      <tr key={u.pin}><td className={TD}>{u.pin}</td><td className={TD}>{u.name ?? "-"}{u.department ? ` (${u.department})` : ""}</td><td className={TD}>{u.count}</td><td className={TD}>{u.suggestion?.fullName ?? "No match by name"}</td></tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
              {s.notOnStaffList.some((u) => u.suggestion) && (
                <Button variant="secondary" disabled={busy} onClick={useSuggestions}>Use the {s.notOnStaffList.filter((u) => u.suggestion).length} suggested matches</Button>
              )}
            </div>
          )}
          {(s.noCheckOut > 0 || s.checkOutWithoutCheckIn > 0) && (
            <Notice tone="warning">
              {s.noCheckOut > 0 && `${s.noCheckOut} days have a check-in but no check-out; they are recorded as present with no departure time. `}
              {s.checkOutWithoutCheckIn > 0 && `${s.checkOutWithoutCheckIn} check-outs have no check-in, so we cannot tell when the person arrived. They are not recorded; the in-charge can mark those days. `}
            </Notice>
          )}
          {res!.toCheck.length > 0 && (
            <details className="text-sm"><summary className="cursor-pointer font-medium">Check-outs with no check-in ({res!.toCheck.length})</summary>
              <ul className="mt-2 list-disc pl-5">{res!.toCheck.map((c, i) => <li key={i}>{c.name}, {c.date} at {c.time}</li>)}</ul>
            </details>
          )}
          {res!.rows.length > 0 && (
            <TableScroll label="Attendance from the punches">
              <table className="w-full text-sm">
                <thead><tr><th className={TH}>Name</th><th className={TH}>Date</th><th className={TH}>Arrived</th><th className={TH}>Left</th><th className={TH}>Result</th></tr></thead>
                <tbody>
                  {res!.rows.map((r, i) => (
                    <tr key={i}>
                      <td className={TD}>{r.name}</td><td className={TD}>{r.dutyDate}</td><td className={TD}>{r.arrived}</td><td className={TD}>{r.left ?? "-"}</td>
                      <td className={TD}>
                        {r.action === "already_recorded" ? "Already recorded" : r.action === "month_locked" ? "Month approved" : r.status === "LATE" ? `Late, ${r.minutesLate} min` : r.minutesLate ? `Present, ${r.minutesLate} min late` : r.minutesEarly ? `Present, ${r.minutesEarly} min early` : "Present"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </div>
      )}
    </div>
  );
}

function DeviceCard({ d, onChanged }: { d: Device; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">{d.name}{!d.active && " (off)"}</p>
          <p className="text-sm text-[var(--muted)]">{[d.brand, d.model, d.serialNumber && `Serial ${d.serialNumber}`, d.ipAddress && `IP ${d.ipAddress}`].filter(Boolean).join(" · ") || "No details yet"}</p>
          <p className="text-sm text-[var(--muted)]">{d.lastImportAt ? `Last import ${d.lastImportAt.slice(0, 10)}` : "Nothing imported yet"}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setOpen(!open)}>{open ? "Close" : "Import punches"}</Button>
          {confirm ? (
            <Button variant="secondary" onClick={async () => { await api.delete(`/api/facility/clock-devices/${d.id}`); onChanged(); }}>Yes, remove</Button>
          ) : (
            <Button variant="secondary" onClick={() => setConfirm(true)}>Remove</Button>
          )}
        </div>
      </div>
      {open && <ImportPunches device={d} onDone={onChanged} />}
    </li>
  );
}

export default function ClockDevicesPage() {
  const { data, error, reload } = useResource<{ devices: Device[]; numbered: number; total: number }>("/api/facility/clock-devices");
  return (
    <>
      <PageHeader title="Clock devices" description="Use the clocking machine your facility already has. Its punches become attendance here, and phone clock-in keeps working for anyone not on the machine." />
      {error && !data ? <LoadError onRetry={reload} /> : !data ? <Loading label="Loading devices" /> : (
        <div className="space-y-6">
          <Panel title="Your devices" description={`${data.numbered} of ${data.total} staff have a number on the machine.`}>
            {data.devices.length === 0 ? (
              <EmptyState title="No clock device yet">Add the machine below.</EmptyState>
            ) : (
              <ul className="divide-y divide-[var(--border)]">{data.devices.map((d) => <DeviceCard key={d.id} d={d} onChanged={reload} />)}</ul>
            )}
          </Panel>
          <AddDevice onAdded={reload} />
          <Numbers />
        </div>
      )}
    </>
  );
}
