"use client";

// A facility registers itself in four steps: its details and the administrator's
// account, a plan, the departments and cadres it works with, and then the staff
// access code. The administrator finishes by setting up an authenticator app.
import { AGENCIES } from "@/lib/agency";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, type Session } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AuthenticatorSetup, RecoveryCodes, type PendingAuthenticator } from "@/components/TwoStep";
import { Button, Checkbox, ErrorText, Field, Input, Loading, Notice, Select } from "@/components/ui";

const TYPES = [
  ["CHPS_COMPOUND", "CHPS compound"],
  ["HEALTH_CENTRE", "Health centre"],
  ["CLINIC", "Clinic"],
  ["POLYCLINIC", "Polyclinic"],
  ["HOSPITAL", "Hospital"],
  ["PRIVATE_HOSPITAL", "Private hospital"],
  ["REGIONAL_HOSPITAL", "Regional hospital"],
  ["TEACHING_HOSPITAL", "Teaching hospital"],
] as const;

interface Plan { id: string; name: string; monthlyPriceGhs: number; setupPriceGhs: number | null; staffBandMin: number | null; staffBandMax: number | null; features: string[] }
interface Options { departments: string[]; cadres: string[]; plans: Plan[] }
interface Done { facilityName: string; code: string; joinUrl: string; enrolmentToken: string }
type Step = 1 | 2 | 3 | "code" | "enrol" | "codes";

const cedi = (n: number) => `GH₵ ${n.toLocaleString("en-GH", { maximumFractionDigits: 0 })}`;
const STEP_OF: Record<string, 1 | 2 | 3> = { facilityName: 1, facilityType: 1, region: 1, adminName: 1, adminPhone: 1, adminEmail: 1, password: 1, acceptedTerms: 1, planId: 2, departments: 3, cadres: 3 };

function ChooseMany({ legend, items, chosen, onChange, extra, error }: { legend: string; items: string[]; chosen: string[]; onChange: (v: string[]) => void; extra: string; error?: string }) {
  const [typed, setTyped] = useState("");
  const all = [...items, ...chosen.filter((c) => !items.includes(c))];
  return (
    <fieldset>
      <legend className="text-base font-semibold">{legend}</legend>
      <div className="mt-1 flex flex-wrap gap-2 text-sm">
        <button type="button" className="min-h-11 underline underline-offset-4" onClick={() => onChange(all)}>Select all</button>
        <button type="button" className="min-h-11 underline underline-offset-4" onClick={() => onChange([])}>Clear</button>
        <span className="flex min-h-11 items-center text-[var(--muted)]">{chosen.length} chosen</span>
      </div>
      <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
        {all.map((n) => (
          <Checkbox key={n} label={n} checked={chosen.includes(n)} onChange={(on) => onChange(on ? [...chosen, n] : chosen.filter((c) => c !== n))} />
        ))}
      </div>
      <div className="mt-2 flex max-w-md items-end gap-2">
        <div className="flex-1"><Field label={extra}>{(a) => <Input {...a} value={typed} onChange={(e) => setTyped(e.target.value)} />}</Field></div>
        <Button type="button" variant="secondary" disabled={!typed.trim()} onClick={() => { const t = typed.trim(); if (!all.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...chosen, t]); setTyped(""); }}>Add</Button>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
    </fieldset>
  );
}

/** A facility registers itself and leaves with a staff access code. */
export function FacilityRegisterForm() {
  const router = useRouter();
  const { adoptSession } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [v, setV] = useState({ agency: "", facilityName: "", facilityType: "", region: "", districtText: "", adminName: "", adminEmail: "", adminPhone: "", password: "", confirm: "" });
  const [districtId, setDistrictId] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [districts, setDistricts] = useState<{ id: string; name: string; region: string }[] | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [planId, setPlanId] = useState("");
  const [departments, setDepartments] = useState<string[] | null>(null);
  const [cadres, setCadres] = useState<string[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<PendingAuthenticator | null>(null);
  const [session, setSession] = useState<(Session & { recoveryCodes: string[] }) | null>(null);
  const [codeError, setCodeError] = useState<string | undefined>();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  useEffect(() => {
    let live = true;
    if (!v.agency) return () => { live = false; };
    api.get<{ districts: { id: string; name: string; region: string }[] }>(`/api/public/districts?agency=${v.agency}`).then((r) => live && setDistricts(r.districts)).catch(() => live && setDistricts([]));
    return () => { live = false; };
  }, [v.agency]);
  // The departments and cadres on offer depend on the type of facility, so they are fetched again when the type changes.
  useEffect(() => {
    let live = true;
    api.get<Options>(`/api/public/register-facility/options${v.facilityType ? `?type=${encodeURIComponent(v.facilityType)}` : ""}`).then((o) => { if (live) { setOptions(o); setDepartments(o.departments); setCadres(o.cadres); setPlanId((p) => (o.plans.some((x) => x.id === p) ? p : o.plans.length === 1 ? o.plans[0].id : "")); } }).catch(() => live && setProblem("The form could not load. Check your connection and refresh the page."));
    return () => { live = false; };
  }, [v.facilityType]);
  const listed = districts !== null && districts.length > 0;
  const other = districtId === "other";

  function next1() {
    const e: Record<string, string> = {};
    if (!v.agency) e.agency = "Choose who runs the facility.";
    if (!v.facilityName.trim()) e.facilityName = "Enter the facility name.";
    if (!v.facilityType) e.facilityType = "Choose the type of facility.";
    if (!v.region.trim()) e.region = "Enter the region.";
    if (!v.adminName.trim()) e.adminName = "Enter your name.";
    if (!v.adminPhone.trim()) e.adminPhone = "Enter your phone number.";
    if (!/^\S+@\S+\.\S+$/.test(v.adminEmail.trim())) e.adminEmail = "Enter an email address you can open.";
    if (v.password.length < 12) e.password = "Use at least 12 characters.";
    if (v.password !== v.confirm) e.confirm = "The two passwords do not match.";
    if (!agreed) e.acceptedTerms = "Agree to the Terms and the Privacy Policy to continue.";
    setErrors(e);
    if (Object.keys(e).length === 0) setStep(options && options.plans.length === 0 ? 3 : 2);
  }

  async function submit() {
    if (!options) return;
    setProblem(null);
    setErrors({});
    if (options.plans.length > 0 && !planId) { setStep(2); return setErrors({ planId: "Choose a plan." }); }
    setBusy(true);
    try {
      const res = await api.post<Done>("/api/public/register-facility", {
        agency: v.agency, facilityName: v.facilityName, facilityType: v.facilityType, region: v.region, districtId: districtId && !other ? districtId : undefined,
        districtText: v.districtText || undefined, adminName: v.adminName, adminEmail: v.adminEmail, adminPhone: v.adminPhone, password: v.password, acceptedTerms: true,
        planId: planId || undefined, departments: departments ?? [], cadres: cadres ?? [],
      });
      setDone(res);
      setStep("code");
    } catch (err) {
      const b = err instanceof ApiError ? (err.body as { fields?: Record<string, string>; message?: string }) : undefined;
      if (b?.fields) {
        setErrors(b.fields);
        const first = Object.keys(b.fields).map((k) => STEP_OF[k]).filter(Boolean).sort()[0];
        if (first) setStep(first);
      } else {
        setProblem(b?.message ?? "That did not go through. Check your connection and try again, or call 055 457 1800.");
        if (err instanceof ApiError && (err.body as { error?: string } | undefined)?.error?.match(/email_taken|facility_exists/)) setStep(1);
      }
    } finally {
      setBusy(false);
    }
  }

  async function startAuthenticator() {
    if (!done) return;
    setBusy(true);
    setCodeError(undefined);
    try {
      setPending(await api.post<PendingAuthenticator>("/api/auth/mfa/enrol/start", { enrolmentToken: done.enrolmentToken }));
      setStep("enrol");
    } catch {
      setProblem("Two-step setup could not start. You can set it up when you sign in.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode(code: string) {
    if (!done || !pending) return;
    setCodeError(undefined);
    setBusy(true);
    try {
      const res = await api.post<Session & { recoveryCodes: string[] }>("/api/auth/mfa/enrol/finish", { enrolmentToken: done.enrolmentToken, setupToken: pending.setupToken, totp: code });
      setSession(res);
      setStep("codes");
    } catch (err) {
      const b = err instanceof ApiError ? (err.body as { message?: string }) : undefined;
      setCodeError(b?.message ?? "That code was not accepted. Check the code in your authenticator app and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!options && !problem) return <Loading label="Loading the form" />;

  if (step === "code" && done) {
    const message = `Join ${done.facilityName} on HealthFlow. Open ${done.joinUrl} or go to the HealthFlow site, choose "Join with your facility code" and enter ${done.code}.`;
    return (
      <div className="space-y-5">
        <Notice tone="success"><strong className="block">{done.facilityName} is registered and waiting for approval.</strong>PS Tech checks each new facility and may telephone you. Your 30 day trial starts when it is approved, and we will email you. Staff can use this code after that. It is also under Staff, Access code.</Notice>
        <div>
          <p className="text-sm text-[var(--muted)]">Your staff access code</p>
          <p className="figures text-3xl font-semibold tracking-wide" aria-label={`Access code ${done.code.split("").join(" ")}`}>{done.code}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(done.code).then(() => setCopied(true), () => setCopied(false))}>{copied ? "Copied" : "Copy code"}</Button>
            <a className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-4 text-sm font-medium" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>
          </div>
        </div>
        <div className="border-t border-[var(--border)] pt-4">
          <h2 className="text-base font-semibold">One last step: protect your account</h2>
          <p className="mt-1 text-[15px] text-[var(--muted)]">You sign in with a code from an authenticator app. Set it up once.</p>
          {problem && <div className="mt-2"><Notice tone="warning">{problem}</Notice></div>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={busy} onClick={startAuthenticator}>{busy ? "Starting…" : "Set up my authenticator"}</Button>
            <Link href="/login" className="inline-flex min-h-11 items-center px-2 text-sm underline underline-offset-4">Do it later at sign-in</Link>
          </div>
        </div>
        <p className="text-sm text-[var(--muted)]">Your 30 day trial has started. PS Tech will contact you. Help: 055 457 1800 or 024 618 7422.</p>
      </div>
    );
  }
  if (step === "enrol" && pending) {
    return (
      <div>
        <p className="mb-6 text-[var(--muted)]">In your authenticator app, scan the square or type the key. Enter the 6-digit code it shows.</p>
        <AuthenticatorSetup pending={pending} onConfirm={confirmCode} error={codeError} busy={busy} />
      </div>
    );
  }
  if (step === "codes" && session) {
    return (
      <RecoveryCodes
        codes={session.recoveryCodes}
        doneLabel="Continue to HealthFlow"
        onDone={() => { adoptSession(session); router.replace("/dashboard"); }}
      />
    );
  }

  const stepNames = ["Your facility", "Plan", "Departments and cadres"];
  const shown = step === 1 ? 1 : step === 2 ? 2 : 3;
  return (
    <div>
      <ol className="mb-5 flex flex-wrap gap-x-6 gap-y-1 text-sm" aria-label="Steps">
        {stepNames.map((n, i) => (
          <li key={n} aria-current={shown === i + 1 ? "step" : undefined} className={shown === i + 1 ? "font-semibold" : "text-[var(--muted)]"}>{i + 1}. {n}</li>
        ))}
      </ol>

      {step === 1 && (
        <form onSubmit={(e) => { e.preventDefault(); next1(); }} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Registered under" error={errors.agency} hint="Your supervising office is the one under the same agency.">
              {(a) => (
                <Select {...a} value={v.agency} onChange={(e) => { setV({ ...v, agency: e.target.value }); setDistrictId(""); setDistricts(null); }}>
                  <option value="">Choose</option>
                  {AGENCIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              )}
            </Field>
            <span className="hidden sm:block" />
            <Field label="Facility name" error={errors.facilityName}>{(a) => <Input {...a} value={v.facilityName} onChange={set("facilityName")} autoComplete="organization" />}</Field>
            <Field label="Type of facility" error={errors.facilityType}>
              {(a) => (
                <Select {...a} value={v.facilityType} onChange={set("facilityType")}>
                  <option value="">Choose</option>
                  {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              )}
            </Field>
            {listed ? (
              <Field label="District" optional hint="Your facility appears under this district once you register.">
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
            <Field label="Region" error={errors.region}>{(a) => <Input {...a} value={v.region} onChange={set("region")} />}</Field>
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
          <Button type="submit">Next: choose a plan</Button>
        </form>
      )}

      {step === 2 && options && (
        <div className="space-y-4">
          <fieldset>
            <legend className="text-base font-semibold">Choose a plan</legend>
            <p className="text-sm text-[var(--muted)]">Free 30 day trial. No charge to register.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {options.plans.map((p) => (
                <label key={p.id} className={`block cursor-pointer rounded-[var(--radius)] border p-4 ${planId === p.id ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)]"}`}>
                  <span className="flex items-start gap-3">
                    <input type="radio" name="plan" className="mt-1 h-5 w-5" checked={planId === p.id} onChange={() => setPlanId(p.id)} />
                    <span>
                      <span className="block font-semibold">{p.name}</span>
                      <span className="figures block">{cedi(p.monthlyPriceGhs)} a month{p.setupPriceGhs ? `, ${cedi(p.setupPriceGhs)} to set up` : ""}</span>
                      {(p.staffBandMin !== null || p.staffBandMax !== null) && <span className="block text-sm text-[var(--muted)]">For {p.staffBandMin ?? 1} to {p.staffBandMax ?? "any number of"} staff</span>}
                      {p.features.length > 0 && <ul className="mt-1 list-disc pl-5 text-sm text-[var(--muted)]">{p.features.map((f) => <li key={f}>{f}</li>)}</ul>}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {errors.planId && <ErrorText>{errors.planId}</ErrorText>}
          </fieldset>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
            <Button onClick={() => (planId ? (setErrors({}), setStep(3)) : setErrors({ planId: "Choose a plan." }))}>Next: departments and cadres</Button>
          </div>
        </div>
      )}

      {step === 3 && options && departments && cadres && (
        <div className="space-y-6">
          <p className="text-[15px] text-[var(--muted)]">Tick your departments and cadres. You can change them later.</p>
          <ChooseMany legend="Departments" items={options.departments} chosen={departments} onChange={setDepartments} extra="Add a department that is not listed" error={errors.departments} />
          <ChooseMany legend="Cadres" items={options.cadres} chosen={cadres} onChange={setCadres} extra="Add a cadre that is not listed" error={errors.cadres} />
          {problem && <Notice tone="block">{problem}</Notice>}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep(options.plans.length ? 2 : 1)}>Back</Button>
            <Button disabled={busy || departments.length === 0 || cadres.length === 0} onClick={submit}>{busy ? "Registering…" : "Register my facility"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
