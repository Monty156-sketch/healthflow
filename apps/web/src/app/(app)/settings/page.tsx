"use client";

import { FormEvent, ReactNode, useCallback, useState } from "react";
import { useFacility, type Facility } from "@/components/AppShell";
import { api } from "@/lib/api";
import { useSave } from "@/lib/useApi";
import { FACILITY_TYPE, MONTHS } from "@/lib/format";
import { SmsPanel } from "@/components/SmsPanel";
import { RosterDeadline } from "@/components/RosterDeadline";
import { WhatsAppSettings } from "@/components/WhatsAppSettings";
import { GeofenceSettings } from "@/components/GeofenceSettings";
import { Button, Checkbox, Field, Input, Notice, PageHeader, Panel, SaveStatus, Select } from "@/components/ui";

type Values = Omit<Facility, "id" | "status">;

function Group({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Panel title={title} description={description}>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </Panel>
  );
}

export default function FacilitySettingsPage() {
  const { facility, isAdmin, reload } = useFacility();
  const [v, setV] = useState<Values>(() => ({
    name: facility.name,
    facilityType: facility.facilityType,
    ghsFacilityCode: facility.ghsFacilityCode,
    region: facility.region,
    subDistrict: facility.subDistrict,
    weekStartsOn: facility.weekStartsOn,
    referencePeriodWeeks: facility.referencePeriodWeeks,
    leaveYearStartMonth: facility.leaveYearStartMonth,
    allowNegativeLeaveBalance: facility.allowNegativeLeaveBalance,
    attendanceCutoffDays: facility.attendanceCutoffDays,
    swapCutoffHours: facility.swapCutoffHours,
    dpcRegistrationNumber: facility.dpcRegistrationNumber,
    dpcRegistrationExpiry: facility.dpcRegistrationExpiry,
    dataProtectionContactName: facility.dataProtectionContactName,
    dataProtectionContactEmail: facility.dataProtectionContactEmail,
  }));
  const set = <K extends keyof Values>(k: K, value: Values[K]) => setV((cur) => ({ ...cur, [k]: value }));
  const num = (s: string) => (s === "" ? (NaN as number) : Number(s));

  const submit = useCallback((values: Values) => api.patch<{ facility: Facility }>("/api/facility", values), []);
  const save = useSave(submit);
  const err = save.fieldErrors;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (await save.run(v)) reload();
  }

  if (!isAdmin) return <Notice>Only a facility admin can change facility settings.</Notice>;

  return (
    <>
      <PageHeader title="Facility settings" description="Changes are recorded in the audit log with who made them." />
      <form onSubmit={onSubmit} noValidate className="space-y-6">
        {save.state === "failed" && save.message && <Notice tone="block">{save.message}</Notice>}

        <Group title="Facility details">
          <Field label="Facility name" error={err.name}>
            {(a) => <Input {...a} value={v.name} onChange={(e) => set("name", e.target.value)} />}
          </Field>
          <Field label="Type" error={err.facilityType}>
            {(a) => (
              <Select {...a} value={v.facilityType} onChange={(e) => set("facilityType", e.target.value)}>
                {Object.entries(FACILITY_TYPE).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="GHS facility code" optional error={err.ghsFacilityCode}>
            {(a) => <Input {...a} className="figures" value={v.ghsFacilityCode ?? ""} onChange={(e) => set("ghsFacilityCode", e.target.value)} />}
          </Field>
          <Field label="Region" optional error={err.region}>
            {(a) => <Input {...a} value={v.region ?? ""} onChange={(e) => set("region", e.target.value)} />}
          </Field>
          <Field label="Sub-district" optional error={err.subDistrict}>
            {(a) => <Input {...a} value={v.subDistrict ?? ""} onChange={(e) => set("subDistrict", e.target.value)} />}
          </Field>
        </Group>

        <Group title="Rostering" description="How weeks are counted and when duty changes close.">
          <Field label="Week starts on" error={err.weekStartsOn}>
            {(a) => (
              <Select {...a} value={v.weekStartsOn} onChange={(e) => set("weekStartsOn", Number(e.target.value))}>
                <option value={1}>Monday</option>
                <option value={0}>Sunday</option>
              </Select>
            )}
          </Field>
          <Field
            label="Reference period for working hours"
            hint="The number of weeks over which average weekly hours are checked."
            error={err.referencePeriodWeeks}
          >
            {(a) => (
              <Input {...a} className="figures" type="number" inputMode="numeric" min={1} max={26} value={Number.isNaN(v.referencePeriodWeeks) ? "" : v.referencePeriodWeeks} onChange={(e) => set("referencePeriodWeeks", num(e.target.value))} />
            )}
          </Field>
          <Field label="Swap requests close" hint="Hours before the duty starts." error={err.swapCutoffHours}>
            {(a) => (
              <Input {...a} className="figures" type="number" inputMode="numeric" min={0} max={168} value={Number.isNaN(v.swapCutoffHours) ? "" : v.swapCutoffHours} onChange={(e) => set("swapCutoffHours", num(e.target.value))} />
            )}
          </Field>
          <Field label="Attendance can be corrected for" hint="Days after the duty date." error={err.attendanceCutoffDays}>
            {(a) => (
              <Input {...a} className="figures" type="number" inputMode="numeric" min={0} max={31} value={Number.isNaN(v.attendanceCutoffDays) ? "" : v.attendanceCutoffDays} onChange={(e) => set("attendanceCutoffDays", num(e.target.value))} />
            )}
          </Field>
        </Group>

        <Group title="Leave">
          <Field label="Leave year starts in" error={err.leaveYearStartMonth}>
            {(a) => (
              <Select {...a} value={v.leaveYearStartMonth} onChange={(e) => set("leaveYearStartMonth", Number(e.target.value))}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="sm:col-span-2">
            <Checkbox
              label="Allow leave beyond the entitlement"
              hint="When on, approving leave can take a balance below zero."
              checked={v.allowNegativeLeaveBalance}
              onChange={(c) => set("allowNegativeLeaveBalance", c)}
            />
          </div>
        </Group>

        <Group
          title="Data protection"
          description="Data Protection Commission registration."
        >
          <Field label="DPC registration number" optional error={err.dpcRegistrationNumber}>
            {(a) => <Input {...a} className="figures" value={v.dpcRegistrationNumber ?? ""} onChange={(e) => set("dpcRegistrationNumber", e.target.value)} />}
          </Field>
          <Field label="Registration expires" optional error={err.dpcRegistrationExpiry}>
            {(a) => <Input {...a} type="date" value={v.dpcRegistrationExpiry ?? ""} onChange={(e) => set("dpcRegistrationExpiry", e.target.value)} />}
          </Field>
          <Field label="Data protection contact" optional error={err.dataProtectionContactName}>
            {(a) => <Input {...a} value={v.dataProtectionContactName ?? ""} onChange={(e) => set("dataProtectionContactName", e.target.value)} />}
          </Field>
          <Field label="Contact email" optional error={err.dataProtectionContactEmail}>
            {(a) => <Input {...a} type="email" value={v.dataProtectionContactEmail ?? ""} onChange={(e) => set("dataProtectionContactEmail", e.target.value)} />}
          </Field>
        </Group>

        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-[var(--border)] bg-[var(--background)] px-4 py-3 sm:mx-0 sm:px-0">
          <Button type="submit" disabled={save.state === "saving"}>
            Save settings
          </Button>
          <SaveStatus state={save.state} onRetry={save.retry} />
        </div>
      </form>
      {isAdmin && (
        <div className="mt-6 space-y-6">
          <GeofenceSettings />
          <RosterDeadline />
          <SmsPanel />
          <WhatsAppSettings />
        </div>
      )}
    </>
  );
}
