"use client";

// Where an invited person lands: read the facility's privacy notice, accept
// it, choose a password, and (for roles that need it) set up two-step
// sign-in before the first session starts.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { api, ApiError, type Session } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useResource } from "@/lib/useApi";
import { ROLE } from "@/lib/format";
import { PublicCard } from "@/components/PublicCard";
import { AuthenticatorSetup, RecoveryCodes, type PendingAuthenticator } from "@/components/TwoStep";
import { Button, Checkbox, Field, Input, Loading, Notice } from "@/components/ui";

interface Check {
  status: "ok" | "expired" | "used" | "invalid";
  facilityName?: string;
  fullName?: string | null;
  email?: string;
  role?: string;
  mfaRequired?: boolean;
  notice?: { version: string; body: string } | null;
}

type Stage = "form" | "enrol" | "codes";

function messageOf(err: unknown, fallback: string) {
  const body = err instanceof ApiError ? (err.body as { message?: string }) : undefined;
  return body?.message ?? fallback;
}

function InviteFlow() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const { adoptSession } = useAuth();
  const check = useResource<Check>(token ? `/api/invitations/check?token=${encodeURIComponent(token)}` : null);

  const [stage, setStage] = useState<Stage>("form");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; agree?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [enrolmentToken, setEnrolmentToken] = useState("");
  const [pending, setPending] = useState<PendingAuthenticator | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [codeError, setCodeError] = useState<string | undefined>();

  if (token && !check.data && !check.error) return <PublicCard title="Your invitation"><Loading label="Checking your invitation" /></PublicCard>;

  const c = check.data;
  if (!token || !c || c.status !== "ok" || !c.notice) {
    const text =
      c?.status === "expired"
        ? "This invitation has expired. Ask your facility admin to send you a new one."
        : c?.status === "used"
          ? "This invitation has already been used."
          : check.error && !c
            ? "The invitation could not be checked. Check your connection and open the link again."
            : "This invitation is not valid. It may have been cancelled or replaced, or the link was copied incompletely. Ask your facility admin for a new one.";
    return (
      <PublicCard title="Your invitation">
        <Notice tone="warning">{text}</Notice>
        <p className="mt-4 text-sm">
          <Link href="/login" className="inline-flex min-h-11 items-center text-[var(--accent-text)] underline-offset-4 hover:underline">
            Go to sign in
          </Link>
        </p>
      </PublicCard>
    );
  }
  const notice = c.notice;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!agreed) next.agree = "Confirm that you have read the privacy notice to continue.";
    if (password !== confirm) next.confirm = "The two passwords are not the same.";
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const res = await api.post<
        { next: "mfa_setup"; enrolmentToken: string } | ({ next: "signed_in" } & Session)
      >("/api/invitations/accept", { token, password, acceptedNoticeVersion: notice.version });
      if (res.next === "mfa_setup") {
        setEnrolmentToken(res.enrolmentToken);
        setPending(await api.post<PendingAuthenticator>("/api/auth/mfa/enrol/start", { enrolmentToken: res.enrolmentToken }));
        setStage("enrol");
      } else {
        adoptSession(res);
        router.replace("/dashboard");
      }
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { fields?: { password?: string }; message?: string }) : undefined;
      setErrors(
        body?.fields?.password
          ? { password: body.fields.password }
          : { form: messageOf(err, "Your account could not be created. Check your connection and try again.") }
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode(code: string) {
    setCodeError(undefined);
    setBusy(true);
    try {
      const res = await api.post<Session & { recoveryCodes: string[] }>("/api/auth/mfa/enrol/finish", {
        enrolmentToken,
        setupToken: pending?.setupToken,
        totp: code,
      });
      setSession(res);
      setCodes(res.recoveryCodes);
      setStage("codes");
    } catch (err) {
      setCodeError(messageOf(err, "That code was not accepted. Check the code on your phone and try again."));
    } finally {
      setBusy(false);
    }
  }

  if (stage === "enrol" && pending) {
    return (
      <PublicCard title="Set up two-step sign-in" wide>
        <p className="mb-6 text-[var(--muted)]">Your account has been created. The app shows a new code every 30 seconds, and you enter it with your email and password each time you sign in. This is done once.</p>
        <AuthenticatorSetup pending={pending} onConfirm={confirmCode} error={codeError} busy={busy} />
      </PublicCard>
    );
  }
  if (stage === "codes") {
    return (
      <PublicCard title="Save your recovery codes" wide>
        <RecoveryCodes
          codes={codes}
          doneLabel="Continue to HealthFlow"
          onDone={() => {
            if (session) adoptSession(session);
            router.replace("/dashboard");
          }}
        />
      </PublicCard>
    );
  }

  return (
    <PublicCard title={`Join ${c.facilityName}`} wide>
      <p className="text-[var(--muted)]">
        {c.fullName ? `${c.fullName}, you` : "You"} have been invited to HealthFlow as {ROLE[c.role ?? ""] ?? c.role}. You will sign in with{" "}
        <span className="font-medium text-[var(--foreground)]">{c.email}</span>.
      </p>
      <form onSubmit={submit} noValidate className="mt-5 space-y-5">
        <div>
          <h2 className="text-base font-semibold">Privacy notice</h2>
          <p className="text-sm text-[var(--muted)]">From {c.facilityName}, version {notice.version}. Read it before you continue.</p>
          <div
            tabIndex={0}
            role="region"
            aria-label="Privacy notice"
            className="mt-2 max-h-64 overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-3 text-[15px] leading-relaxed whitespace-pre-wrap"
          >
            {notice.body}
          </div>
          <div className="mt-2">
            <Checkbox label="I have read the privacy notice" checked={agreed} onChange={setAgreed} />
            {errors.agree && <p className="text-sm text-[var(--status-block)]">{errors.agree}</p>}
          </div>
        </div>
        <Field label="Choose a password" hint="At least 12 characters. A few ordinary words together works well." error={errors.password}>
          {(a) => <Input {...a} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Field label="Type it again" error={errors.confirm}>
          {(a) => <Input {...a} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        <p className="text-sm text-[var(--muted)]">Next you will set up an authenticator app on your phone. It gives you the code you need, with your email and password, every time you sign in.</p>
        {errors.form && <Notice tone="block">{errors.form}</Notice>}
        <Button type="submit" disabled={busy}>
          {busy ? "Creating your account…" : "Create my account"}
        </Button>
      </form>
    </PublicCard>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<PublicCard title="Your invitation"><Loading /></PublicCard>}>
      <InviteFlow />
    </Suspense>
  );
}
