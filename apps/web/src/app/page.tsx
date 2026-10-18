import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { PublicNav } from "@/components/PublicNav";
import { RosterExample } from "@/components/RosterExample";

export const metadata: Metadata = {
  title: "HealthFlow | A duty roster you can defend",
  description:
    "HealthFlow builds the monthly staff roster for a health facility from its own shifts and rules, checks it against Ghana's Labour Act before it is published, and prints the A4 sheet staff already recognise.",
  openGraph: { title: "HealthFlow | A duty roster you can defend", description: "Duty rostering and labour-law checks for Ghanaian health facilities.", type: "website", locale: "en_GH" },
};

const H2 = "text-2xl font-semibold leading-snug sm:text-3xl";
const SECTION = "mx-auto w-full max-w-5xl px-4 py-12 sm:px-5 sm:py-16";

const PROBLEMS = [
  { t: "Thirty-one days, by hand.", d: "A senior officer spends hours each month drawing a grid of staff against days, usually while carrying a clinical load." },
  { t: "Nothing can be checked.", d: "A paper roster cannot be compared against approved leave, rest entitlements, minimum coverage, or last month's night duties. There is no practical way to hold all of it in view at once." },
  { t: "Errors surface at the shift.", d: "A clash is discovered when somebody does not arrive, not when the roster is drawn." },
];

const STEPS = [
  "Set up your shifts, cadres and rules once.",
  "Generate the month.",
  "Review and resolve what the system flags.",
  "Approve, publish and print.",
];

const FEATURES = [
  { t: "Automatic roster generation", d: "A month built from your shifts, cadres and approved leave." },
  { t: "Duty patterns", d: "5 on 2 off, 4 nights 3 off, or the cycle your facility uses." },
  { t: "Leave with coverage warnings", d: "See who is short before you approve." },
  { t: "Roster-linked attendance", d: "Record who worked against who was rostered." },
  { t: "Duty swaps with checks", d: "A swap is checked against the rules before it is approved." },
  { t: "Duties on a phone", d: "Staff see their own duties without asking the office." },
  { t: "Fairness reporting", d: "Nights, weekends and holidays against the cadre average." },
  { t: "A4 print", d: "The same layout your paper roster already has." },
];

const HERE = [
  "Works for a CHPS compound of six and a hospital of three hundred.",
  "Usable on the phones staff already have.",
  "Prints what staff already read.",
  "Billed in cedis, payable by Mobile Money or bank transfer.",
];

const FAQ = [
  { q: "Do we need internet all the time?", a: "No for reading a published roster you have printed. Yes for generating the roster and recording attendance." },
  { q: "Who owns our data?", a: "You do. You can export all of it at any time, in a spreadsheet format, without asking and without a fee." },
  { q: "What happens if we stop paying?", a: "Your data is not deleted or held. You can export it, and it is removed within 90 days of the agreement ending." },
  { q: "Who can see staff information?", a: "Only people at your facility that you give accounts to. Each staff member can see their own record and nobody else's." },
  { q: "Is staff medical information stored?", a: "No. Sick leave records the leave type and the dates. There is no field anywhere for a condition or a medical note." },
  { q: "Do we have to stop using paper?", a: "No. The system prints the same A4 roster, and most facilities run both for the first month." },
  { q: "What if the roster the system produces is wrong?", a: "Every assignment can be changed by hand, and the system explains why it made each one." },
  { q: "Who is behind this?", a: "PS Tech, a Ghanaian software company in Wa." },
];

const LD = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "SoftwareApplication", name: "HealthFlow", applicationCategory: "BusinessApplication", operatingSystem: "Web", description: "Duty rostering and labour-law checks for health facilities in Ghana." },
    { "@type": "Organization", name: "PS Tech", address: { "@type": "PostalAddress", addressLocality: "Wa", addressRegion: "Upper West Region", addressCountry: "GH" } },
  ],
};

export default function LandingPage() {
  return (
    <>
      <PublicNav />
      <main id="main">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(LD) }} />

        <section className={`${SECTION} grid items-center gap-8 lg:grid-cols-2`}>
          <div>
            <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">A duty roster you can defend.</h1>
            <p className="mt-4 text-lg leading-relaxed text-[var(--muted)]">
              HealthFlow builds your monthly staff roster from your own shifts and rules, checks it against Ghana&apos;s Labour Act before it is published, and prints the A4 sheet your staff already recognise.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <ButtonLink href="/request-access">Request access</ButtonLink>
              <ButtonLink href="#how" variant="secondary">
                See how it works
              </ButtonLink>
            </div>
          </div>
          <RosterExample />
        </section>

        <section className="border-y border-[var(--border)] bg-[var(--surface)]" aria-labelledby="problem">
          <div className={SECTION}>
            <h2 id="problem" className="sr-only">
              The problem
            </h2>
            <div className="grid gap-6 md:grid-cols-3">
              {PROBLEMS.map((p) => (
                <div key={p.t}>
                  <h3 className="text-lg font-semibold">{p.t}</h3>
                  <p className="mt-2 leading-relaxed text-[var(--muted)]">{p.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className={SECTION} aria-labelledby="how-h">
          <h2 id="how-h" className={H2}>
            How it works
          </h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                <span className="figures text-sm font-semibold text-[var(--accent-text)]">Step {i + 1}</span>
                <p className="mt-1">{s}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-y border-[var(--border)] bg-[var(--surface)]" aria-labelledby="checked">
          <div className={`${SECTION} max-w-3xl`}>
            <h2 id="checked" className={H2}>
              Checked before it is published.
            </h2>
            <p className="mt-4 leading-relaxed">
              HealthFlow computes, for every staff member: hours per day and per week, the longest unbroken rest in each seven-day period, the gap between consecutive shifts, consecutive duty days and consecutive nights. It flags what breaches a limit, blocks publication where the breach is statutory, and records any override with a reason and a named approver.
            </p>
            <p className="mt-4 leading-relaxed">
              A night shift running 20:00 to 08:00 is twelve hours against a normal working day of eight. Four of them in a week is forty-eight hours. A morning shift the day after a night shift is not possible at all. These are the things a manual roster misses, and the things a facility is asked about afterwards.
            </p>
            <p className="mt-4 leading-relaxed">At the end of the month, a signed compliance report shows how every duty was scheduled.</p>
          </div>
        </section>

        <section id="features" className={SECTION} aria-labelledby="features-h">
          <h2 id="features-h" className={H2}>
            What it does
          </h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <li key={f.t} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                <h3 className="font-semibold">{f.t}</h3>
                <p className="mt-1 text-[15px] text-[var(--muted)]">{f.d}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="border-y border-[var(--border)] bg-[var(--surface)]" aria-labelledby="here">
          <div className={SECTION}>
            <h2 id="here" className={H2}>
              Built for facilities here
            </h2>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {HERE.map((h) => (
                <li key={h} className="border-l-[3px] border-l-[var(--accent)] pl-3 leading-relaxed">
                  {h}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="pricing" className={SECTION} aria-labelledby="pricing-h">
          <h2 id="pricing-h" className={H2}>
            Pricing
          </h2>
          <p className="mt-3 max-w-2xl leading-relaxed">Prices are in Ghana cedis and depend on the number of staff. Setup and data migration are quoted separately.</p>
          <p className="mt-4">
            <Link href="/pricing" className="text-[var(--accent-text)] underline underline-offset-4">
              See the plans
            </Link>
          </p>
        </section>

        <section className="border-y border-[var(--border)] bg-[var(--surface)]" aria-labelledby="used">
          <div className={`${SECTION} max-w-3xl`}>
            <h2 id="used" className={H2}>
              Where it is being used
            </h2>
            <p className="mt-3 leading-relaxed">HealthFlow is currently being piloted at Sombo Health Centre in the Nadowli-Kaleo District, Upper West Region.</p>
          </div>
        </section>

        <section id="faq" className={`${SECTION} max-w-3xl`} aria-labelledby="faq-h">
          <h2 id="faq-h" className={H2}>
            Questions a facility head asks
          </h2>
          <div className="mt-6 divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-3">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span aria-hidden="true" className="text-[var(--muted)] group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="pb-2 leading-relaxed text-[var(--muted)]">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="border-t border-[var(--border)] bg-[var(--surface)]" aria-labelledby="cta">
          <div className={`${SECTION} flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between`}>
            <h2 id="cta" className="text-2xl font-semibold">
              Ask for a demonstration with your own shifts and staff.
            </h2>
            <ButtonLink href="/request-access">Request access</ButtonLink>
          </div>
        </section>
      </main>
    </>
  );
}
