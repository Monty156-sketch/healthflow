import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/PublicPage";

export const metadata: Metadata = { title: "Help | HealthFlow", description: "How to set up a facility and run a roster in HealthFlow." };

const A = "text-[var(--accent-text)] underline underline-offset-2";

const ARTICLES: { id: string; title: string; body: string[] }[] = [
  { id: "setup", title: "Setting up your facility", body: [
    "Sign in as the facility administrator and open Overview. It lists the set-up steps in the order they should be done: facility details, departments, cadres, then staff.",
    "Departments group the roster. Cadres are the professional groups, such as midwives or nurses, and each staff member belongs to one. Add staff once these exist.",
  ] },
  { id: "shifts", title: "Configuring shifts", body: [
    "Open Shifts. Give each shift a name, a start and end time, and the minimum number of people it needs. A shift that ends after midnight is marked overnight.",
    "A shift can be limited to certain cadres. Off duty is a shift too, and does not count as a duty.",
  ] },
  { id: "patterns", title: "Understanding duty patterns", body: [
    "A duty pattern is a cycle such as five duties then two days off, or four nights then three off. Open Duty cycles to see the patterns, choose which shifts count towards them, and see a preview.",
    "A pattern can be a firm rule or a preference. Firm rules are never broken when a roster is generated.",
  ] },
  { id: "generate", title: "Generating your first roster", body: [
    "Open Roster, choose the month and generate. First the system checks for problems it cannot fix, such as a shift that needs more people than are available, and tells you before it builds anything.",
    "Review the result in the grid. Each duty can be changed by hand. Approve and publish when you are satisfied. Staff are told when a roster is published.",
  ] },
  { id: "findings", title: "What the compliance findings mean", body: [
    "A red finding blocks publication. It is a statutory limit or a physical impossibility, such as two shifts that overlap. Fix it, or where the rule allows it, record an override with a reason. The override is kept with your name.",
    "An amber finding is a warning. It does not stop publication, but it is listed in the compliance report.",
  ] },
  { id: "accounts", title: "Adding staff accounts", body: [
    "Open a staff member and choose to give them access. They receive an invitation, set a password and set up two-step sign-in with an authenticator app. A staff member who signs in sees only their own duties, leave and swaps.",
    "If someone leaves, set their status to inactive. Their access ends immediately.",
  ] },
  { id: "attendance", title: "Recording attendance", body: [
    "Open Daily attendance. Each rostered person for the day is listed. Mark whether they worked, were absent, or were late. A correction is recorded with a reason and does not erase the first entry.",
  ] },
  { id: "export", title: "Exporting your data", body: [
    "A facility administrator can export the roster as an A4 PDF or an Excel workbook from the roster page, and the compliance and fairness reports as PDF or CSV from Reports. Your data is yours and exporting costs nothing.",
  ] },
];

export default function HelpPage() {
  return (
    <PublicPage title="Help" intro="Short answers to the questions we are asked most, written for a facility administrator.">
      <nav aria-label="Articles">
        <ul className="grid gap-1 sm:grid-cols-2">
          {ARTICLES.map((a) => (
            <li key={a.id}>
              <a href={`#${a.id}`} className={`${A} inline-flex min-h-11 items-center`}>
                {a.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {ARTICLES.map((a) => (
        <section key={a.id} id={a.id} aria-labelledby={`${a.id}-h`} className="scroll-mt-20">
          <h2 id={`${a.id}-h`} className="mb-2 text-xl font-semibold">
            {a.title}
          </h2>
          <div className="space-y-3 leading-relaxed">
            {a.body.map((b) => (
              <p key={b}>{b}</p>
            ))}
          </div>
        </section>
      ))}
      <p>
        Not answered here? <Link href="/contact" className={A}>Contact us</Link>.
      </p>
    </PublicPage>
  );
}
