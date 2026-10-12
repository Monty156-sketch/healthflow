"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { showDate } from "@/lib/format";
import { Button, Field, Notice, Panel, Textarea } from "@/components/ui";

interface ShiftLite {
  id: string;
  code: string;
  name: string;
  colour: string | null;
  countsAsDuty: boolean;
}

/**
 * Change one person's duty on one day. A change that breaks a rule set to
 * block is refused with the reason; the manager can still make it by giving
 * their own reason, which is kept on the roster and in the audit log.
 */
export function CellEditor({
  rosterId,
  staffName,
  staffId,
  date,
  currentShiftId,
  shifts,
  onDone,
}: {
  rosterId: string;
  staffName: string;
  staffId: string;
  date: string;
  currentShiftId: string | null;
  shifts: ShiftLite[];
  onDone: (saved: boolean, change?: { staffId: string; date: string; from: string | null; to: string }) => void;
}) {
  const [shiftId, setShiftId] = useState(currentShiftId ?? "");
  const [reason, setReason] = useState("");
  const [conflict, setConflict] = useState<{ message: string; findings: { ruleCode: string; message: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => heading.current?.focus(), []);

  async function save() {
    setSaving(true);
    setError(null);
    setReasonError(null);
    try {
      await api.put(`/api/facility/rosters/${rosterId}/cell`, { staffId, date, shiftId, ...(conflict ? { overrideReason: reason } : {}) });
      onDone(true, { staffId, date, from: currentShiftId, to: shiftId });
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { error?: string; message?: string; findings?: { ruleCode: string; message: string }[]; fields?: Record<string, string> }) : undefined;
      if (body?.error === "blocks_rule") setConflict({ message: body.message ?? "This change breaks a rule.", findings: body.findings ?? [] });
      else if (body?.fields?.overrideReason) setReasonError(body.fields.overrideReason);
      else setError(body?.message ?? "The change was not saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={heading} tabIndex={-1} className="no-print mb-4 outline-none" aria-label="Change a duty">
      <Panel title={`Change duty: ${staffName}, ${showDate(date)}`} description="Choose the shift this person works on this day. Off Duty clears the day.">
        <div role="radiogroup" aria-label="Shift" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {shifts.map((s) => (
            <label
              key={s.id}
              className={`flex cursor-pointer items-center gap-3 rounded-[var(--radius)] border px-3 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ${
                shiftId === s.id ? "border-[var(--foreground)]" : "border-[var(--border-strong)]"
              }`}
            >
              <input type="radio" name="cell-shift" className="size-5 accent-[var(--accent)]" checked={shiftId === s.id} onChange={() => { setShiftId(s.id); setConflict(null); }} />
              <span className="figures w-8 font-semibold">{s.code}</span>
              <span>{s.name}</span>
            </label>
          ))}
        </div>
        {conflict && (
          <div className="mt-4 space-y-3">
            <Notice tone="block">
              <span className="block font-medium">{conflict.message}</span>
              <ul className="mt-1 list-disc pl-5">
                {conflict.findings.map((f, i) => (
                  <li key={i}>{f.message}</li>
                ))}
              </ul>
            </Notice>
            <Field label="Why make this change anyway" hint="Kept on the roster and in the audit log." error={reasonError ?? undefined}>
              {(a) => <Textarea {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}
            </Field>
          </div>
        )}
        {error && (
          <div className="mt-4">
            <Notice tone="block">{error}</Notice>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={save} disabled={saving || !shiftId || shiftId === currentShiftId || (Boolean(conflict) && reason.trim().length === 0)}>
            {saving ? "Saving…" : conflict ? "Change it anyway" : "Save change"}
          </Button>
          <Button variant="secondary" onClick={() => onDone(false)} disabled={saving}>
            Cancel
          </Button>
        </div>
      </Panel>
    </div>
  );
}
