import type { Metadata } from "next";
import { PublicPage } from "@/components/PublicPage";
import { RELEASES } from "@/lib/siteNotes";

export const metadata: Metadata = { title: "What is new | HealthFlow" };

export default function ChangelogPage() {
  return (
    <PublicPage title="What is new" intro="Changes to HealthFlow, in plain language, newest first.">
      <div className="space-y-8">
        {RELEASES.map((r) => (
          <section key={r.date + r.title} aria-labelledby={`r-${r.date}`}>
            <p className="figures text-sm text-[var(--muted)]">{r.date}</p>
            <h2 id={`r-${r.date}`} className="text-xl font-semibold">
              {r.title}
            </h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 leading-relaxed">
              {r.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </PublicPage>
  );
}
