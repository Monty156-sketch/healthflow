import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";

export const metadata = { title: "Page not found | HealthFlow" };

export default function NotFound() {
  return (
    <>
      <PublicNav />
      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-4 py-16 sm:px-5">
        <p className="text-sm font-medium text-[var(--muted)]">Error 404</p>
        <h1 className="mt-1 text-3xl font-semibold leading-tight">This page is not here</h1>
        <p className="mt-3 text-lg leading-relaxed text-[var(--muted)]">The address may be mistyped, or the page may have moved. If you followed a link inside HealthFlow, tell us and we will fix it.</p>
        <p className="mt-6 flex flex-wrap gap-x-6 text-[15px]">
          <Link href="/" className="inline-flex min-h-11 items-center text-[var(--accent-text)] underline underline-offset-4">Home</Link>
          <Link href="/login" className="inline-flex min-h-11 items-center text-[var(--accent-text)] underline underline-offset-4">Sign in</Link>
          <Link href="/contact" className="inline-flex min-h-11 items-center text-[var(--accent-text)] underline underline-offset-4">Contact us</Link>
        </p>
      </main>
    </>
  );
}
