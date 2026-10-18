"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, Field, Input, Notice, Select, Textarea } from "@/components/ui";

const TYPES = [
  ["CHPS_COMPOUND", "CHPS compound"],
  ["HEALTH_CENTRE", "Health centre"],
  ["CLINIC", "Clinic"],
  ["POLYCLINIC", "Polyclinic"],
  ["HOSPITAL", "Hospital"],
  ["PRIVATE_HOSPITAL", "Private hospital"],
] as const;

export function AccessRequestForm({ source = "LANDING_PAGE" }: { source?: "LANDING_PAGE" | "PRICING_PAGE" | "CONTACT_PAGE" | "REFERRAL" }) {
  const [v, setV] = useState({ facilityName: "", facilityType: "", district: "", region: "", contactName: "", contactRole: "", contactEmail: "", contactPhone: "", staffCountEstimate: "", currentMethod: "", message: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hours, setHours] = useState<number | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    setErrors({});
    const body: Record<string, unknown> = { source };
    for (const [k, val] of Object.entries(v)) if (val.trim()) body[k] = k === "staffCountEstimate" ? Number(val) : val.trim();
    try {
      const res = await api.post<{ responseHours: number }>("/api/public/access-requests", body);
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
        <strong className="block">We have your request.</strong>
        We will reply to {v.contactEmail} within {hours} hours, usually sooner. If it is urgent, call 055 457 1800 or 024 618 7422.
      </Notice>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Facility name" error={errors.facilityName}>{(a) => <Input {...a} value={v.facilityName} onChange={set("facilityName")} autoComplete="organization" required />}</Field>
        <Field label="Type of facility" optional>
          {(a) => (
            <Select {...a} value={v.facilityType} onChange={set("facilityType")}>
              <option value="">Choose</option>
              {TYPES.map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="District" optional>{(a) => <Input {...a} value={v.district} onChange={set("district")} />}</Field>
        <Field label="Region" optional>{(a) => <Input {...a} value={v.region} onChange={set("region")} />}</Field>
        <Field label="Your name" error={errors.contactName}>{(a) => <Input {...a} value={v.contactName} onChange={set("contactName")} autoComplete="name" required />}</Field>
        <Field label="Your role" optional>{(a) => <Input {...a} value={v.contactRole} onChange={set("contactRole")} />}</Field>
        <Field label="Email" error={errors.contactEmail} hint="We reply here.">{(a) => <Input {...a} type="email" value={v.contactEmail} onChange={set("contactEmail")} autoComplete="email" required />}</Field>
        <Field label="Telephone" optional>{(a) => <Input {...a} type="tel" value={v.contactPhone} onChange={set("contactPhone")} autoComplete="tel" />}</Field>
        <Field label="Approximate number of staff" optional error={errors.staffCountEstimate}>{(a) => <Input {...a} type="number" inputMode="numeric" min={1} value={v.staffCountEstimate} onChange={set("staffCountEstimate")} />}</Field>
      </div>
      <Field label="How is the roster done now?" optional hint="For example: by hand on paper, in Excel, in a notebook.">{(a) => <Input {...a} value={v.currentMethod} onChange={set("currentMethod")} />}</Field>
      <Field label="Anything else we should know" optional>{(a) => <Textarea {...a} value={v.message} onChange={set("message")} />}</Field>
      {problem && <Notice tone="block">{problem}</Notice>}
      <Button type="submit" disabled={busy}>
        {busy ? "Sending" : "Send request"}
      </Button>
      <p className="text-sm text-[var(--muted)]">We use what you send only to reply to you and to keep a record of the request. See the Privacy Policy.</p>
    </form>
  );
}
