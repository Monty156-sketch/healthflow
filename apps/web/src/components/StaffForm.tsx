"use client";

import { FormEvent, ReactNode, useCallback, useState } from "react";
import { api } from "@/lib/api";
import { useResource, useSave } from "@/lib/useApi";
import { EMPLOYMENT } from "@/lib/format";
import type { Cadre, Department, Shift, Staff } from "@/lib/types";
import { Button, Checkbox, Field, Input, Notice, SaveStatus, Select } from "@/components/ui";

interface FormValues {
  staffNo: string;
  fullName: string;
  position: string;
  cadreId: string;
  departmentId: string;
  employmentStatus: string;
  dateJoined: string;
  phone: string;
  email: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  eligibleShiftIds: string[];
  excludedFromNights: boolean;
  morningOnly: boolean;
  smsOptOut: boolean;
  willingForExtraDuties: boolean;
  exclusionReason: string;
  maxDutiesPerWeek: string;
  canLead: boolean;
  leaveGrade: string;
  maxNightsPerMonth: string;
  maxHoursPerMonth: string;
}

function initialValues(s?: Staff): FormValues {
  return {
    staffNo: s?.staffNo ?? "",
    fullName: s?.fullName ?? "",
    position: s?.position ?? "",
    cadreId: s?.cadre?.id ?? "",
    departmentId: s?.department?.id ?? "",
    employmentStatus: s?.employmentStatus ?? "PERMANENT",
    dateJoined: s?.dateJoined ?? "",
    phone: s?.phone ?? "",
    email: s?.email ?? "",
    emergencyContactName: s?.emergencyContactName ?? "",
    emergencyContactPhone: s?.emergencyContactPhone ?? "",
    eligibleShiftIds: (s?.eligibleShifts ?? []).map((x) => x.id),
    excludedFromNights: s?.excludedFromNights ?? false,
    morningOnly: s?.morningOnly ?? false,
    smsOptOut: s?.smsOptOut ?? false,
    willingForExtraDuties: s?.willingForExtraDuties ?? true,
    exclusionReason: s?.exclusionReason ?? "",
    maxDutiesPerWeek: String(s?.maxDutiesPerWeek ?? 0),
    canLead: s?.canLead ?? false,
    leaveGrade: s?.leaveGrade ?? "",
    maxNightsPerMonth: String(s?.maxNightsPerMonth ?? 0),
    maxHoursPerMonth: String(s?.maxHoursPerMonth ?? 0),
  };
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-[var(--border)] pt-5 first:border-t-0 first:pt-0">
      <legend className="float-left mb-3 w-full">
        <span className="block text-base font-semibold">{title}</span>
        {description && <span className="block text-sm text-[var(--muted)]">{description}</span>}
      </legend>
      <div className="clear-both grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function StaffForm({
  staff,
  submitLabel,
  onSaved,
  onCancel,
}: {
  staff?: Staff;
  submitLabel: string;
  onSaved: (s: Staff) => void;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState<FormValues>(() => initialValues(staff));
  const cadres = useResource<{ cadres: Cadre[] }>("/api/facility/cadres");
  const departments = useResource<{ departments: Department[] }>("/api/facility/departments");
  const shifts = useResource<{ shifts: Shift[] }>("/api/facility/shifts");

  const set = <K extends keyof FormValues>(key: K) => (value: FormValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  const submit = useCallback(
    async (v: FormValues) => {
      const body = {
        ...v,
        // A new person whose position says in-charge is set to mornings by the server; ticking it here does the same.
        morningOnly: staff ? v.morningOnly : v.morningOnly || undefined,
        smsOptOut: staff ? v.smsOptOut : v.smsOptOut || undefined,
        maxDutiesPerWeek: v.maxDutiesPerWeek === "" ? 0 : Number(v.maxDutiesPerWeek),
        maxNightsPerMonth: v.maxNightsPerMonth === "" ? 0 : Number(v.maxNightsPerMonth),
        maxHoursPerMonth: v.maxHoursPerMonth === "" ? 0 : Number(v.maxHoursPerMonth),
        exclusionReason: v.excludedFromNights ? v.exclusionReason : "",
        leaveGrade: v.leaveGrade || null,
      };
      const res = staff
        ? await api.patch<{ staff: Staff }>(`/api/facility/staff/${staff.id}`, body)
        : await api.post<{ staff: Staff }>("/api/facility/staff", body);
      return res.staff;
    },
    [staff]
  );
  const save = useSave(submit);
  const err = save.fieldErrors;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const saved = await save.run(values);
    if (saved) onSaved(saved);
  }

  // Active choices, plus the current one even if it has since been deactivated.
  const cadreId = values.cadreId;
  const dutyShifts = (shifts.data?.shifts ?? []).filter(
    (sh) => sh.countsAsDuty && (sh.active || values.eligibleShiftIds.includes(sh.id)) && (sh.eligibleCadreIds.length === 0 || (cadreId && sh.eligibleCadreIds.includes(cadreId)) || values.eligibleShiftIds.includes(sh.id))
  );
  const cadreOptions = (cadres.data?.cadres ?? []).filter((c) => c.active || c.id === staff?.cadre?.id);
  const departmentOptions = (departments.data?.departments ?? []).filter((d) => d.active || d.id === staff?.department?.id);

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {save.state === "failed" && save.message && <Notice tone="block">{save.message}</Notice>}

      <Section title="Identity">
        <Field label="Full name" error={err.fullName}>
          {(a) => <Input {...a} autoComplete="off" value={values.fullName} onChange={(e) => set("fullName")(e.target.value)} />}
        </Field>
        <Field label="Staff number" hint="As on their appointment letter or payslip." error={err.staffNo}>
          {(a) => <Input {...a} className="figures" autoComplete="off" value={values.staffNo} onChange={(e) => set("staffNo")(e.target.value)} />}
        </Field>
        <Field label="Position" optional hint="For example, Senior Staff Midwife." error={err.position}>
          {(a) => <Input {...a} value={values.position} onChange={(e) => set("position")(e.target.value)} />}
        </Field>
      </Section>

      <Section title="Placement" description="Rosters are grouped by department, then cadre.">
        <Field
          label="Cadre"
          optional
          error={err.cadreId}
          hint={cadres.data && cadreOptions.length === 0 ? "No cadres yet. Add them under Departments and cadres." : undefined}
        >
          {(a) => (
            <Select {...a} value={values.cadreId} onChange={(e) => set("cadreId")(e.target.value)}>
              <option value="">Not set</option>
              {cadreOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.active ? "" : " (inactive)"}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Department"
          optional
          error={err.departmentId}
          hint={departments.data && departmentOptions.length === 0 ? "No departments yet. Add them under Departments and cadres." : undefined}
        >
          {(a) => (
            <Select {...a} value={values.departmentId} onChange={(e) => set("departmentId")(e.target.value)}>
              <option value="">Not set</option>
              {departmentOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.active ? "" : " (inactive)"}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Employment type" error={err.employmentStatus}>
          {(a) => (
            <Select {...a} value={values.employmentStatus} onChange={(e) => set("employmentStatus")(e.target.value)}>
              {Object.entries(EMPLOYMENT).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Date joined this facility" optional error={err.dateJoined}>
          {(a) => <Input {...a} type="date" value={values.dateJoined} onChange={(e) => set("dateJoined")(e.target.value)} />}
        </Field>
      </Section>

      <Section title="Contact">
        <Field label="Phone" optional error={err.phone}>
          {(a) => <Input {...a} type="tel" inputMode="tel" autoComplete="off" value={values.phone} onChange={(e) => set("phone")(e.target.value)} />}
        </Field>
        <Field label="Email" optional hint="Needed later to invite them to HealthFlow." error={err.email}>
          {(a) => <Input {...a} type="email" autoComplete="off" value={values.email} onChange={(e) => set("email")(e.target.value)} />}
        </Field>
        <Field label="Emergency contact name" optional error={err.emergencyContactName}>
          {(a) => <Input {...a} autoComplete="off" value={values.emergencyContactName} onChange={(e) => set("emergencyContactName")(e.target.value)} />}
        </Field>
        <Field label="Emergency contact phone" optional error={err.emergencyContactPhone}>
          {(a) => (
            <Input {...a} type="tel" inputMode="tel" autoComplete="off" value={values.emergencyContactPhone} onChange={(e) => set("emergencyContactPhone")(e.target.value)} />
          )}
        </Field>
      </Section>

      <Section title="Duty limits" description="Used when the roster is generated.">
        <div className="sm:col-span-2">
          <Checkbox
            label="Exclude from night duty"
            checked={values.excludedFromNights}
            onChange={set("excludedFromNights")}
          />
        </div>
        <div className="sm:col-span-2">
          <Checkbox label="Do not send this person text messages" checked={values.smsOptOut} onChange={set("smsOptOut")} />
          <p className="mt-1 text-sm text-[var(--muted)]">If they asked not to be texted.</p>
        </div>
        <div className="sm:col-span-2">
          <Checkbox label="In-charge: weekday mornings only" checked={values.morningOnly} onChange={set("morningOnly")} />
          <p className="mt-1 text-sm text-[var(--muted)]">Weekday mornings only, outside the duty cycles.</p>
        </div>
        <div className="sm:col-span-2 max-w-sm">
          <Field label="Leave grade" optional hint="Gives the yearly leave days when none are set by hand.">
            {(a) => (
              <Select {...a} value={values.leaveGrade} onChange={(e) => set("leaveGrade")(e.target.value)}>
                <option value="">Not set</option>
                <option value="SENIOR">Category C, senior staff: 36 working days</option>
                <option value="INTERMEDIATE">Category D, intermediate staff: 28 working days</option>
                <option value="JUNIOR">Category E, junior staff: 21 working days</option>
              </Select>
            )}
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Checkbox label="Can lead a shift" checked={values.canLead} onChange={set("canLead")} />
          <p className="mt-1 text-sm text-[var(--muted)]">Senior enough to take charge of a shift.</p>
        </div>
        <div className="sm:col-span-2">
          <Checkbox label="Willing to cover extra duties" checked={values.willingForExtraDuties} onChange={set("willingForExtraDuties")} />
          <p className="mt-1 text-sm text-[var(--muted)]">Asked first when cover is needed.</p>
        </div>
        {values.excludedFromNights && (
          <div className="sm:col-span-2">
            <Field
              label="Reason for the exclusion"
              hint="Operational only. Never a medical reason."
              error={err.exclusionReason}
            >
              {(a) => <Input {...a} value={values.exclusionReason} onChange={(e) => set("exclusionReason")(e.target.value)} />}
            </Field>
          </div>
        )}
        {dutyShifts.length > 0 && (
          <fieldset className="sm:col-span-2">
            <legend className="mb-1 text-sm font-medium">Shifts this person may work</legend>
            <p className="mb-2 text-sm text-[var(--muted)]">Tick just one for someone who works only that shift, for example nights only. None ticked: every shift their cadre allows.</p>
            <div className="flex flex-wrap gap-x-6">
              {dutyShifts.map((sh) => (
                <Checkbox
                  key={sh.id}
                  label={`${sh.name} (${sh.code})`}
                  checked={values.eligibleShiftIds.includes(sh.id)}
                  onChange={(on) => set("eligibleShiftIds")(on ? [...values.eligibleShiftIds, sh.id] : values.eligibleShiftIds.filter((x) => x !== sh.id))}
                />
              ))}
            </div>
            {err.eligibleShiftIds && <p className="mt-1 text-sm text-[var(--status-block)]">{err.eligibleShiftIds}</p>}
          </fieldset>
        )}
        <Field label="Maximum duties per week" hint="0 means no limit." error={err.maxDutiesPerWeek}>
          {(a) => (
            <Input
              {...a}
              className="figures"
              type="number"
              inputMode="numeric"
              min={0}
              max={7}
              value={values.maxDutiesPerWeek}
              onChange={(e) => set("maxDutiesPerWeek")(e.target.value)}
            />
          )}
        </Field>
        <Field label="Most nights in a month" hint="0 means no limit." error={err.maxNightsPerMonth}>
          {(a) => <Input {...a} className="figures" type="number" inputMode="numeric" min={0} max={31} value={values.maxNightsPerMonth} onChange={(e) => set("maxNightsPerMonth")(e.target.value)} />}
        </Field>
        <Field label="Most hours in a month" hint="0 means no limit. For part-time contracts, for example." error={err.maxHoursPerMonth}>
          {(a) => <Input {...a} className="figures" type="number" inputMode="numeric" min={0} max={744} value={values.maxHoursPerMonth} onChange={(e) => set("maxHoursPerMonth")(e.target.value)} />}
        </Field>
      </Section>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-5">
        <Button type="submit" disabled={save.state === "saving"}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <SaveStatus state={save.state} onRetry={save.retry} />
      </div>
    </form>
  );
}
