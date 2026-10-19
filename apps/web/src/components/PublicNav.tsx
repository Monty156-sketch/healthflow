import Link from "next/link";
import { ButtonLink } from "@/components/ui";

const LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#how", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/security", label: "Security" },
  { href: "/contact", label: "Contact" },
];

/**
 * The header on every public page. Sticky, with the register button
 * always in view; on a phone the links sit behind a Menu control and the
 * button stays outside it.
 */
export function PublicNav() {
  return (
    <header className="on-ink no-print sticky top-0 z-30 border-b border-[var(--border)]">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2 sm:px-5">
        <Link href="/" className="mr-auto flex min-h-11 items-center gap-2 font-semibold">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="" width={26} height={26} />
          HealthFlow
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="inline-flex min-h-11 items-center rounded-[var(--radius)] px-3 text-[15px] hover:bg-[var(--accent-soft)]">
              {l.label}
            </Link>
          ))}
        </nav>
        <Link href="/login" className="hidden min-h-11 items-center px-2 text-[15px] text-[var(--foreground)] underline-offset-4 hover:underline sm:inline-flex">
          Sign in
        </Link>
        <ButtonLink href="/register">Register your facility</ButtonLink>
        <details className="relative md:hidden">
          <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-[var(--radius)] border border-[var(--border-strong)] px-3 text-[15px] [&::-webkit-details-marker]:hidden">Menu</summary>
          <nav aria-label="Main, small screens" className="absolute right-0 mt-2 w-56 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--ink-soft)] p-1 shadow-lg">
            {[...LINKS, { href: "/login", label: "Sign in" }].map((l) => (
              <Link key={l.href} href={l.href} className="flex min-h-11 items-center rounded-[var(--radius)] px-3 hover:bg-[var(--accent-soft)]">
                {l.label}
              </Link>
            ))}
          </nav>
        </details>
      </div>
    </header>
  );
}
