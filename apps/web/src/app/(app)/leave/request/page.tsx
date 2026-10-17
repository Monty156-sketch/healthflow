"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFacility } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import type { LeaveBalance, LeaveTypeLite } from "@/lib/types";
import { Button, Checkbox, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Select, Textarea } from "@/components/ui";

interface Preview {
  days: number | null;
  basis?: string;
  skippedHolidays?: number;
  note?: string | null;
  balance?: (LeaveBalance & { after: number | null }) | null;
}

export default function RequestLeavePage() {
  const router = useRouter();
  const facility = useFacility();
  const { data, error, reload } = useResource<{ note: string; types: LeaveTypeLite[]; people: { id: string; name: string }[]; myStaffId: string | null }>("/api/facility/leave/types");
  const [staffId, setStaffId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [openEnded, setOpenEnded] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!typeId || !start || !end) return;
    let live = true;
    const q = new URLSearchParams({ leaveTypeId: typeId, startDate: start, endDate: end, ...(staffId ? { staffId } : {}) });
    api.get<Preview>(`/api/facility/leave/preview?${q}`).then((p) => live && setPreview(p)).catch(() => live && setPreview(null));
    return () => {
      live = false;
    };
  }, [typeId, start, end, staffId]);

  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading" />;
  const decider = data.people.length > 0;
  const chosen = data.types.find((t) => t.id === typeId);
  const canOpen = chosen?.returnDateSetBy === "STAFF_CONFIRMS";
  const open = canOpen && openEnded;
  const ready = Boolean(typeId && start && (end || open));
  const shown = ready ? preview : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFields({});
    setProblem(null);
    try {
      await api.post("/api/facility/leave/requests", { ...(staffId ? { staffId } : {}), leaveTypeId: typeId, startDate: start, endDate: open ? start : end, reason, ...(open ? { openEnded: true } : {}) });
      router.push("/leave");
    } catch (err) {
      const b = err instanceof ApiError ? (err.body as { message?: string; fields?: Record<string, string> }) : undefined;
      if (b?.fields) setFields(b.fields);
      else setProblem(b?.message ?? "The request was not sent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Request leave" description={facility.me.role === "STAFF" ? "Your in-charge decides. You will see the answer under My leave." : "Ask for leave for yourself, or for a member of staff who asked you."} />
      <form onSubmit={submit} noValidate className="max-w-xl space-y-4">
        {decider && (
          <Field label="For" optional hint="Leave empty to ask for your own leave.">
            {(a) => (
              <Select {...a} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                <option value="">Myself</option>
                {data.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Type of leave" error={fields.leaveTypeId}>
          {(a) => (
            <Select {...a} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              <option value="">Choose a type</option>
              {data.types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First day" error={fields.startDate}>
            {(a) => <Input {...a} type="date" value={start} onChange={(e) => { setStart(e.target.value); if (!end || end < e.target.value) setEnd(e.target.value); }} />}
          </Field>
          {!open && (
            <Field label="Last day" error={fields.endDate}>
              {(a) => <Input {...a} type="date" min={start || undefined} value={end} onChange={(e) => setEnd(e.target.value)} />}
            </Field>
          )}
        </div>
        {canOpen && (
          <div>
            <Checkbox label="I do not know when I will be back" checked={openEnded} onChange={setOpenEnded} />
            <p className="mt-1 text-sm text-[var(--muted)]">You will stay off the roster until you or your in-charge confirm the day you are back.</p>
            {fields.openEnded && <div className="mt-2"><Notice tone="block">{fields.openEnded}</Notice></div>}
          </div>
        )}
        <Field label="Reason" optional hint="Keep it operational. Do not write a diagnosis or symptoms." error={fields.reason}>
          {(a) => <Textarea {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>

        {shown && shown.days !== null && !open && (
          <Panel title="What this takes">
            <p className="figures text-[15px]" aria-live="polite">
              {shown.days} {shown.days === 1 ? "day" : "days"}, {showDate(start)}
              {start !== end ? ` to ${showDate(end)}` : ""}.
              {shown.skippedHolidays ? ` ${shown.skippedHolidays} public ${shown.skippedHolidays === 1 ? "holiday is" : "holidays are"} not counted.` : ""}
            </p>
            {shown.note && <p className="mt-1 text-[15px] text-[var(--muted)]">{shown.note}</p>}
            {shown.balance &&
              (shown.balance.configured ? (
                <p className="figures mt-1 text-[15px]">
                  Balance before {shown.balance.remaining}, after {shown.balance.after}.
                </p>
              ) : (
                <p className="mt-1 text-[15px] text-[var(--muted)]">No yearly entitlement has been set yet, so no balance is shown.</p>
              ))}
            {shown.balance?.configured && shown.balance.after !== null && shown.balance.after < 0 && (
              <div className="mt-2">
                <Notice tone="warning">This is more than the days left. Your in-charge will see that when they decide.</Notice>
              </div>
            )}
          </Panel>
        )}

        {problem && <Notice tone="block">{problem}</Notice>}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send request"}
          </Button>
          <Button variant="secondary" onClick={() => router.push("/leave")} disabled={busy}>
            Cancel
          </Button>
        </div>
        <p className="text-sm text-[var(--muted)]">{data.note}</p>
      </form>
    </>
  );
}
