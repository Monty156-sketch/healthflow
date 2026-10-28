"use client";

import { FormEvent, useCallback, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource, useSave } from "@/lib/useApi";
import { ROLE, showDateTime } from "@/lib/format";
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Field,
  Input,
  Loading,
  LoadError,
  Notice,
  PageHeader,
  Panel,
  SaveStatus,
  StatusBadge,
} from "@/components/ui";
import { AuthenticatorSetup, RecoveryCodes, type PendingAuthenticator } from "@/components/TwoStep";

interface Account {
  email: string;
  displayName: string;
  role: string;
  mfaEnabled: boolean;
  mfaRequired: boolean;
  recoveryCodesLeft: number;
  lastSignInAt: string | null;
}

interface SessionRow {
  id: string;
  device: string;
  lastActiveAt: string;
  current: boolean;
}

// ------------------------------------------------------------- password

function PasswordPanel() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [confirmError, setConfirmError] = useState<string | undefined>();
  const [done, setDone] = useState<string | null>(null);
  const change = useCallback(
    (body: { currentPassword: string; newPassword: string }) =>
      api.post<{ otherDevicesSignedOut: number }>("/api/auth/account/password", body),
    []
  );
  const save = useSave(change);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone(null);
    if (next !== confirm) {
      setConfirmError("The two new passwords are not the same.");
      return;
    }
    setConfirmError(undefined);
    const res = await save.run({ currentPassword: current, newPassword: next });
    if (res) {
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(
        res.otherDevicesSignedOut
          ? `Password changed. You were signed out on ${res.otherDevicesSignedOut} other ${res.otherDevicesSignedOut === 1 ? "device" : "devices"}.`
          : "Password changed."
      );
    }
  }

  return (
    <Panel title="Password" description="Changing it signs you out on your other devices.">
      <form onSubmit={submit} noValidate className="max-w-md space-y-4">
        {done && <Notice tone="success">{done}</Notice>}
        {save.state === "failed" && save.message && !Object.keys(save.fieldErrors).length && <Notice tone="block">{save.message}</Notice>}
        <Field label="Current password" error={save.fieldErrors.currentPassword}>
          {(a) => <Input {...a} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
        </Field>
        <Field
          label="New password"
          hint="At least 12 characters."
          error={save.fieldErrors.newPassword}
        >
          {(a) => <Input {...a} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
        </Field>
        <Field label="Type the new password again" error={confirmError}>
          {(a) => <Input {...a} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={save.state === "saving"}>
            Change password
          </Button>
          <SaveStatus state={save.state === "failed" ? "idle" : save.state} />
        </div>
      </form>
    </Panel>
  );
}

// ------------------------------------------------------------- two-step sign-in

type MfaAction = "setup" | "replace" | "codes" | "disable";

const ACTION_COPY: Record<MfaAction, { title: string; button: string }> = {
  setup: { title: "Set up two-step sign-in", button: "Continue" },
  replace: { title: "Move to a new phone or app", button: "Continue" },
  codes: { title: "Create new recovery codes", button: "Create new codes" },
  disable: { title: "Turn off two-step sign-in", button: "Turn off" },
};

function TwoStepPanel({ account, onChanged }: { account: Account; onChanged: () => void }) {
  const [action, setAction] = useState<MfaAction | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAuthenticator | null>(null);
  const [codeError, setCodeError] = useState<string | undefined>();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function reset() {
    setAction(null);
    setPassword("");
    setPasswordError(undefined);
    setProblem(null);
    setPending(null);
    setCodeError(undefined);
  }

  function explain(err: unknown) {
    if (err instanceof ApiError) {
      const body = err.body as { fields?: Record<string, string>; message?: string };
      if (body.fields?.currentPassword) return setPasswordError(body.fields.currentPassword);
      return setProblem(body.message ?? "That did not work. Try again.");
    }
    setProblem("No connection. Try again when you are back online.");
  }

  async function confirmPassword(e: FormEvent) {
    e.preventDefault();
    if (!action) return;
    setPasswordError(undefined);
    setProblem(null);
    setBusy(true);
    try {
      if (action === "setup" || action === "replace") {
        setPending(await api.post<PendingAuthenticator>("/api/auth/account/mfa/start", { currentPassword: password }));
      } else if (action === "codes") {
        const res = await api.post<{ recoveryCodes: string[] }>("/api/auth/account/mfa/recovery-codes", { currentPassword: password });
        reset();
        setCodes(res.recoveryCodes);
        onChanged();
      } else {
        await api.post("/api/auth/account/mfa/disable", { currentPassword: password });
        reset();
        setNotice("Two-step sign-in is off.");
        onChanged();
      }
    } catch (err) {
      explain(err);
    } finally {
      setBusy(false);
    }
  }

  async function finish(code: string) {
    if (!pending) return;
    setCodeError(undefined);
    setBusy(true);
    try {
      const res = await api.post<{ recoveryCodes: string[] }>("/api/auth/account/mfa/finish", { setupToken: pending.setupToken, totp: code });
      reset();
      setCodes(res.recoveryCodes);
      onChanged();
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { fields?: { totp?: string }; message?: string }) : undefined;
      if (body?.fields?.totp) setCodeError(body.fields.totp);
      else if (body?.message) {
        setProblem(body.message);
        setPending(null);
      } else setProblem("No connection. Try again when you are back online.");
    } finally {
      setBusy(false);
    }
  }

  const fewCodes = account.mfaEnabled && account.recoveryCodesLeft <= 3;

  return (
    <Panel
      title="Two-step sign-in"
      description="A phone code is needed at every sign-in."
    >
      {codes ? (
        <RecoveryCodes
          codes={codes}
          doneLabel="Done"
          onDone={() => {
            setCodes(null);
            setNotice("Your new recovery codes are saved. The old ones no longer work.");
          }}
        />
      ) : pending ? (
        <>
          <AuthenticatorSetup pending={pending} onConfirm={finish} error={codeError} busy={busy} />
          <Button variant="secondary" className="mt-3" onClick={reset}>
            Cancel
          </Button>
          {problem && (
            <div className="mt-3">
              <Notice tone="block">{problem}</Notice>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-4">
          {notice && <Notice tone="success">{notice}</Notice>}
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge tone={account.mfaEnabled ? "success" : "warning"}>{account.mfaEnabled ? "On" : "Off"}</StatusBadge>
            {account.mfaEnabled && (
              <span className={`text-sm ${fewCodes ? "text-[var(--status-warning)]" : "text-[var(--muted)]"}`}>
                {account.recoveryCodesLeft} recovery {account.recoveryCodesLeft === 1 ? "code" : "codes"} left
                {fewCodes ? ". Create new ones soon." : ""}
              </span>
            )}
          </div>
          {account.mfaRequired && <p className="text-sm text-[var(--muted)]">Your role requires two-step sign-in, so it cannot be turned off.</p>}

          {!action && (
            <div className="flex flex-wrap gap-2">
              {account.mfaEnabled ? (
                <>
                  <Button variant="secondary" onClick={() => setAction("replace")}>
                    Move to a new phone or app
                  </Button>
                  <Button variant="secondary" onClick={() => setAction("codes")}>
                    Create new recovery codes
                  </Button>
                  {!account.mfaRequired && (
                    <Button variant="danger" onClick={() => setAction("disable")}>
                      Turn off
                    </Button>
                  )}
                </>
              ) : (
                <Button onClick={() => setAction("setup")}>Set up two-step sign-in</Button>
              )}
            </div>
          )}

          {action && (
            <form onSubmit={confirmPassword} noValidate className="max-w-md space-y-3 rounded-[var(--radius)] border border-[var(--border)] p-4">
              <p className="font-medium">{ACTION_COPY[action].title}</p>
              {action === "codes" && <p className="text-sm text-[var(--muted)]">Your current recovery codes will stop working.</p>}
              <Field label="Confirm your password to continue" error={passwordError}>
                {(a) => (
                  <Input {...a} type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
                )}
              </Field>
              {problem && <Notice tone="block">{problem}</Notice>}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant={action === "disable" ? "danger" : "primary"} disabled={busy}>
                  {busy ? "Checking…" : ACTION_COPY[action].button}
                </Button>
                <Button variant="secondary" onClick={reset}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------- sessions

function SessionsPanel() {
  const { data, error, reload } = useResource<{ sessions: SessionRow[] }>("/api/auth/sessions");
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmEverywhere, setConfirmEverywhere] = useState(false);

  async function act(key: string, fn: () => Promise<unknown>, done: string) {
    setProblem(null);
    setNotice(null);
    setBusy(key);
    try {
      await fn();
      setNotice(done);
      reload();
    } catch {
      setProblem("That did not work. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function everywhere() {
    setBusy("everywhere");
    try {
      await api.post("/api/auth/logout-everywhere");
      window.location.replace("/login?reason=expired");
    } catch {
      setProblem("That did not work. Check your connection and try again.");
      setBusy(null);
      setConfirmEverywhere(false);
    }
  }

  const sessions = data?.sessions ?? [];
  const others = sessions.filter((s) => !s.current).length;

  return (
    <Panel title="Where you are signed in" description="Sessions end after 30 minutes without activity.">
      {notice && (
        <div className="mb-3">
          <Notice tone="success">{notice}</Notice>
        </div>
      )}
      {problem && (
        <div className="mb-3">
          <Notice tone="block">{problem}</Notice>
        </div>
      )}
      {error && !data && <LoadError onRetry={reload} />}
      {!data && !error && <Loading />}
      {data && (
        <ul className="divide-y divide-[var(--border)]">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
              <div>
                <p className="font-medium">
                  {s.device}
                  {s.current && (
                    <span className="ml-2">
                      <StatusBadge tone="success">This device</StatusBadge>
                    </span>
                  )}
                </p>
                <p className="figures text-sm text-[var(--muted)]">Last active {showDateTime(s.lastActiveAt)}</p>
              </div>
              {!s.current && (
                <Button
                  variant="secondary"
                  disabled={busy === s.id}
                  aria-label={`Sign out ${s.device}`}
                  onClick={() => act(s.id, () => api.post(`/api/auth/sessions/${s.id}/revoke`), `${s.device} has been signed out.`)}
                >
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
          <Button
            variant="secondary"
            disabled={others === 0 || busy === "others"}
            onClick={() => act("others", () => api.post("/api/auth/sessions/revoke-others"), "You have been signed out on every other device.")}
          >
            Sign out of all other devices
          </Button>
          <Button variant="danger" onClick={() => setConfirmEverywhere(true)}>
            Sign out everywhere
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirmEverywhere}
        title="Sign out everywhere?"
        confirmLabel="Sign out everywhere"
        tone="danger"
        busy={busy === "everywhere"}
        onConfirm={everywhere}
        onCancel={() => setConfirmEverywhere(false)}
      >
        <p>Ends every session, including this one.</p>
      </ConfirmDialog>
    </Panel>
  );
}

// ------------------------------------------------------------- page

interface Prefs {
  categories: { key: string; label: string; description: string; on: boolean }[];
  alwaysSent: string[];
}

function NotificationsPanel() {
  const { data, error, reload } = useResource<Prefs>("/api/facility/me/notification-preferences");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (error || !data) return null; // not a facility account, or it could not load: nothing to show
  const prefs = data;

  async function toggle(key: string, on: boolean) {
    setBusy(key);
    setProblem(null);
    const off = prefs.categories.filter((c) => (c.key === key ? !on : !c.on)).map((c) => c.key);
    try {
      await api.put("/api/facility/me/notification-preferences", { off });
      reload();
    } catch {
      setProblem("That could not be saved. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title="Notifications" description="Choose which notifications you get in the app.">
      {problem && (
        <div className="mb-3">
          <Notice tone="block">{problem}</Notice>
        </div>
      )}
      <div className="space-y-3">
        {prefs.categories.map((c) => (
          <div key={c.key}>
            <Checkbox label={c.label} checked={c.on} disabled={busy !== null} onChange={(on) => toggle(c.key, on)} />
            <p className="ml-8 text-sm text-[var(--muted)]">{c.description}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 border-t border-[var(--border)] pt-3 text-sm text-[var(--muted)]">Always sent: {prefs.alwaysSent.join(". ")}.</p>
    </Panel>
  );
}

function WhatsAppPanel() {
  const { data, error, reload } = useResource<{ optIn: boolean; number: string | null; facilityOn: boolean }>("/api/facility/me/whatsapp");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (error || !data || !data.facilityOn) return null;

  async function change(optIn: boolean) {
    setBusy(true);
    setProblem(null);
    try {
      await api.put("/api/facility/me/whatsapp", { optIn });
      reload();
    } catch (e) {
      setProblem(e instanceof ApiError && typeof e.body === "object" && e.body && "message" in e.body ? String((e.body as { message: string }).message) : "That could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="WhatsApp duty reminders" description="One message each morning on the days you are on duty, naming your shift.">
      {problem && (
        <div className="mb-3">
          <Notice tone="block">{problem}</Notice>
        </div>
      )}
      <Checkbox label="Send my duty reminders on WhatsApp" checked={data.optIn} disabled={busy} onChange={change} />
      <p className="ml-8 text-sm text-[var(--muted)]">
        {data.number ? `Messages go to the mobile number your facility has for you, ${data.number}. If that is not your WhatsApp number, ask your administrator to correct it first.` : "Your facility has no usable mobile number for you, so none can be sent."} Only you can switch this on, and you can switch it off at any time.
      </p>
    </Panel>
  );
}

function TextsPanel() {
  const { data, error, reload } = useResource<{ optOut: boolean; hasPhone: boolean }>("/api/facility/me/sms-opt-out");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (error || !data) return null;

  async function change(optOut: boolean) {
    setBusy(true);
    setProblem(null);
    try {
      await api.put("/api/facility/me/sms-opt-out", { optOut });
      reload();
    } catch {
      setProblem("That could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Text messages" description="Texts about your roster and duty changes.">
      {problem && (
        <div className="mb-3">
          <Notice tone="block">{problem}</Notice>
        </div>
      )}
      <Checkbox label="Send me text messages" checked={!data.optOut} disabled={busy} onChange={(on) => change(!on)} />
      <p className="ml-8 text-sm text-[var(--muted)]">
        {data.hasPhone ? "Texts go to the phone number your facility has for you." : "Your facility has no phone number for you yet, so none are sent."} Switching this off stops all of them. You can still see everything in the app.
      </p>
    </Panel>
  );
}

export default function AccountPage() {
  const { data, error, reload } = useResource<{ account: Account }>("/api/auth/account");

  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading your account" />;
  const a = data.account;

  return (
    <>
      <PageHeader
        title="My account"
        description={
          <>
            {a.displayName !== a.email && <>{a.displayName}, </>}
            {a.email}, {ROLE[a.role] ?? a.role}
          </>
        }
      />
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <TwoStepPanel account={a} onChanged={reload} />
          <PasswordPanel />
          {a.role !== "PLATFORM_ADMIN" && a.role !== "DISTRICT_OFFICER" && <NotificationsPanel />}
          {a.role !== "PLATFORM_ADMIN" && a.role !== "DISTRICT_OFFICER" && <TextsPanel />}
          {a.role !== "PLATFORM_ADMIN" && a.role !== "DISTRICT_OFFICER" && <WhatsAppPanel />}
        </div>
        <SessionsPanel />
      </div>
    </>
  );
}
