"use client";

import Link from "next/link";
import { useResource } from "@/lib/useApi";
import { PublicPage, PublicSection } from "@/components/PublicPage";
import { ButtonLink, Loading } from "@/components/ui";

interface Plan {
  id: string;
  name: string;
  monthlyPriceGhs: number;
  setupPriceGhs: number | null;
  staffBandMin: number | null;
  staffBandMax: number | null;
  features: string[];
}

const cedi = (n: number) => `GH₵ ${n.toLocaleString("en-GH", { maximumFractionDigits: 2 })}`;
const band = (p: Plan) => (p.staffBandMin && p.staffBandMax ? `${p.staffBandMin} to ${p.staffBandMax} staff` : p.staffBandMax ? `Up to ${p.staffBandMax} staff` : p.staffBandMin ? `${p.staffBandMin} staff or more` : "Any number of staff");

export default function PricingPage() {
  const { data, error } = useResource<{ plans: Plan[] }>("/api/public/plans");
  return (
    <PublicPage title="Pricing" intro="Prices are in Ghana cedis and depend on the number of staff at the facility. A one-off setup fee applies to the larger plans. If your facility has more than 2,000 staff, call us and we will quote." wide>
      {!data && !error && <Loading label="Loading plans" />}
      {data && data.plans.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {data.plans.map((p) => (
            <section key={p.id} className="flex flex-col rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5" aria-labelledby={`plan-${p.id}`}>
              <h2 id={`plan-${p.id}`} className="text-lg font-semibold">
                {p.name}
              </h2>
              <p className="text-sm text-[var(--muted)]">{band(p)}</p>
              <p className="figures mt-3 text-3xl font-semibold">
                {cedi(p.monthlyPriceGhs)}
                <span className="text-base font-normal text-[var(--muted)]"> a month</span>
              </p>
              <p className="text-sm text-[var(--muted)]">{p.setupPriceGhs ? `Setup: ${cedi(p.setupPriceGhs)}, once` : "No setup fee"}</p>
              {p.features.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-[15px]">
                  {p.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
      {(error || (data && data.plans.length === 0)) && (
        <p className="rounded-[var(--radius)] border border-[var(--border)] border-l-[3px] border-l-[var(--status-warning)] bg-[var(--surface)] p-4 leading-relaxed">
          The plan prices for the pilot are being confirmed. Ask us for a figure for your facility and we will give it in writing, in cedis.
        </p>
      )}
      <PublicSection title="What is quoted separately">
        <p>Setting up your shifts, cadres and rules with you, and moving an existing staff list in, are quoted once, before anything is agreed.</p>
      </PublicSection>
      <PublicSection title="How facilities pay">
        <p>Public facilities usually pay by invoice and bank transfer after their own procurement process. We issue a proper invoice showing the facility, the period and the amount in cedis. Private facilities can pay by Mobile Money.</p>
        <p>If your facility needs a budget line or a funding route, tell us. We will give you a written quotation to take to that conversation.</p>
      </PublicSection>
      <PublicSection title="If you stop">
        <p>Your data is yours. You can export all of it at any time without asking and without a fee, and it is deleted within 90 days of the agreement ending. An unpaid invoice never locks you out of your data. Read the <Link href="/terms" className="text-[var(--accent-text)] underline underline-offset-2">Terms</Link>.</p>
      </PublicSection>
      <ButtonLink href="/request-access">Request access</ButtonLink>
    </PublicPage>
  );
}
