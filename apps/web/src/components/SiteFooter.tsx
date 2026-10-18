import Link from "next/link";

const LINK = "inline-flex min-h-11 items-center text-[var(--accent-text)] underline-offset-4 hover:underline";

/** Under every page: who runs HealthFlow, and where to read the terms, the privacy policy and how to get in touch. */
export function SiteFooter() {
  return (
    <footer className="no-print mt-auto border-t border-[var(--border)] bg-[var(--surface)] px-5 py-4">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-x-6 gap-y-1 text-sm text-[var(--muted)] lg:flex-row lg:justify-between">
        <p>HealthFlow, by PS Tech, Wa, Upper West Region, Ghana. © {new Date().getFullYear()}</p>
        <nav aria-label="Legal and contact" className="flex flex-wrap items-center justify-center gap-x-5">
          <Link href="/terms" className={LINK}>
            Terms of Service
          </Link>
          <Link href="/privacy" className={LINK}>
            Privacy Policy
          </Link>
          <Link href="/dpa" className={LINK}>
            Data Processing Agreement
          </Link>
          <Link href="/security" className={LINK}>
            Security
          </Link>
          <Link href="/contact" className={LINK}>
            Contact
          </Link>
        </nav>
      </div>
    </footer>
  );
}
