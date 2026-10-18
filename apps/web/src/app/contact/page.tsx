import type { Metadata } from "next";
import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";

export const metadata: Metadata = { title: "Contact | HealthFlow" };

const A = "text-[var(--accent-text)] underline underline-offset-2";

export default function ContactPage() {
  return (
    <>
    <PublicNav />
    <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-5 py-8 sm:py-12">
      <h1 className="text-3xl font-semibold leading-tight">Contact</h1>
      <p className="mt-3 leading-relaxed">
        HealthFlow is built and run by PS Tech in Wa, Upper West Region, Ghana. Write or call for help using HealthFlow or about your data. We reply within 48 hours, usually sooner. To ask for a demonstration, use the <Link href="/request-access" className={A}>request access form</Link>.
      </p>

      <dl className="mt-6 divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
        <div className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr]">
          <dt className="text-[var(--muted)]">Email</dt>
          <dd>
            <a href="mailto:muslimfroko05@gmail.com" className={A}>
              muslimfroko05@gmail.com
            </a>
          </dd>
        </div>
        <div className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr]">
          <dt className="text-[var(--muted)]">Telephone</dt>
          <dd className="figures">
            <a href="tel:+233554571800" className={A}>
              055 457 1800
            </a>
            {", "}
            <a href="tel:+233246187422" className={A}>
              024 618 7422
            </a>
          </dd>
        </div>
        <div className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr]">
          <dt className="text-[var(--muted)]">Based in</dt>
          <dd>Wa, Upper West Region, Ghana</dd>
        </div>
      </dl>

      <section className="mt-8" aria-labelledby="signed-in">
        <h2 id="signed-in" className="mb-2 text-xl font-semibold">
          If you already use HealthFlow
        </h2>
        <p className="leading-relaxed">
          Once you are signed in, use <strong>Report a problem</strong> in the menu. It sends us what you were doing and what went wrong, so we can look into it.
        </p>
      </section>

      <section className="mt-8" aria-labelledby="data">
        <h2 id="data" className="mb-2 text-xl font-semibold">
          Questions about your data
        </h2>
        <p className="leading-relaxed">
          If you are a member of staff, your facility decides what is held about you and handles your requests, and we help them. Ask your in-charge first. For anything
          else, write to us at the email above. The{" "}
          <Link href="/privacy" className={A}>
            Privacy Policy
          </Link>{" "}
          explains your rights, and the{" "}
          <Link href="/terms" className={A}>
            Terms of Service
          </Link>{" "}
          explain how HealthFlow is provided.
        </p>
      </section>
    </main>
    </>
  );
}
