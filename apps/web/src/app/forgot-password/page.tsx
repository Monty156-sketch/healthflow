"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { PublicCard } from "@/components/PublicCard";
import { Button, Field, Input, Notice } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Enter the email address you sign in with.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/auth/forgot-password", { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? "Too many requests from this connection. Try again in an hour, or ask your facility admin."
          : "This could not be sent. Check your connection and try again."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicCard title="Reset your password">
      {sent ? (
        <>
          <Notice tone="success">
            If {email.trim()} has a HealthFlow account, a link to choose a new password is on its way. It works once, for 60
            minutes.
          </Notice>
          <p className="mt-4 text-sm text-[var(--muted)]">
            Nothing arrived after a few minutes? Check your spam folder, or ask your facility admin. They can give you a reset
            link directly.
          </p>
        </>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <p className="text-[var(--muted)]">
            Enter your email address and we will send you a link to choose a new password.
          </p>
          <Field label="Email" error={error ?? undefined}>
            {(a) => <Input {...a} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"}
          </Button>
          <p className="text-sm text-[var(--muted)]">
            No email address on your account? Your facility admin can give you a reset link.
          </p>
        </form>
      )}
      <p className="mt-4 text-sm">
        <Link href="/login" className="inline-flex min-h-11 items-center text-[var(--accent-text)] underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </PublicCard>
  );
}
