import type { Metadata } from "next";
import { PublicPage, PublicSection } from "@/components/PublicPage";
import { INCIDENTS } from "@/lib/siteNotes";

export const metadata: Metadata = { title: "Status | HealthFlow" };

export default function StatusPage() {
  const open = INCIDENTS.filter((i) => !i.resolved);
  return (
    <PublicPage title="Status" intro="This page is kept up to date by hand. If HealthFlow is not working and nothing is listed here, call 055 457 1800.">
      <section className="rounded-[var(--radius)] border border-[var(--border)] border-l-[3px] bg-[var(--surface)] p-4" style={{ borderLeftColor: open.length ? "var(--status-warning)" : "var(--status-success)" }}>
        <p className="font-semibold">{open.length ? "There is a known problem" : "No known problems"}</p>
        {open.map((i) => (
          <p key={i.date} className="mt-1">
            {i.date}: {i.title}. {i.detail}
          </p>
        ))}
      </section>
      <PublicSection title="Past incidents">
        {INCIDENTS.filter((i) => i.resolved).length === 0 ? (
          <p>None recorded yet.</p>
        ) : (
          <ul className="space-y-3">
            {INCIDENTS.filter((i) => i.resolved).map((i) => (
              <li key={i.date}>
                <p className="font-medium">
                  {i.date}: {i.title}
                </p>
                <p className="text-[var(--muted)]">{i.detail} Resolved {i.resolved}.</p>
              </li>
            ))}
          </ul>
        )}
      </PublicSection>
    </PublicPage>
  );
}
