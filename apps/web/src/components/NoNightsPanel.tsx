"use client";

// Stretches when a person must not be given nights: pregnancy, breastfeeding,
// recovery. Only the dates are used; the reason stays with the in-charge.
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import { Button, Field, Input, Loading, LoadError, Notice, Panel } from "@/components/ui";

interface Row { id: string; startDate: string; endDate: string; note: string | null }

export function NoNightsPanel({ staffId }: { staffId: string }) {
  const { data, error, reload } = useResource<{ restrictions: Row[] }>(`/api/facility/staff/${staffId}/restrictions`);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading" />;

  async function add() {
    setBusy(true);
    setFields({});
    try {
      await api.post(`/api/facility/staff/${staffId}/restrictions`, { startDate: start, endDate: end, note: note || undefined });
      setStart("");
      setEnd("");
      setNote("");
      reload();
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { fields?: Record<string, string>; message?: string }) : undefined;
      setFields(b?.fields ?? { startDate: b?.message ?? "This could not be saved. Try again." });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await api.delete(`/api/facility/staff/${staffId}/restrictions/${id}`);
    reload();
  }

  return (
    <Panel title="No nights for a while" description="For pregnancy, breastfeeding or recovery. The roster gives no night duty between these dates.">
      {data.restrictions.length > 0 ? (
        <ul className="space-y-2">
          {data.restrictions.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-[15px]">
              <span>
                {showDate(r.startDate)} to {showDate(r.endDate)}
                {r.note && <span className="text-[var(--muted)]"> · {r.note}</span>}
              </span>
              <Button variant="quiet" onClick={() => remove(r.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[15px] text-[var(--muted)]">None set.</p>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="From" error={fields.startDate}>
          {(a) => <Input {...a} type="date" value={start} onChange={(e) => setStart(e.target.value)} />}
        </Field>
        <Field label="To" error={fields.endDate}>
          {(a) => <Input {...a} type="date" min={start || undefined} value={end} onChange={(e) => setEnd(e.target.value)} />}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Note" optional hint="Operational only. Never a diagnosis.">
            {(a) => <Input {...a} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </div>
      </div>
      <div className="mt-3">
        <Button onClick={add} disabled={busy || !start || !end}>
          {busy ? "Saving…" : "Add"}
        </Button>
      </div>
      {fields.note && <Notice tone="block">{fields.note}</Notice>}
    </Panel>
  );
}
