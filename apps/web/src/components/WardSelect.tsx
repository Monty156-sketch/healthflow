"use client";

import { useFacility } from "@/components/AppShell";
import { useResource } from "@/lib/useApi";
import { Field, Select } from "@/components/ui";

/**
 * Picks a ward or department at a hospital, where each ward keeps its own
 * roster. Shows nothing for a facility with one roster, or for a ward manager
 * who is already limited to their own ward.
 */
export function WardSelect({
  value,
  onChange,
  allLabel = "Whole hospital",
  label = "Ward or department",
  wards,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Leave out to offer no "all" choice. */
  allLabel?: string | null;
  label?: string;
  /** Use these wards instead of every department. */
  wards?: { id: string; name: string }[];
}) {
  const { facility, me } = useFacility();
  const show = Boolean(facility.rosterByWard) && !me.departmentId;
  const list = useResource<{ departments: { id: string; name: string; active: boolean }[] }>(show && !wards ? "/api/facility/departments" : null);
  if (!show) return null;
  const options = wards ?? (list.data?.departments ?? []).filter((d) => d.active);
  return (
    <div className="max-w-[16rem]">
      <Field label={label}>
        {(a) => (
          <Select {...a} value={value} onChange={(e) => onChange(e.target.value)}>
            {allLabel !== null && <option value="">{allLabel}</option>}
            {options.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}
