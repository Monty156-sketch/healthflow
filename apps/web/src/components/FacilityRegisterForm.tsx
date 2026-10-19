"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, Checkbox, Field, Input, Notice, Select } from "@/components/ui";

const TYPES = [
  ["CHPS_COMPOUND", "CHPS compound"],
  ["HEALTH_CENTRE", "Health centre"],
  ["CLINIC", "Clinic"],
  ["POLYCLINIC", "Polyclinic"],
  ["HOSPITAL", "Hospital"],
  ["PRIVATE_HOSPITAL", "Private hospital"],
] as const;

interface Done { facilityName: string; code: string; joinUrl: string }

/** A facility registers itself and leaves with a staff access code. */
export function FacilityRegisterForm() {
  const [v, setV] = useState({ facilityName: "", facilityType: "", region: "", districtText: "", adminName: "", adminEmail: "", adminPhone: "", password: "", confirm: "" });
  const [districtId, setDistrictId] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [districts, setDistricts] = useState<{ id: string; name: string; region: string }[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [copied, setCopied] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  useEffect(() => {
    let live = true;
    api.get<{ districts: { id: string; name: string; region: string }[] }>("/api/public/districts").then((r) => live && setDistricts(r.districts)).catch(() => live && setDistricts([]));
    return () => { live = false; };
  }, []);
  const listed = districts !== null && districts.length > 0;
  const other = districtId === "other";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    setErrors({});
    if (v.password !== v.confirm) return setErrors({ confirm: "The two passwords do not match." });
    if (!agreed) return setErrors({ acceptedTerms: "Agree to the Terms and the Privacy Policy to continue." });
    setBusy(true);
    try {
      const res = await api.post<Done>("/api/public/register-facility", {
        facilityName: v.facilityName, facilityType: v.facilityType, region: v.region, districtId: districtId && !other ? districtId : undefined,
        districtText: v.districtText || undefined, adminName: v.adminName, adminEmail: v.adminEmail, adminPhone: v.adminPhone, password: v.password, acceptedTerms: true,
      });
      setDone(res);
    } catch (err) {
      const b = err instanceof ApiError ? (err.body as { fields?: Record<string, string>; message?: string }) : undefined;
      if (b?.fields) setErrors(b.fields);
      else setProblem(b?.message ?? "That did not go through. Check your connection and try again, or call 055 457 1800.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const message = `Join ${done.facilityName} on HealthFlow. Open ${done.joinUrl} or go to the HealthFlow site, choose "Join with your facility code" and enter ${done.code}.`;
    return (
      <div className="space-y-5">
        <Notice tone="success"><strong className="block">{done.facilityName} is registered.</strong>Your account is ready. Keep the code below: it is how your staff join.</Notice>
        <div>
          <p className="text-sm text-[var(--muted)]">Your staff access code</p>
          <p className="figures text-3xl font-semibold tracking-wide" aria-label={`Access code ${done.code.split("").join(" ")}`}>{done.code}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(done.code).then(() => setCopied(true), () => setCopied(false))}>{copied ? "Copied" : "Copy code"}</Button>
            <a className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-4 text-sm font-medium" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>
          </div>
        </div>
        <ol className="list-decimal space-y-1 pl-6 text-[15px]">
          <li>Sign in with {v.adminEmail}. The first time, you set up an authenticator app on your phone.</li>
          <li>Read the starter privacy notice under Settings, Privacy and data protection, and edit it for your facility.</li>
          <li>Give your staff the code. They register at the Join page and you approve each person under Staff, Access code. You can also print a notice with a QR code there.</li>
        </ol>
        <Link href="/login" className="inline-flex min-h-11 items-center rounded-[var(--radius)] bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-contrast,#fff)]">Sign in</Link>
        <p className="text-sm text-[var(--muted)]">Your facility starts on a trial. PS Tech will contact you about plans. If anything looks wrong, call 055 457 1800 or 024 618 7422.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Facility name" error={errors.facilityName}>{(a) => <Input {...a} value={v.facilityName} onChange={set("facilityName")} autoComplete="organization" />}</Field>
        <Field label="Type of facility" error={errors.facilityType}>
          {(a) => (
            <Select {...a} value={v.facilityType} onChange={set("facilityType")}>
              <option value="">Choose</option>
              {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Region" error={errors.region}>{(a) => <Input {...a} value={v.region} onChange={set("region")} />}</Field>
        {listed ? (
          <Field label="District" optional hint="Choose it if it is listed. The district sees nothing until you allow it.">
            {(a) => (
              <Select {...a} value={districtId} onChange={(e) => { setDistrictId(e.target.value); const d = districts?.find((x) => x.id === e.target.value); if (d) setV({ ...v, region: d.region }); }}>
                <option value="">Choose your district</option>
                {districts!.map((d) => <option key={d.id} value={d.id}>{d.name}, {d.region}</option>)}
                <option value="other">My district is not listed</option>
              </Select>
            )}
          </Field>
        ) : (
          <Field label="District" optional>{(a) => <Input {...a} value={v.districtText} onChange={set("districtText")} />}</Field>
        )}
        {other && <Field label="Your district's name" optional>{(a) => <Input {...a} value={v.districtText} onChange={set("districtText")} />}</Field>}
      </div>
      <h2 className="pt-2 text-base font-semibold">Your account</h2>
      <p className="-mt-2 text-sm text-[var(--muted)]">You become the facility&apos;s administrator.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" error={errors.adminName}>{(a) => <Input {...a} value={v.adminName} onChange={set("adminName")} autoComplete="name" />}</Field>
        <Field label="Your phone number" error={errors.adminPhone}>{(a) => <Input {...a} type="tel" value={v.adminPhone} onChange={set("adminPhone")} autoComplete="tel" />}</Field>
        <Field label="Email" error={errors.adminEmail} hint="You sign in with this.">{(a) => <Input {...a} type="email" value={v.adminEmail} onChange={set("adminEmail")} autoComplete="email" />}</Field>
        <span className="hidden sm:block" />
        <Field label="Password" error={errors.password} hint="At least 12 characters.">{(a) => <Input {...a} type="password" value={v.password} onChange={set("password")} autoComplete="new-password" />}</Field>
        <Field label="Confirm password" error={errors.confirm}>{(a) => <Input {...a} type="password" value={v.confirm} onChange={set("confirm")} autoComplete="new-password" />}</Field>
      </div>
      <div>
        <Checkbox label="I agree to the Terms and the Privacy Policy" checked={agreed} onChange={setAgreed} />
        <p className="ml-8 text-sm text-[var(--muted)]">Read the <Link href="/terms" className="underline underline-offset-4">Terms</Link>, the <Link href="/privacy" className="underline underline-offset-4">Privacy Policy</Link> and the <Link href="/dpa" className="underline underline-offset-4">Data Processing Agreement</Link>.</p>
        {errors.acceptedTerms && <p className="ml-8 text-sm text-[var(--status-block)]">{errors.acceptedTerms}</p>}
      </div>
      {problem && <Notice tone="block">{problem}</Notice>}
      <Button type="submit" disabled={busy}>{busy ? "Registering…" : "Register my facility"}</Button>
    </form>
  );
}
