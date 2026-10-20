"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { showDate } from "@/lib/format";
import { Button, Field, Notice, Textarea } from "@/components/ui";

interface ShiftLite {
  id: string;
  code: string;
  name: string;
  colour: string | null;
  countsAsDuty: boolean;
}

export interface CellConflict {
  message: string;
  findings: { ruleCode: string; message: string }[];
}

/**
 * Change one person's duty on one day. It sits at the foot of the screen so the
 * grid stays where it is, and one tap on a shift makes the change. A change
 * that breaks a rule set to block is refused with the reason; the manager can
 * still make it by giving their own reason, which is kept on the roster and in
 * the audit log. Escape closes it.
 */
export function CellEditor({
  rosterId,
  staffName,
  staffId,
  date,
  currentShiftId,
  shifts,
  preset,
  onDone,
}: {
  rosterId: string;
  staffName: string;
  staffId: string;
  date: string;
  currentShiftId: string | null;
  shifts: ShiftLite[];
  /** A change already tried from the keyboard and refused, so its reason shows at once. */
  preset?: { shiftId: string; conflict: CellConflict };
  onDone: (saved: boolean, change?: { staffId: string; date: string; from: string | null; to: string }) => void;
}) {
  const [tried, setTried] = useState<string | null>(preset?.shiftId ?? null);
  const [reason, setReason] = useState("");
  const [conflict, setConflict] = useState<CellConflict | null>(preset?.conflict ?? null);
  const [error, setError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => sheet.current?.focus(), []);

  async function save(shiftId: string, withReason: boolean) {
    setSaving(true);
    setError(null);
    setReasonError(null);
    setTried(shiftId);
    try {
      await api.put(`/api/facility/rosters/${rosterId}/cell`, { staffId, date, shiftId, ...(withReason ? { overrideReason: reason } : {}) });
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

  const triedShift = shifts.find((s) => s.id === tried);

  return (
    <div
      ref={sheet}
      tabIndex={-1}
      role="dialog"
      aria-label={`Change duty: ${staffName}, ${showDate(date)}`}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !saving) {
          e.stopPropagation();
          onDone(false);
        }
      }}
      className="no-print fixed inset-x-0 bottom-0 z-40 max-h-[55vh] overflow-y-auto border-t border-[var(--border-strong)] bg-[var(--surface)] px-4 pt-3 pb-4 shadow-[0_-6px_20px_rgb(0_0_0/0.14)] outline-none"
    >
      <div className="mx-auto max-w-4xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{staffName}</h2>
            <p className="figures text-sm text-[var(--muted)]">{showDate(date)}. Tap a shift to change this day. Off Duty clears it.</p>
          </div>
          <Button variant="secondary" onClick={() => onDone(false)} disabled={saving}>
            Close
          </Button>
        </div>
        <div role="group" aria-label="Shift" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {shifts.map((s) => {
            const current = s.id === currentShiftId;
            return (
              <button
                key={s.id}
                type="button"
                disabled={saving || current}
                aria-pressed={current}
                onClick={() => save(s.id, false)}
                className={`flex min-h-12 items-center gap-3 rounded-[var(--radius)] border px-3 py-2 text-left disabled:cursor-not-allowed ${
                  current ? "border-[var(--foreground)] bg-[var(--accent-soft)]" : "border-[var(--border-strong)] hover:bg-[var(--accent-soft)] disabled:opacity-60"
                }`}
              >
                <span className="figures w-8 shrink-0 font-semibold" style={s.colour ? { color: `color-mix(in srgb, ${s.colour} 72%, var(--foreground))` } : undefined}>
                  {s.code}
                </span>
                <span className="min-w-0 text-[15px]">
                  {s.name}
                  {current && <span className="block text-xs text-[var(--muted)]">Now</span>}
                </span>
              </button>
            );
          })}
        </div>
        {saving && <p className="mt-3 text-sm text-[var(--muted)]" role="status">Saving…</p>}
        {conflict && triedShift && (
          <div className="mt-4 space-y-3">
            <Notice tone="block">
              <span className="block font-medium">{conflict.message}</span>
              <ul className="mt-1 list-disc pl-5">
                {conflict.findings.map((f, i) => (
                  <li key={i}>{f.message}</li>
                ))}
              </ul>
            </Notice>
            <Field label={`Why make ${triedShift.name} stand anyway`} hint="Kept on the roster and in the audit log." error={reasonError ?? undefined}>
              {(a) => <Textarea {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => save(triedShift.id, true)} disabled={saving || reason.trim().length === 0}>
                Change it anyway
              </Button>
              <Button variant="secondary" onClick={() => { setConflict(null); setTried(null); }} disabled={saving}>
                Choose another shift
              </Button>
            </div>
          </div>
        )}
        {error && (
          <div className="mt-4">
            <Notice tone="block">{error}</Notice>
          </div>
        )}
      </div>
    </div>
  );
}
