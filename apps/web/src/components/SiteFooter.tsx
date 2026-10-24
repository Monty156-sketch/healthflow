import Link from "next/link";

const LINK = "inline-flex min-h-11 items-center text-[var(--muted)] underline-offset-4 hover:text-[var(--accent-text)] hover:underline";
const H = "text-base font-semibold text-[var(--foreground)]";

const PRODUCT = [
  { href: "/#features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/register", label: "Register your facility" },
  { href: "/district/register", label: "Register a district" },
  { href: "/about", label: "About" },
];
const LEGAL = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/dpa", label: "Data Processing Agreement" },
  { href: "/security", label: "Security" },
];

/** Under every page: what HealthFlow is, where to go, the legal pages, and how to reach PS Tech. */
export function SiteFooter() {
  return (
    <footer className="on-ink no-print mt-auto px-5 pt-10 pb-6">
      <div className="mx-auto max-w-5xl">
        <div className="grid gap-x-8 gap-y-8 grid-cols-2 lg:grid-cols-4">
          <div className="col-span-2 lg:col-span-1">
            <p className="flex items-center gap-2 text-lg font-semibold text-[var(--foreground)]">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo-sm.png" alt="" width={36} height={36} />HealthFlow</p>
            <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-[var(--muted)]">Fair duty rosters for every ward and every facility in Ghana.</p>
          </div>
          <nav aria-label="Product">
            <h2 className={H}>Product</h2>
            <ul className="mt-2">
              {PRODUCT.map((l) => (
                <li key={l.href}><Link href={l.href} className={LINK}>{l.label}</Link></li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Legal">
            <h2 className={H}>Legal</h2>
            <ul className="mt-2">
              {LEGAL.map((l) => (
                <li key={l.href}><Link href={l.href} className={LINK}>{l.label}</Link></li>
              ))}
            </ul>
          </nav>
          <div>
            <h2 className={H}>Contact</h2>
            <ul className="mt-2">
              <li className="flex flex-wrap items-center gap-x-3"><a href="tel:+233554571800" className={LINK}>+233 55 457 1800</a><a href="https://wa.me/233554571800" target="_blank" rel="noopener noreferrer" className={LINK} aria-label="WhatsApp +233 55 457 1800">WhatsApp</a></li>
              <li className="flex flex-wrap items-center gap-x-3"><a href="tel:+233246187422" className={LINK}>+233 24 618 7422</a><a href="https://wa.me/233246187422" target="_blank" rel="noopener noreferrer" className={LINK} aria-label="WhatsApp +233 24 618 7422">WhatsApp</a></li>
              <li><a href="mailto:muslimfroko05@gmail.com" className={`${LINK} break-all`}>muslimfroko05@gmail.com</a></li>
              <li><Link href="/contact" className={LINK}>Wa, Upper West</Link></li>
            </ul>
          </div>
        </div>
        <p className="mt-8 border-t border-[var(--border)] pt-4 text-sm text-[var(--muted)]">© {new Date().getFullYear()} PS Tech. HealthFlow.</p>
      </div>
    </footer>
  );
}
