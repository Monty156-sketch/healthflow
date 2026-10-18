import type { ReactNode } from "react";
import { PublicNav } from "@/components/PublicNav";

/** The frame for a public information page: the header, one h1 and a readable column. */
export function PublicPage({ title, intro, children, wide }: { title: string; intro?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <>
      <PublicNav />
      <main id="main" className={`mx-auto w-full flex-1 px-4 py-8 sm:px-5 sm:py-12 ${wide ? "max-w-5xl" : "max-w-3xl"}`}>
        <h1 className="text-3xl font-semibold leading-tight">{title}</h1>
        {intro && <p className="mt-3 text-lg leading-relaxed text-[var(--muted)]">{intro}</p>}
        <div className="mt-8 space-y-8">{children}</div>
      </main>
    </>
  );
}

export function PublicSection({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id ?? title}-h`}>
      <h2 id={`${id ?? title}-h`} className="mb-2 text-xl font-semibold">
        {title}
      </h2>
      <div className="space-y-3 leading-relaxed">{children}</div>
    </section>
  );
}
