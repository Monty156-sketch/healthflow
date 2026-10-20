"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { Button, Input, Loading, LoadError, Notice, Panel } from "@/components/ui";

interface Data {
  department: { id: string; name: string };
  shifts: { shiftId: string; code: string; name: string; minStaff: number; weekendMinStaff: number | null; holidayMinStaff: number | null; custom: boolean; facilityMinStaff: number }[];
}

/** How many people a ward needs on each shift. A hospital keeps these per ward. */
export function WardDemand({ departmentId, editable }: { departmentId: string; editable: boolean }) {
  const { data, error, reload } = useResource<Data>(`/api/facility/ward-demand/${departmentId}`);
  const [edits, setEdits] = useState<Record<string, string>>({});
  // Keys: `${shiftId}:week`, `${shiftId}:weekend`, `${shiftId}:holiday`.
  const value = (s: Data["shifts"][number], kind: "week" | "weekend" | "holiday") =>
    edits[`${s.shiftId}:${kind}`] ?? (kind === "week" ? String(s.minStaff) : kind === "weekend" ? (s.weekendMinStaff == null ? "" : String(s.weekendMinStaff)) : s.holidayMinStaff == null ? "" : String(s.holidayMinStaff));
  const blankOr = (v: string) => (v.trim() === "" ? null : Number(v));
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
        shifts: data.shifts.map((s) => ({ shiftId: s.shiftId, minStaff: Number(value(s, "week")), weekendMinStaff: blankOr(value(s, "weekend")), holidayMinStaff: blankOr(value(s, "holiday")) })),
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
    <Panel title={`People ${data.department.name} needs on each shift`} description="Leave weekend or holiday blank to use the weekday number.">
      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-left text-[var(--muted)]">
              <th className="py-1 pr-4 font-medium">Shift</th>
              <th className="py-1 pr-4 font-medium">Monday to Friday</th>
              <th className="py-1 pr-4 font-medium">Saturday and Sunday</th>
              <th className="py-1 pr-4 font-medium">Public holidays</th>
            </tr>
          </thead>
          <tbody>
            {data.shifts.map((s) => (
              <tr key={s.shiftId}>
                <th scope="row" className="py-1 pr-4 text-left font-medium">
                  {s.name}
                  {!s.custom && <span className="block font-normal text-[var(--muted)]">facility figure</span>}
                </th>
                {(["week", "weekend", "holiday"] as const).map((kind) => (
                  <td key={kind} className="py-1 pr-4">
                    <Input
                      aria-label={`${s.name}, ${kind === "week" ? "Monday to Friday" : kind === "weekend" ? "Saturday and Sunday" : "public holidays"}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      placeholder={kind === "week" ? undefined : kind === "weekend" ? "Same" : "As weekend"}
                      className="figures w-24"
                      disabled={!editable}
                      value={value(s, kind)}
                      onChange={(e) => setEdits((v) => ({ ...v, [`${s.shiftId}:${kind}`]: e.target.value }))}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="mt-3">
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
      {say && (
        <div className="mt-3">
          <Notice tone={say.tone}>{say.text}</Notice>
        </div>
      )}
    </Panel>
  );
}
