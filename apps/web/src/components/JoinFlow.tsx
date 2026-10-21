"use client";

// Staff register themselves with the facility's access code: the code, then
// name, email and a password, and the privacy notice. Nothing else.
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { PublicCard } from "@/components/PublicCard";
import { Button, Checkbox, ErrorText, Field, Input, Loading, Notice, Select } from "@/components/ui";

interface Facility {
  facilityName: string;
  cadres: { id: string; name: string }[];
  departments: { id: string; name: string; kind?: "WARD" | "SUPPORT" | "OFFICE" }[];
  /** Hospitals roster by ward: everyone names their ward, and says if they are its in-charge. */
  byWard?: boolean;
}
type Step = "code" | "details" | "done";
type Fields = Record<string, string | undefined>;

const OTHER = "__other";

function problem(err: unknown, fallback: string): { message: string; fields: Fields } {
  const b = err instanceof ApiError ? (err.body as { message?: string; fields?: Fields } | undefined) : undefined;
  return { message: b?.message ?? fallback, fields: b?.fields ?? {} };
}

export function JoinFlow({ initialCode }: { initialCode?: string }) {
  const [step, setStep] = useState<Step>("code");
  const [code, setCode] = useState(initialCode ?? "");
  const [facility, setFacility] = useState<Facility | null>(null);
  const [checking, setChecking] = useState(Boolean(initialCode));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Fields>({});
  const [notice, setNotice] = useState<{ version: string; body: string } | null>(null);
  const [form, setForm] = useState({ fullName: "", email: "", password: "", confirm: "", staffNo: "", phone: "", cadre: "", cadreText: "", department: "", departmentText: "", as: "staff", grade: "" });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [agreed, setAgreed] = useState(false);
  const [result, setResult] = useState<{ status: "pending" | "active" } | null>(null);

  async function open(c: string) {
    const clean = encodeURIComponent(c.trim());
    const [f, n] = await Promise.all([
      api.get<Facility>(`/api/public/join/${clean}`),
      api.get<{ notice: { version: string; body: string } | null }>(`/api/public/join/${clean}/notice`),
    ]);
    setFacility(f);
    setNotice(n.notice);
    setStep("details");
  }

  async function lookUp(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await open(code);
    } catch (err) {
      setError(problem(err, "The code could not be checked. Check your connection and try again.").message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!initialCode) return;
    const clean = encodeURIComponent(initialCode.trim());
    Promise.all([api.get<Facility>(`/api/public/join/${clean}`), api.get<{ notice: { version: string; body: string } | null }>(`/api/public/join/${clean}/notice`)])
      .then(([f, n]) => {
        setFacility(f);
        setNotice(n.notice);
        setStep("details");
      })
      .catch((err) => setError(problem(err, "The code could not be checked. Check your connection and try again.").message))
      .finally(() => setChecking(false));
  }, [initialCode]);

  // In a hospital, "I am registering as" picks ward staff, a ward in-charge, or a unit such as Security or Drivers.
  const unitId = form.as.startsWith("unit:") ? form.as.slice(5) : null;
  const wardList = facility?.byWard ? facility.departments.filter((d) => (d.kind ?? "WARD") === "WARD") : facility?.departments ?? [];
  const units = facility?.byWard ? facility.departments.filter((d) => d.kind && d.kind !== "WARD") : [];

  async function finish(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFields({});
    if (!notice) return setError("This facility has not published its privacy notice yet. Ask your in-charge.");
    if (!form.grade) return setFields({ grade: "Choose your grade." });
    if (form.password !== form.confirm) return setFields({ confirm: "The two passwords are not the same." });
    if (!agreed) return setFields({ agree: "Confirm that you have read the privacy notice to continue." });
    setBusy(true);
    try {
      const res = await api.post<{ status: "pending" | "active" }>("/api/public/join/register", {
        code,
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        acceptedNoticeVersion: notice.version,
        staffNo: form.staffNo || null,
        phone: form.phone || null,
        cadreId: !unitId && form.cadre && form.cadre !== OTHER ? form.cadre : null,
        cadreText: !unitId && form.cadre === OTHER ? form.cadreText : null,
        departmentId: unitId ?? (form.department && form.department !== OTHER ? form.department : null),
        departmentText: !unitId && form.department === OTHER ? form.departmentText : null,
        asInCharge: Boolean(facility?.byWard) && form.as === "incharge",
        leaveGrade: form.grade,
      });
      setResult(res);
      setStep("done");
    } catch (err) {
      const p = problem(err, "Your account could not be created. Check your connection and try again.");
      setFields(p.fields);
      setError(Object.keys(p.fields).length ? null : p.message);
    } finally {
      setBusy(false);
    }
  }

  if (checking) return <PublicCard title="Join your facility"><Loading label="Checking the code" /></PublicCard>;

  if (step === "code") {
    return (
      <PublicCard title="Join your facility">
        <p className="mb-4 text-[var(--muted)]">Ask your in-charge for the facility code. It looks like HF-FX8W8U.</p>
        <form onSubmit={lookUp} noValidate className="space-y-4">
          <Field label="Facility code">{(a) => <Input {...a} className="figures uppercase" autoComplete="off" autoCapitalize="characters" value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
          {error && <ErrorText>{error}</ErrorText>}
          <Button type="submit" className="w-full" disabled={busy || !code.trim()}>{busy ? "Checking…" : "Continue"}</Button>
        </form>
        <p className="mt-4 text-sm"><Link href="/login" className="inline-flex min-h-11 items-center text-[var(--accent-text)] underline underline-offset-4">Already have an account? Sign in</Link></p>
      </PublicCard>
    );
  }

  if (step === "details" && facility) {
    return (
      <PublicCard title={`Join ${facility.facilityName}`} wide>
        <form onSubmit={finish} noValidate className="space-y-4">
          {facility.byWard && (
            <Field label="I am registering as" hint={form.as === "incharge" ? "The administrator approves in-charges." : undefined}>
              {(a) => (
                <Select {...a} value={form.as} onChange={(e) => set("as", e.target.value)}>
                  <option value="staff">Ward staff</option>
                  <option value="incharge">Ward in-charge</option>
                  {units.map((d) => <option key={d.id} value={`unit:${d.id}`}>{d.name.replace(/(er)s$/i, "$1")}</option>)}
                </Select>
              )}
            </Field>
          )}
          <Field label="Full name" error={fields.fullName}>{(a) => <Input {...a} autoComplete="name" value={form.fullName} onChange={(e) => set("fullName", e.target.value)} />}</Field>
          <Field label="Email" error={fields.email} hint="You sign in with this.">{(a) => <Input {...a} type="email" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} />}</Field>
          <Field label="Password" error={fields.password} hint="At least 12 characters.">{(a) => <Input {...a} type="password" autoComplete="new-password" value={form.password} onChange={(e) => set("password", e.target.value)} />}</Field>
          <Field label="Confirm password" error={fields.confirm}>{(a) => <Input {...a} type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => set("confirm", e.target.value)} />}</Field>
          <Field label="Your grade" error={fields.grade} hint="Gives your yearly leave days: senior staff 36 working days, junior staff 28.">
            {(a) => (
              <Select {...a} value={form.grade} onChange={(e) => set("grade", e.target.value)}>
                <option value="">Choose</option>
                <option value="SENIOR">Senior staff</option>
                <option value="JUNIOR">Junior staff</option>
              </Select>
            )}
          </Field>
          <Field label="Staff number" optional error={fields.staffNo}>{(a) => <Input {...a} autoComplete="off" value={form.staffNo} onChange={(e) => set("staffNo", e.target.value)} />}</Field>
          <Field label="Mobile phone number" optional error={fields.phone} hint="For text messages about your duties, if your facility uses them.">
            {(a) => <Input {...a} type="tel" autoComplete="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />}
          </Field>
          {!unitId && (<>
          <Field label="Cadre" optional error={fields.cadreId}>
            {(a) => (
              <Select {...a} value={form.cadre} onChange={(e) => set("cadre", e.target.value)}>
                <option value="">Choose</option>
                {facility.cadres.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value={OTHER}>Not in the list</option>
              </Select>
            )}
          </Field>
          {form.cadre === OTHER && <Field label="Your cadre">{(a) => <Input {...a} value={form.cadreText} onChange={(e) => set("cadreText", e.target.value)} />}</Field>}
          <Field label={facility.byWard ? "Ward" : "Department or ward"} optional={!facility.byWard} error={fields.departmentId}>
            {(a) => (
              <Select {...a} value={form.department} onChange={(e) => set("department", e.target.value)}>
                <option value="">Choose</option>
                {wardList.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                {(!facility.byWard || wardList.length === 0) && <option value={OTHER}>Not in the list</option>}
              </Select>
            )}
          </Field>
          {form.department === OTHER && <Field label="Your department or ward">{(a) => <Input {...a} value={form.departmentText} onChange={(e) => set("departmentText", e.target.value)} />}</Field>}
          </>)}
          <div>
            <h2 className="text-base font-semibold">Privacy notice</h2>
            {notice ? (
              <div tabIndex={0} role="region" aria-label="Privacy notice" className="mt-2 max-h-56 overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-3 text-[15px] leading-relaxed whitespace-pre-wrap">{notice.body}</div>
            ) : (
              <div className="mt-2"><Notice tone="warning">This facility has not published its privacy notice yet. Ask your in-charge.</Notice></div>
            )}
            <div className="mt-3"><Checkbox label="I have read the privacy notice" checked={agreed} onChange={setAgreed} /></div>
            {fields.agree && <ErrorText>{fields.agree}</ErrorText>}
          </div>
          {error && <ErrorText>{error}</ErrorText>}
          <Button type="submit" className="w-full" disabled={busy || !notice}>{busy ? "Creating…" : "Create my account"}</Button>
        </form>
      </PublicCard>
    );
  }

  return (
    <PublicCard title={result?.status === "active" ? "You are in" : "Thank you"}>
      {result?.status === "active" ? (
        <>
          <p className="text-[var(--muted)]">Your account is ready. Sign in with {form.email} and the password you chose.</p>
          <p className="mt-4"><Link href="/login" className="inline-flex min-h-11 items-center text-[var(--accent-text)] underline underline-offset-4">Go to sign in</Link></p>
        </>
      ) : (
        <p className="text-[var(--muted)]">{facility?.byWard && form.as !== "staff" ? (form.as === "incharge" ? "The administrator has been told and will approve you as in-charge." : "The administrator has been told and will approve your account.") : "Your in-charge has been told and will approve your account."} Once they do, sign in with {form.email} and the password you chose.</p>
      )}
    </PublicCard>
  );
}
