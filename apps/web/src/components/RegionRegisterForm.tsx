"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { AGENCIES } from "@/lib/agency";

export const GHANA_REGIONS = ["Ahafo", "Ashanti", "Bono", "Bono East", "Central", "Eastern", "Greater Accra", "North East", "Northern", "Oti", "Savannah", "Upper East", "Upper West", "Volta", "Western", "Western North"];

const EMPTY = { agency: "", region: "", contactName: "", contactRole: "", contactEmail: "", contactPhone: "", officeAddress: "", password: "", confirm: "" };

/** A regional office registers itself. PS Tech checks it before it goes live. */
export function RegionRegisterForm() {
  const [v, setV] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hours, setHours] = useState<number | null>(null);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    const bad: Record<string, string> = {};
    if (!v.agency) bad.agency = "Choose who runs the regional office.";
    if (!v.region) bad.region = "Choose the region.";
    if (v.password !== v.confirm) bad.confirm = "The two passwords do not match.";
    setErrors(bad);
    if (Object.keys(bad).length) return;
    setBusy(true);
    const body: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) if (k !== "confirm" && val.trim()) body[k] = k === "password" ? val : val.trim();
    try {
      const res = await api.post<{ responseHours: number }>("/api/public/regions/register", body);
      setHours(res.responseHours);
    } catch (err) {
      const b = err instanceof ApiError ? (err.body as { fields?: Record<string, string>; message?: string }) : undefined;
      if (b?.fields) setErrors(b.fields);
      else setProblem(b?.message ?? "That did not send. Check your connection and try again, or call 055 457 1800.");
    } finally {
      setBusy(false);
    }
  }

  if (hours !== null) {
    return (
      <Notice tone="success">
        <strong className="block">Your regional office is registered.</strong>
        PS Tech checks each office before it goes live, usually within {hours} hours. We will email {v.contactEmail} when it is approved, and you can then sign in at{" "}
        <Link href="/district/login" className="underline">the supervisor sign-in</Link>. Districts can choose your office once it is approved.
      </Notice>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Registered under" error={errors.agency} hint="Districts under the same agency can choose your office.">
          {(a) => (
            <Select {...a} value={v.agency} onChange={set("agency")} required>
              <option value="">Choose</option>
              {AGENCIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Region" error={errors.region}>
          {(a) => (
            <Select {...a} value={v.region} onChange={set("region")} required>
              <option value="">Choose</option>
              {GHANA_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Officer's name" error={errors.contactName}>{(a) => <Input {...a} value={v.contactName} onChange={set("contactName")} autoComplete="name" required />}</Field>
        <Field label="Officer's role" optional>{(a) => <Input {...a} value={v.contactRole} onChange={set("contactRole")} placeholder="Regional Director" />}</Field>
        <Field label="Email" error={errors.contactEmail} hint="This is the sign-in email.">{(a) => <Input {...a} type="email" value={v.contactEmail} onChange={set("contactEmail")} autoComplete="email" required />}</Field>
        <Field label="Telephone" optional error={errors.contactPhone}>{(a) => <Input {...a} type="tel" value={v.contactPhone} onChange={set("contactPhone")} autoComplete="tel" />}</Field>
      </div>
      <Field label="Office address" optional hint="Where the regional office sits.">{(a) => <Input {...a} value={v.officeAddress} onChange={set("officeAddress")} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Password" error={errors.password} hint="At least 12 characters. A few unrelated words work well.">{(a) => <Input {...a} type="password" value={v.password} onChange={set("password")} autoComplete="new-password" required />}</Field>
        <Field label="Repeat the password" error={errors.confirm}>{(a) => <Input {...a} type="password" value={v.confirm} onChange={set("confirm")} autoComplete="new-password" required />}</Field>
      </div>
      {problem && <Notice tone="block">{problem}</Notice>}
      <Button type="submit" disabled={busy}>{busy ? "Registering" : "Register the regional office"}</Button>
      <p className="text-sm text-[var(--muted)]">
        We use what you send only to check the office and to contact its officer. Signing in later asks for a code from your phone. See the Privacy Policy.
      </p>
    </form>
  );
}
