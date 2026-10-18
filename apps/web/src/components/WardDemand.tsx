"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { Button, Input, Loading, LoadError, Notice, Panel } from "@/components/ui";

interface Data {
  department: { id: string; name: string };
  shifts: { shiftId: string; code: string; name: string; minStaff: number; custom: boolean; facilityMinStaff: number }[];
}

/** How many people a ward needs on each shift. A hospital keeps these per ward. */
export function WardDemand({ departmentId, editable }: { departmentId: string; editable: boolean }) {
  const { data, error, reload } = useResource<Data>(`/api/facility/ward-demand/${departmentId}`);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [say, setSay] = useState<{ tone: "success" | "block"; text: string } | null>(null);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading />;

  async function save() {
    if (!data) return;
    setBusy(true);
    setSay(null);
    try {
      await api.put(`/api/facility/ward-demand/${departmentId}`, {
        shifts: data.shifts.map((s) => ({ shiftId: s.shiftId, minStaff: Number(edits[s.shiftId] ?? s.minStaff) })),
      });
      setEdits({});
      reload();
      setSay({ tone: "success", text: "Saved. The next time you generate this roster it uses these numbers." });
    } catch (e) {
      setSay({ tone: "block", text: e instanceof ApiError && typeof (e.body as { message?: string })?.message === "string" ? (e.body as { message: string }).message : "This could not be saved. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={`People ${data.department.name} needs on each shift`} description="The least number of people this ward must have on a shift. A shift you have not set uses the facility figure.">
      <div className="flex flex-wrap items-end gap-4">
        {data.shifts.map((s) => (
          <div key={s.shiftId}>
            <label htmlFor={`ward-${s.shiftId}`} className="mb-1 block text-sm font-medium">
              {s.name}
              {!s.custom && <span className="font-normal text-[var(--muted)]"> (facility figure)</span>}
            </label>
            <Input
              id={`ward-${s.shiftId}`}
              type="number"
              inputMode="numeric"
              min={0}
              className="figures w-24"
              disabled={!editable}
              value={edits[s.shiftId] ?? String(s.minStaff)}
              onChange={(e) => setEdits((v) => ({ ...v, [s.shiftId]: e.target.value }))}
            />
          </div>
        ))}
        {editable && (
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        )}
      </div>
      {say && (
        <div className="mt-3">
          <Notice tone={say.tone}>{say.text}</Notice>
        </div>
      )}
    </Panel>
  );
}
