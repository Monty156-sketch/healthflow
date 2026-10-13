import Link from "next/link";
import { Button } from "@/components/ui";

export default function LandingPage() {
  return (
    <main>
      <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
        <span className="font-semibold">HealthFlow</span>
        <Link href="/login">
          <Button>Sign in</Button>
        </Link>
      </header>

      <section className="max-w-2xl mx-auto px-6 py-20">
        <h1 className="text-3xl font-semibold leading-tight mb-4">
          A duty roster you can defend.
        </h1>
        <p className="text-base" style={{ color: "var(--muted)" }}>
          HealthFlow builds your monthly staff roster from your own shifts
          and rules, checks it against Ghana&apos;s Labour Act before it is
          published, and prints the A4 sheet your staff already recognise.
        </p>
        <p className="text-sm mt-10" style={{ color: "var(--muted)" }}>
          HealthFlow is currently being piloted at Sombo Health Centre in the
          Nadowli-Kaleo District, Upper West Region.
        </p>
      </section>
    </main>
  );
}
