"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { PublicCard } from "@/components/PublicCard";
import { Button, Field, Input, Loading, Notice } from "@/components/ui";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const check = useResource<{ status: "ok" | "expired" | "invalid" }>(
    token ? `/api/auth/reset-password/check?token=${encodeURIComponent(token)}` : null
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  const status = token ? check.data?.status : "invalid";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setErrors({ confirm: "The two passwords are not the same." });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await api.post("/api/auth/reset-password", { token, password });
      router.replace("/login?reason=reset");
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { fields?: { password?: string }; message?: string }) : undefined;
      setErrors(
        body?.fields?.password
          ? { password: body.fields.password }
          : { form: body?.message ?? "Your new password could not be saved. Check your connection and try again." }
      );
    } finally {
      setBusy(false);
    }
  }

  if (token && !check.data && !check.error) return <Loading label="Checking your link" />;

  if (status !== "ok") {
    return (
      <>
        <Notice tone="warning">
          {status === "expired"
            ? "This link has expired. Links work for 30 minutes."
            : "This link is not valid. It may already have been used, or it was copied incompletely."}
        </Notice>
        <p className="mt-4 text-sm">
          <Link href="/forgot-password" className="inline-flex min-h-11 items-center text-[var(--accent-text)] underline-offset-4 hover:underline">
            Ask for a new link
          </Link>
        </p>
      </>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {errors.form && <Notice tone="block">{errors.form}</Notice>}
      <Field
        label="New password"
        hint="At least 12 characters. A few unrelated words work well and are easy to remember."
        error={errors.password}
      >
        {(a) => <Input {...a} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      <Field label="Type it again" error={errors.confirm}>
        {(a) => <Input {...a} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
      </Field>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Saving…" : "Save new password"}
      </Button>
      <p className="text-sm text-[var(--muted)]">You will be signed out on every device, then sign in with the new password.</p>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <PublicCard title="Choose a new password">
      <Suspense fallback={<Loading />}>
        <ResetForm />
      </Suspense>
    </PublicCard>
  );
}
