"use client";

// The two pieces of two-step sign-in that appear both at sign-in (first-time
// setup) and on the account page: connecting an authenticator app, and the
// recovery codes shown once afterwards.
import { FormEvent, useState } from "react";
import { Button, Checkbox, Field, Input, Notice } from "@/components/ui";

export interface PendingAuthenticator {
  qrDataUrl: string;
  secret: string;
  setupToken: string;
}

/** "JBSWY3DPEHPK3PXP" -> "JBSW Y3DP EHPK 3PXP", easier to type from a screen. */
function groupKey(secret: string) {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

export function AuthenticatorSetup({
  pending,
  onConfirm,
  error,
  busy,
  submitLabel = "Confirm and switch on",
}: {
  pending: PendingAuthenticator;
  onConfirm: (code: string) => void;
  error?: string;
  busy?: boolean;
  submitLabel?: string;
}) {
  const [code, setCode] = useState("");
  const [showKey, setShowKey] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    onConfirm(code.replace(/\s/g, ""));
  }

  return (
    <form onSubmit={submit} noValidate>
      <ol className="space-y-5">
        <li className="grid grid-cols-[1.75rem_1fr] gap-x-2">
          <span className="figures text-[var(--muted)]" aria-hidden="true">1</span>
          <div>
            <p className="font-medium">Open an authenticator app on your phone</p>
            <p className="text-sm text-[var(--muted)]">
              Use Google or Microsoft Authenticator.
            </p>
          </div>
        </li>
        <li className="grid grid-cols-[1.75rem_1fr] gap-x-2">
          <span className="figures text-[var(--muted)]" aria-hidden="true">2</span>
          <div>
            <p className="font-medium">Add HealthFlow to it</p>
            <p className="text-sm text-[var(--muted)]">Tap the add button and scan this code.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pending.qrDataUrl}
              alt="QR code to add HealthFlow to your authenticator app"
              width={180}
              height={180}
              className="mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-white p-1"
            />
            {showKey ? (
              <div className="mt-3">
                <p className="text-sm text-[var(--muted)]">Or enter this key, choosing &ldquo;time based&rdquo;:</p>
                <p className="figures mt-1 text-[17px] tracking-wide break-all select-all">{groupKey(pending.secret)}</p>
              </div>
            ) : (
              <Button variant="quiet" className="-ml-3 mt-2" onClick={() => setShowKey(true)}>
                Can&apos;t scan? Show a key to type instead
              </Button>
            )}
          </div>
        </li>
        <li className="grid grid-cols-[1.75rem_1fr] gap-x-2">
          <span className="figures text-[var(--muted)]" aria-hidden="true">3</span>
          <div className="max-w-xs">
            <Field label="Enter the 6-digit code it shows" error={error}>
              {(a) => (
                <Input
                  {...a}
                  className="figures text-lg tracking-[0.2em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              )}
            </Field>
          </div>
        </li>
      </ol>
      <div className="mt-6">
        <Button type="submit" disabled={busy || code.replace(/\s/g, "").length !== 6}>
          {busy ? "Checking…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function RecoveryCodes({ codes, onDone, doneLabel = "Continue" }: { codes: string[]; onDone: () => void; doneLabel?: string }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const text = `HealthFlow recovery codes\nEach code works once, if you cannot use your authenticator app.\n\n${codes.join("\n")}\n`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "healthflow-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <Notice tone="warning">
        Shown once. Each code signs you in once if you lose your phone. Keep them private.
      </Notice>
      <ul className="figures mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[17px] sm:max-w-sm" aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={copy}>
          Copy codes
        </Button>
        <Button variant="secondary" onClick={download}>
          Download as a text file
        </Button>
        <span aria-live="polite" className="text-sm text-[var(--muted)]">
          {copied === "copied" ? "Copied" : copied === "failed" ? "Copying is blocked here. Write them down or download them." : ""}
        </span>
      </div>
      <div className="mt-5">
        <Checkbox label="I have saved these codes somewhere safe" checked={saved} onChange={setSaved} />
      </div>
      <Button className="mt-3" disabled={!saved} onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  );
}
