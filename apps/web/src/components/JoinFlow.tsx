"use client";

// Staff register themselves with the facility's access code. Code, details,
// a text to their phone, a password, then waiting for the in-charge.
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { PublicCard } from "@/components/PublicCard";
import { Button, Checkbox, ErrorText, Field, Input, Loading, Notice, Select } from "@/components/ui";

interface Facility {
  facilityName: string;
  cadres: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  phoneCheck: boolean;
}
type Step = "code" | "details" | "verify" | "password" | "done";
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

  const [form, setForm] = useState({ fullName: "", staffNo: "", phone: "", email: "", cadre: "", cadreText: "", department: "", departmentText: "", position: "" });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [token, setToken] = useState("");
  const [ending, setEnding] = useState("");
  const [verifyMethod, setVerifyMethod] = useState<"SMS" | "NONE">("NONE");
  const [sms, setSms] = useState("");
  const [notice, setNotice] = useState<{ version: string; body: string } | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [result, setResult] = useState<{ status: "pending" | "active"; signInWith: string } | null>(null);

  async function lookUp(c: string) {
    setBusy(true);
    setError(null);
    try {
      const f = await api.get<Facility>(`/api/public/join/${encodeURIComponent(c.trim())}`);
      setFacility(f);
      setStep("details");
    } catch (err) {
      setError(problem(err, "The code could not be checked. Check your connection and try again.").message);
    } finally {
      setBusy(false);
      setChecking(false);
    }
  }

  useEffect(() => {
    if (!initialCode) return;
    api
      .get<Facility>(`/api/public/join/${encodeURIComponent(initialCode.trim())}`)
      .then((f) => {
        setFacility(f);
        setStep("details");
      })
      .catch((err) => setError(problem(err, "The code could not be checked. Check your connection and try again.").message))
      .finally(() => setChecking(false));
  }, [initialCode]);

  async function sendDetails(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const res = await api.post<{ token: string; verifyMethod: "SMS" | "NONE"; phoneEnding: string }>("/api/public/join", {
        code,
        fullName: form.fullName,
        staffNo: form.staffNo,
        phone: form.phone,
        email: form.email || null,
        cadreId: form.cadre && form.cadre !== OTHER ? form.cadre : null,
        cadreText: form.cadre === OTHER ? form.cadreText : null,
        departmentId: form.department && form.department !== OTHER ? form.department : null,
        departmentText: form.department === OTHER ? form.departmentText : null,
        position: form.position || null,
      });
      setToken(res.token);
      setEnding(res.phoneEnding);
      setVerifyMethod(res.verifyMethod);
      if (res.verifyMethod === "SMS") setStep("verify");
      else await toPassword();
    } catch (err) {
      const p = problem(err, "Your details could not be sent. Check your connection and try again.");
      setFields(p.fields);
      setError(Object.keys(p.fields).length ? "Check the fields marked below." : p.message);
    } finally {
      setBusy(false);
    }
  }

  async function toPassword() {
    try {
      const n = await api.get<{ notice: { version: string; body: string } | null }>(`/api/public/join/${encodeURIComponent(code)}/notice`);
      setNotice(n.notice);
    } catch {
      setNotice(null);
    }
    setStep("password");
  }

  async function checkSms(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/public/join/verify", { token, code: sms });
      await toPassword();
    } catch (err) {
      setError(problem(err, "The code could not be checked. Try again.").message);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      await api.post("/api/public/join/resend", { token });
      setError("A new code has been sent.");
    } catch (err) {
      setError(problem(err, "The code could not be sent. Try again in a minute.").message);
    }
  }

  async function finish(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFields({});
    if (!notice) return setError("This facility has not published its privacy notice yet. Ask your in-charge.");
    if (!agreed) return setFields({ agree: "Confirm that you have read the privacy notice to continue." });
    if (password !== confirm) return setFields({ confirm: "The two passwords are not the same." });
    setBusy(true);
    try {
      const res = await api.post<{ status: "pending" | "active"; signInWith: string }>("/api/public/join/complete", { token, password, acceptedNoticeVersion: notice.version });
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
        <p className="mb-4 text-[var(--muted)]">Ask your in-charge for the facility code. It looks like SOMBO-4K2P.</p>
        <form onSubmit={(e) => { e.preventDefault(); void lookUp(code); }} noValidate className="space-y-4">
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
        <form onSubmit={sendDetails} noValidate className="space-y-4">
          <Field label="Full name" error={fields.fullName}>{(a) => <Input {...a} autoComplete="name" value={form.fullName} onChange={(e) => set("fullName", e.target.value)} />}</Field>
          <Field label="Staff number" error={fields.staffNo}>{(a) => <Input {...a} autoComplete="off" value={form.staffNo} onChange={(e) => set("staffNo", e.target.value)} />}</Field>
          <Field label="Mobile phone number" error={fields.phone} hint={facility.phoneCheck ? "We send a code to this number to check it is yours." : "You sign in with this number."}>
            {(a) => <Input {...a} type="tel" autoComplete="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />}
          </Field>
          <Field label="Email" optional error={fields.email} hint="If you add one, you sign in with it and can reset your password by email.">
            {(a) => <Input {...a} type="email" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} />}
          </Field>
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
          <Field label="Department or ward" optional error={fields.departmentId}>
            {(a) => (
              <Select {...a} value={form.department} onChange={(e) => set("department", e.target.value)}>
                <option value="">Choose</option>
                {facility.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                <option value={OTHER}>Not in the list</option>
              </Select>
            )}
          </Field>
          {form.department === OTHER && <Field label="Your department or ward">{(a) => <Input {...a} value={form.departmentText} onChange={(e) => set("departmentText", e.target.value)} />}</Field>}
          {error && <ErrorText>{error}</ErrorText>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Sending…" : "Continue"}</Button>
        </form>
      </PublicCard>
    );
  }

  if (step === "verify") {
    return (
      <PublicCard title="Check your phone">
        <p className="mb-4 text-[var(--muted)]">We sent a 6-digit code to the number ending {ending}. It works for 10 minutes.</p>
        <form onSubmit={checkSms} noValidate className="space-y-4">
          <Field label="Code">{(a) => <Input {...a} className="figures" inputMode="numeric" autoComplete="one-time-code" autoFocus value={sms} onChange={(e) => setSms(e.target.value)} />}</Field>
          {error && <ErrorText>{error}</ErrorText>}
          <Button type="submit" className="w-full" disabled={busy || !sms.trim()}>{busy ? "Checking…" : "Verify"}</Button>
        </form>
        <button type="button" onClick={resend} className="mt-3 inline-flex min-h-11 items-center text-sm text-[var(--accent-text)] underline underline-offset-4">Send the code again</button>
      </PublicCard>
    );
  }

  if (step === "password") {
    return (
      <PublicCard title="Choose a password" wide>
        {verifyMethod === "NONE" && <div className="mb-4"><Notice tone="warning">We could not check your phone number, so your in-charge will approve you by hand.</Notice></div>}
        <form onSubmit={finish} noValidate className="space-y-4">
          <Field label="Password" error={fields.password} hint="At least 12 characters.">{(a) => <Input {...a} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          <Field label="Confirm password" error={fields.confirm}>{(a) => <Input {...a} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}</Field>
          <div>
            <h2 className="text-base font-semibold">Privacy notice</h2>
            {notice ? (
              <div tabIndex={0} role="region" aria-label="Privacy notice" className="mt-2 max-h-56 overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-3 text-[15px] leading-relaxed whitespace-pre-wrap">{notice.body}</div>
            ) : (
              <Notice tone="warning">This facility has not published its privacy notice yet. Ask your in-charge.</Notice>
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
          <p className="text-[var(--muted)]">Your account is ready. Sign in with {result.signInWith}.</p>
          <p className="mt-4"><Link href="/login" className="inline-flex min-h-11 items-center text-[var(--accent-text)] underline underline-offset-4">Go to sign in</Link></p>
        </>
      ) : (
        <p className="text-[var(--muted)]">Your in-charge has been told and will approve your account. Sign in with {result?.signInWith} once you hear from them{verifyMethod === "SMS" ? ", we will send you a text message" : ""}.</p>
      )}
    </PublicCard>
  );
}
