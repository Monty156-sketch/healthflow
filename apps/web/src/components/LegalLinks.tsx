import Link from "next/link";

/** Terms and Privacy, shown wherever someone is asked to trust the product. */
export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={`flex flex-wrap items-center justify-center gap-x-5 text-sm ${className}`}>
      <Link href="/terms" className="inline-flex min-h-11 items-center text-[var(--accent-text)] underline-offset-4 hover:underline">
        Terms of Service
      </Link>
      <Link href="/privacy" className="inline-flex min-h-11 items-center text-[var(--accent-text)] underline-offset-4 hover:underline">
        Privacy Policy
      </Link>
    </nav>
  );
}
