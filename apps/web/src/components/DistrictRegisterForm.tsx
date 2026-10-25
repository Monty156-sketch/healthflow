"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { AGENCIES } from "@/lib/agency";

const EMPTY = { agency: "", name: "", region: "", contactName: "", contactRole: "", contactEmail: "", contactPhone: "", officeAddress: "", password: "", confirm: "" };

/** A district directorate registers itself. It is checked before it goes live. */
export function DistrictRegisterForm() {
  const [v, setV] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hours, setHours] = useState<number | null>(null);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    setErrors({});
    if (!v.agency) {
      setErrors({ agency: "Choose Ghana Health Service or CHAG." });
      return;
    }
    if (v.password !== v.confirm) {
      setErrors({ confirm: "The two passwords do not match." });
      return;
    }
    setBusy(true);
    const body: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) if (k !== "confirm" && val.trim()) body[k] = k === "password" ? val : val.trim();
    try {
      const res = await api.post<{ responseHours: number }>("/api/public/districts/register", body);
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
        <strong className="block">Your district is registered.</strong>
        We check each district before it goes live, usually within {hours} hours. We will email {v.contactEmail} when it is approved, and you can then sign in at{" "}
        <Link href="/district/login" className="underline">/district/login</Link>. Facilities can choose your district once it is approved.
      </Notice>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Registered under" error={errors.agency} hint="You will monitor the facilities that register under the same agency.">
          {(a) => (
            <Select {...a} value={v.agency} onChange={set("agency")} required>
              <option value="">Choose</option>
              {AGENCIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          )}
        </Field>
        <span className="hidden sm:block" />
        <Field label="District" error={errors.name}>{(a) => <Input {...a} value={v.name} onChange={set("name")} required />}</Field>
        <Field label="Region" error={errors.region}>{(a) => <Input {...a} value={v.region} onChange={set("region")} required />}</Field>
        <Field label="Officer's name" error={errors.contactName}>{(a) => <Input {...a} value={v.contactName} onChange={set("contactName")} autoComplete="name" required />}</Field>
        <Field label="Officer's role" optional>{(a) => <Input {...a} value={v.contactRole} onChange={set("contactRole")} />}</Field>
        <Field label="Email" error={errors.contactEmail} hint="This is the sign-in email.">{(a) => <Input {...a} type="email" value={v.contactEmail} onChange={set("contactEmail")} autoComplete="email" required />}</Field>
        <Field label="Telephone" optional error={errors.contactPhone}>{(a) => <Input {...a} type="tel" value={v.contactPhone} onChange={set("contactPhone")} autoComplete="tel" />}</Field>
      </div>
      <Field label="Office address" optional hint="Where the district directorate sits.">{(a) => <Input {...a} value={v.officeAddress} onChange={set("officeAddress")} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Password" error={errors.password} hint="At least 12 characters. A few unrelated words work well.">{(a) => <Input {...a} type="password" value={v.password} onChange={set("password")} autoComplete="new-password" required />}</Field>
        <Field label="Repeat the password" error={errors.confirm}>{(a) => <Input {...a} type="password" value={v.confirm} onChange={set("confirm")} autoComplete="new-password" required />}</Field>
      </div>
      {problem && <Notice tone="block">{problem}</Notice>}
      <Button type="submit" disabled={busy}>{busy ? "Registering" : "Register the district"}</Button>
      <p className="text-sm text-[var(--muted)]">
        We use what you send only to check the district and to contact its officer. Signing in later asks for a code from your phone. See the Privacy Policy.
      </p>
    </form>
  );
}
