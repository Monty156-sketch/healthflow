"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api, ApiError, type Session } from "@/lib/api";
import { Button, Card, ErrorText, Field, Input, Notice } from "@/components/ui";
import { AuthenticatorSetup, RecoveryCodes, type PendingAuthenticator } from "@/components/TwoStep";

const NOTICES: Record<string, { tone: "neutral" | "success"; text: string }> = {
  idle: { tone: "neutral", text: "You were signed out after 30 minutes without activity." },
  expired: { tone: "neutral", text: "Your session ended. Sign in again to continue." },
  reset: { tone: "success", text: "Your password has been changed. Sign in with your new password." },
};

/** Says why the person is on this page, when something sent them here. */
function ArrivalNotice() {
  const reason = useSearchParams().get("reason");
  const notice = reason ? NOTICES[reason] : undefined;
  if (!notice) return null;
  return (
    <div className="mb-4">
      <Notice tone={notice.tone}>{notice.text}</Notice>
    </div>
  );
}

type Stage = "credentials" | "code" | "enrol" | "codes";

export type Audience = "facility" | "district" | "platform";

/** Where each kind of account starts. */
const HOME: Record<Audience, string> = { facility: "/dashboard", district: "/district", platform: "/platform" };
const homeFor = (role: string): string => (role === "PLATFORM_ADMIN" ? HOME.platform : role === "DISTRICT_OFFICER" ? HOME.district : HOME.facility);

const DOOR_NAME: Record<string, string> = { "/login": "the facility sign-in", "/district/login": "the supervisor sign-in", "/platform/login": "the platform sign-in" };

function messageFor(err: unknown): string {
  if (!(err instanceof ApiError)) return "No connection. Check your internet and try again.";
  if (err.status >= 500) return "The server had a problem signing you in. Try again in a minute.";
  switch (err.message) {
    case "too_many_attempts":
      return "Too many sign-in attempts from this connection. Wait 15 minutes, then try again.";
    case "account_locked":
      return "Too many failed attempts. The account is locked for 15 minutes.";
    case "invalid_mfa":
    case "invalid_code":
      return "That code didn't match. Check the time on your phone and use the newest code.";
    case "account_inactive":
      return "This account is not active. Contact your facility admin.";
    case "account_pending":
      return "Your in-charge has not approved your account yet. You will get a text message when it is approved.";
    case "district_pending":
      return "Your registration is waiting for approval. We will email you as soon as it is approved.";
    case "district_declined":
      return "This registration was not approved. Call 055 457 1800 to talk to us.";
    case "wrong_door": {
      const to = (err.body as { goTo?: string } | undefined)?.goTo ?? "/login";
      return `This account does not sign in on this page. Use ${DOOR_NAME[to] ?? "the right sign-in"} at ${to}.`;
    }
    case "enrolment_expired":
      return "Setup took too long. Enter your password again to restart it.";
    default:
      return "Incorrect email or password.";
  }
}

const COPY: Record<Audience, { title: string; line: string; body: string; tag: string | null }> = {
  facility: {
    title: "Sign in",
    line: "Fair duty rosters, built on your own rules.",
    body: "Built from your own shifts and rules, checked against the Labour Act before it is published, and printed on the A4 sheet your staff already read.",
    tag: null,
  },
  district: {
    title: "Supervisor sign-in",
    line: "See staffing across your district or region.",
    body: "Coverage, establishment and leave for the facilities that have chosen to share them with your office. Read only, and only what each facility has granted.",
    tag: "Supervisors",
  },
  platform: {
    title: "Platform sign-in",
    line: "HealthFlow platform console.",
    body: "For PS Tech administrators. Facility data is reached only through a logged support session.",
    tag: "Platform console",
  },
};

export function SignInScreen({ audience }: { audience: Audience }) {
  const copy = COPY[audience];
  const { login, user, loading, adoptSession } = useAuth();
  const router = useRouter();

  const [stage, setStage] = useState<Stage>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [enrolmentToken, setEnrolmentToken] = useState("");
  const [pending, setPending] = useState<PendingAuthenticator | null>(null);
  const [newCodes, setNewCodes] = useState<string[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in (for example, after a refresh): skip the form. Not
  // while recovery codes are on screen: they must be saved first.
  useEffect(() => {
    if (!loading && user && stage !== "codes") router.replace(homeFor(user.role));
  }, [loading, user, router, stage]);

  async function beginEnrolment(token: string) {
    setEnrolmentToken(token);
    const p = await api.post<PendingAuthenticator>("/api/auth/mfa/enrol/start", { enrolmentToken: token });
    setPending(p);
    setStage("enrol");
  }

  async function handleSignIn(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const mfa = stage === "code" ? (useRecovery ? { recoveryCode } : { totp }) : undefined;
      const result = await login(email, password, mfa, audience);
      if (result.mfaRequired) setStage("code");
      else router.push(HOME[audience]);
    } catch (err) {
      if (err instanceof ApiError && err.message === "mfa_setup_required") {
        const token = (err.body as { enrolmentToken?: string }).enrolmentToken;
        try {
          if (token) await beginEnrolment(token);
        } catch (e2) {
          setError(messageFor(e2));
        }
      } else {
        setError(messageFor(err));
        if (stage === "code") {
          setTotp("");
          setRecoveryCode("");
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmEnrolment(code: string) {
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post<Session & { recoveryCodes: string[] }>("/api/auth/mfa/enrol/finish", {
        enrolmentToken,
        setupToken: pending?.setupToken,
        totp: code,
      });
      setSession(res);
      setNewCodes(res.recoveryCodes);
      setStage("codes");
    } catch (err) {
      setError(messageFor(err));
      if (err instanceof ApiError && err.message === "enrolment_expired") {
        setStage("credentials");
        setPassword("");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const wide = stage === "enrol" || stage === "codes";

  return (
    <main id="main" className="flex flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="on-ink grid-paper flex flex-col justify-between gap-10 px-6 py-8 sm:px-10 lg:py-12">
        <Link href="/" className="flex items-center gap-2.5 text-lg font-semibold">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-sm.png" alt="" width={40} height={40} />
          HealthFlow
          {copy.tag && <span className="text-[13px] font-normal text-[var(--muted)]">{copy.tag}</span>}
        </Link>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="HealthFlow GH" width={240} height={240} className="mx-auto hidden h-auto w-48 lg:block xl:w-60" />
        <div className="max-w-md">
          <p className="text-2xl leading-snug font-semibold sm:text-3xl">{copy.line}</p>
          <p className="mt-3 hidden leading-relaxed text-[var(--muted)] sm:block">{copy.body}</p>
        </div>
      </div>
      <div className="flex items-start justify-center px-4 py-10 lg:items-center">
      <Card className={`w-full ${wide ? "max-w-lg" : "max-w-sm"}`}>

        {stage === "enrol" && pending && (
          <>
            <h1 className="text-lg font-semibold">Set up two-step sign-in</h1>
            <p className="mt-1 mb-6 text-[var(--muted)]">
              Your role needs a phone code at sign-in. Set it up once.
            </p>
            <AuthenticatorSetup pending={pending} onConfirm={confirmEnrolment} error={error ?? undefined} busy={submitting} />
          </>
        )}

        {stage === "codes" && (
          <>
            <h1 className="text-lg font-semibold">Save your recovery codes</h1>
            <p className="mt-1 mb-4 text-[var(--muted)]">Two-step sign-in is on.</p>
            <RecoveryCodes
              codes={newCodes}
              doneLabel="Continue to HealthFlow"
              onDone={() => {
                if (session) adoptSession(session);
                router.push(HOME[audience]);
              }}
            />
          </>
        )}

        {(stage === "credentials" || stage === "code") && (
          <>
            <h1 className="mb-4 text-lg font-semibold">{copy.title}</h1>
            <Suspense fallback={null}>
              <ArrivalNotice />
            </Suspense>

            <form onSubmit={handleSignIn} noValidate className="space-y-4">
              {stage === "credentials" && (
                <>
                  <Field label={audience === "facility" ? "Email or phone number" : "Email"}>
                    {(a) => <Input {...a} type={audience === "facility" ? "text" : "email"} autoComplete={audience === "facility" ? "username" : "email"} value={email} onChange={(e) => setEmail(e.target.value)} />}
                  </Field>
                  <Field label="Password">
                    {(a) => (
                      <Input {...a} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                    )}
                  </Field>
                </>
              )}

              {stage === "code" && !useRecovery && (
                <Field label="Authentication code" hint="Enter the 6-digit code from your authenticator app.">
                  {(a) => (
                    <Input
                      {...a}
                      className="figures text-lg tracking-[0.2em]"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={7}
                      autoFocus
                      value={totp}
                      onChange={(e) => setTotp(e.target.value.replace(/\s/g, ""))}
                    />
                  )}
                </Field>
              )}

              {stage === "code" && useRecovery && (
                <Field label="Recovery code" hint="One of the codes you saved when you set up two-step sign-in. Each works once.">
                  {(a) => (
                    <Input {...a} className="figures uppercase" autoComplete="off" autoFocus value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} />
                  )}
                </Field>
              )}

              {error && <ErrorText>{error}</ErrorText>}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Signing in…" : stage === "code" ? "Verify" : "Continue"}
              </Button>
            </form>

            <div className="mt-4 text-sm">
              {stage === "credentials" ? (
                <>
                  <Link href="/forgot-password" className="inline-flex min-h-11 items-center text-[var(--accent-text)] underline-offset-4 hover:underline">
                    Forgot your password?
                  </Link>
                  {audience === "district" && (
                    <p className="mt-2 border-t border-[var(--border)] pt-3 text-[var(--muted)]">
                      New to HealthFlow?{" "}
                      <Link href="/supervisors" className="inline-flex min-h-11 items-center text-[var(--accent-text)] underline underline-offset-4">
                        Register as a supervisor
                      </Link>
                    </p>
                  )}
                  {audience === "facility" && (
                    <p className="mt-2 border-t border-[var(--border)] pt-3 text-[var(--muted)]">
                      New to your facility on HealthFlow?{" "}
                      <Link href="/join" className="inline-flex min-h-11 items-center text-[var(--accent-text)] underline underline-offset-4">
                        Join with your facility code
                      </Link>
                      . Setting up a new facility?{" "}
                      <Link href="/register" className="inline-flex min-h-11 items-center text-[var(--accent-text)] underline underline-offset-4">
                        Register it
                      </Link>
                    </p>
                  )}
                  {audience === "facility" && (
                    <p className="mt-2 border-t border-[var(--border)] pt-3 text-[var(--muted)]">
                      Regional or district supervisor?{" "}
                      <Link href="/supervisors" className="inline-flex min-h-11 items-center text-[var(--accent-text)] underline underline-offset-4">
                        Supervisors
                      </Link>
                    </p>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center text-[var(--accent-text)] underline-offset-4 hover:underline"
                  onClick={() => {
                    setUseRecovery((r) => !r);
                    setError(null);
                  }}
                >
                  {useRecovery ? "Use a code from your app instead" : "Lost your phone? Use a recovery code"}
                </button>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
    </main>
  );
}
