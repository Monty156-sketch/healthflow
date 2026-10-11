"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";
import { Button, Card, ErrorText, Input, Label } from "@/components/ui";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login(email, password, mfaRequired ? { totp } : undefined);
      if (result.mfaRequired) {
        setMfaRequired(true);
      } else {
        router.push("/dashboard");
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.message === "account_locked") {
          setError("Too many failed attempts. Try again in a few minutes.");
        } else if (err.message === "invalid_mfa") {
          setError("That code didn't match. Check the time on your phone and try again.");
        } else {
          setError("Incorrect email or password.");
        }
      } else {
        setError("Something went wrong. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-lg font-semibold mb-1">Sign in</h1>
        <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
          HealthFlow
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!mfaRequired && (
            <>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </>
          )}

          {mfaRequired && (
            <div>
              <Label htmlFor="totp">Authentication code</Label>
              <Input
                id="totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
                autoFocus
              />
              <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                Enter the 6-digit code from your authenticator app.
              </p>
            </div>
          )}

          {error && <ErrorText>{error}</ErrorText>}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Signing in…" : mfaRequired ? "Verify" : "Continue"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
