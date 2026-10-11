"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Button, Card } from "@/components/ui";

export default function DashboardPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return <main className="p-8 text-sm" style={{ color: "var(--muted)" }}>Loading…</main>;
  }

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <Card>
        <h1 className="text-lg font-semibold mb-1">Signed in</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {user.email} · {user.role}
        </p>
        <p className="text-xs mt-4" style={{ color: "var(--muted)" }}>
          This page exists to prove Phase 0&apos;s pipeline end to end. The
          real staff, roster and leave screens are built in the phases that
          follow.
        </p>
        <Button variant="secondary" className="mt-4" onClick={logout}>
          Sign out
        </Button>
      </Card>
    </main>
  );
}
