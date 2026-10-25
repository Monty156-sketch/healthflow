import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/PublicPage";
import { ButtonLink } from "@/components/ui";

export const metadata: Metadata = {
  title: "Supervisors | HealthFlow",
  description: "Register a regional office, a district office or your own hospital on HealthFlow. Regions approve districts, and facilities decide what they share.",
};

const CHOICES = [
  {
    title: "Regional office",
    who: "A regional health directorate, or the regional office of CHAG, AMMG or a private group.",
    sees: "Sees the districts that report to it, and the facilities in them that have chosen to share. Approves each district that asks to join.",
    href: "/region/register",
    action: "Register a regional office",
  },
  {
    title: "District office",
    who: "A district health directorate, or the district office of CHAG, AMMG or a private group.",
    sees: "Chooses its regional office, which approves the registration. Sees the facilities that have chosen to share with it: coverage, establishment, attendance, compliance and leave.",
    href: "/district/register",
    action: "Register a district office",
  },
  {
    title: "Individual",
    who: "The person in charge of a hospital, clinic, health centre or CHPS compound.",
    sees: "Registers the hospital by name, becomes its administrator, and manages the roster, staff, leave and attendance of that facility.",
    href: "/register",
    action: "Register a hospital",
  },
];

export default function SupervisorsPage() {
  return (
    <PublicPage
      title="Supervisors"
      intro="Choose how you work with HealthFlow. Every office is checked before it goes live. A facility's data stays with the facility: a district or region sees only what that facility has chosen to share."
    >
      <ol className="grid gap-4 md:grid-cols-3">
        {CHOICES.map((c, i) => (
          <li key={c.title} className="flex flex-col rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <p className="figures text-sm text-[var(--muted)]">{i + 1}</p>
            <h2 className="mt-1 text-lg font-semibold">{c.title}</h2>
            <p className="mt-2 text-[15px]">{c.who}</p>
            <p className="mt-2 text-[15px] text-[var(--muted)]">{c.sees}</p>
            <div className="mt-auto pt-5">
              <ButtonLink href={c.href}>{c.action}</ButtonLink>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-8 text-[15px] text-[var(--muted)]">
        How approval works: a facility registers and PS Tech approves it. A district registers under its regional office, and that office approves it. A regional office registers and PS Tech approves it. Already registered?{" "}
        <Link href="/district/login" className="text-[var(--accent-text)] underline underline-offset-4">Supervisor sign-in</Link>
        {" "}or{" "}
        <Link href="/login" className="text-[var(--accent-text)] underline underline-offset-4">facility sign-in</Link>.
      </p>
    </PublicPage>
  );
}
