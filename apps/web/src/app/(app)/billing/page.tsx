"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import { Button, EmptyState, Loading, LoadError, Notice, PageHeader, Panel, StatusBadge, TD, TH, TableScroll } from "@/components/ui";

interface Data {
  facilityStatus: string;
  subscription: { plan: string; monthlyPriceGhs: number; status: string; billingCycle: string; renews: string | null; trialEndsAt: string | null } | null;
  invoices: { id: string; number: string; issuedAt: string; dueAt: string | null; totalGhs: number; status: string; paidAt: string | null }[];
  payOnline: boolean;
  bank: string[] | null;
  plans: { id: string; name: string; monthlyPriceGhs: number; setupPriceGhs: number | null; staffBandMin: number | null; staffBandMax: number | null; current: boolean }[];
  contact: { email: string | null; phone: string | null };
}
const band = (p: Data["plans"][number]) => (p.staffBandMin != null && p.staffBandMax != null ? `${p.staffBandMin} to ${p.staffBandMax} staff` : p.staffBandMax != null ? `Up to ${p.staffBandMax} staff` : p.staffBandMin != null ? `${p.staffBandMin} or more staff` : "Any size");
const cedi = (n: number) => `GH₵ ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function FacilityBilling() {
  const { user } = useAuth();
  const isAdmin = user?.role === "FACILITY_ADMIN";
  const { data, error, reload } = useResource<Data>(isAdmin ? "/api/facility/billing" : null);
  const [say, setSay] = useState<{ tone: "success" | "warning" | "block"; text: string } | null>(null);
  const [returned] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("reference")));
  const [checked, setChecked] = useState(false);
  if (returned && !checked && isAdmin) {
    setChecked(true);
    api.get<{ state: string; invoiceNumber?: string }>(`/api/facility/billing/payments/${returned}`).then((r) => {
      setSay(r.state === "paid" ? { tone: "success", text: `Payment received for invoice ${r.invoiceNumber}. Thank you.` } : r.state === "failed" ? { tone: "block", text: "The payment did not go through. No money was taken. You can try again." } : { tone: "warning", text: "We have not had confirmation of that payment yet. If money left your account, it will show here within a few minutes." });
      reload();
    }).catch(() => setSay({ tone: "warning", text: "We could not check that payment just now. Refresh in a minute." }));
  }
  async function pay(id: string) {
    setSay(null);
    try {
      const r = await api.post<{ url: string }>(`/api/facility/billing/invoices/${id}/pay`, {});
      window.location.assign(r.url);
    } catch (e) {
      setSay({ tone: "block", text: e instanceof ApiError && typeof (e.body as { message?: string })?.message === "string" ? (e.body as { message: string }).message : "Payment could not be started. Try again." });
    }
  }
  if (!isAdmin) return <Notice tone="warning">Only facility admins can see billing.</Notice>;
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading billing" />;
  return (
    <>
      <PageHeader title="Billing" description="Your plan, when it renews, and your invoices." />
      {data.facilityStatus === "LAPSED" && <div className="mb-4"><Notice tone="warning">Access is paused until the bill below is paid. Paying online opens HealthFlow again for you and your staff within a minute.</Notice></div>}
      {data.facilityStatus === "SUSPENDED" && <div className="mb-4"><Notice tone="warning">Your account is suspended. Rosters can still be read and exported. Contact PS Tech.</Notice></div>}
      {say && <div className="mb-4"><Notice tone={say.tone}>{say.text}</Notice></div>}
      <div className="space-y-6">
        <Panel title="Your plan">
          {data.subscription ? (
            <dl className="grid gap-1 text-[15px] sm:grid-cols-[12rem_1fr]">
              <dt className="text-[var(--muted)]">Plan</dt><dd>{data.subscription.plan}, {cedi(data.subscription.monthlyPriceGhs)} a month</dd>
              <dt className="text-[var(--muted)]">Billed</dt><dd>{data.subscription.billingCycle.toLowerCase()}</dd>
              <dt className="text-[var(--muted)]">State</dt><dd>{data.subscription.status.replace("_", " ").toLowerCase()}</dd>
              {data.subscription.renews && <><dt className="text-[var(--muted)]">Next renewal</dt><dd className="figures">{showDate(data.subscription.renews)}</dd></>}
              {data.subscription.trialEndsAt && <><dt className="text-[var(--muted)]">Trial ends</dt><dd className="figures">{showDate(data.subscription.trialEndsAt)}</dd></>}
            </dl>
          ) : <p className="text-[15px]">No plan has been set for your facility yet.</p>}
        </Panel>
        <div id="ways-to-pay" className="scroll-mt-4"><Panel title="Ways to pay" description="Invoices and payments.">
          <div className="grid gap-3 md:grid-cols-3">
            {[
              { name: "Mobile money", text: "MTN MoMo, Telecel Cash and AirtelTigo Money. Approve the prompt on your phone.", live: data.payOnline, icon: <><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18.5h2" /></> },
              { name: "Card", text: "Visa and Mastercard, paid on Paystack's secure page. Your card details never reach HealthFlow.", live: data.payOnline, icon: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19M6 15h4" /></> },
              { name: "Bank transfer", text: data.bank ? "Pay into the PS Tech account below and quote the invoice number. We confirm it by hand, usually within a working day." : "Pay into the PS Tech account and quote the invoice number. Ask for the account details below.", live: true, icon: <><path d="M3 9.5 12 4l9 5.5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" /></> },
            ].map((m) => (
              <div key={m.name} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-start justify-between gap-2">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{m.icon}</svg>
                  <StatusBadge tone={m.live ? "success" : "neutral"}>{m.live ? "Available" : "Switching on soon"}</StatusBadge>
                </div>
                <h3 className="mt-2 font-semibold">{m.name}</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">{m.text}</p>
              </div>
            ))}
          </div>
          {data.bank ? (
            <div className="mt-4 rounded-[var(--radius)] bg-[var(--surface-2)] p-4 text-[15px]">
              <p className="mb-1 font-medium">Bank transfer details</p>
              {data.bank.map((l) => <p key={l} className="figures">{l}</p>)}
              <p className="mt-2 text-sm text-[var(--muted)]">Use the invoice number as the payment reference, then send the receipt to {data.contact.email ?? "PS Tech"} so we can match it sooner.</p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--muted)]">{data.contact.email ? <>Write to <a className="font-medium text-[var(--accent-text)] underline underline-offset-2" href={`mailto:${data.contact.email}?subject=Bank%20details%20for%20payment`}>{data.contact.email}</a> for the bank details.</> : "Contact PS Tech for the bank details."}{!data.payOnline && " Mobile money and card open as soon as online payment is switched on for HealthFlow."}</p>
          )}
        </Panel></div>
        {data.plans.length > 0 && (
          <Panel title="Plans" description="Priced by the number of active staff. Prices are per month in Ghana cedis.">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {data.plans.map((p) => (
                <div key={p.id} className={`rounded-[var(--radius)] border p-4 ${p.current ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] bg-[var(--surface)]"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold">{p.name}</h3>
                    {p.current && <StatusBadge tone="success">Your plan</StatusBadge>}
                  </div>
                  <p className="figures mt-2 text-xl font-semibold">{cedi(p.monthlyPriceGhs)}<span className="text-sm font-normal text-[var(--muted)]"> a month</span></p>
                  <p className="mt-1 text-sm text-[var(--muted)]">{band(p)}</p>
                  <p className="text-sm text-[var(--muted)]">{p.setupPriceGhs ? `One-off setup ${cedi(p.setupPriceGhs)}` : "No setup fee"}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm text-[var(--muted)]">To change plan, write to {data.contact.email ?? "PS Tech"}. The change takes effect from your next billing period.</p>
          </Panel>
        )}
        <Panel title="Invoices">
          {data.invoices.length === 0 ? <EmptyState title="No invoices yet" /> : (
            <TableScroll label="Invoices">
              <table className="w-full min-w-[34rem] border-collapse text-[15px]">
                <thead><tr>{["Number", "Issued", "Due", "Amount", "Status", ""].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.invoices.map((i) => (
                    <tr key={i.id}>
                      <th scope="row" className={`${TD} figures text-left font-medium`}>{i.number}</th>
                      <td className={`${TD} figures`}>{showDate(i.issuedAt)}</td>
                      <td className={`${TD} figures`}>{i.dueAt ? showDate(i.dueAt) : ""}</td>
                      <td className={`${TD} figures`}>{cedi(i.totalGhs)}</td>
                      <td className={TD}><StatusBadge tone={i.status === "PAID" ? "success" : i.status === "OVERDUE" ? "block" : "neutral"}>{i.status.replace("_", " ").toLowerCase()}</StatusBadge></td>
                      <td className={TD}><div className="flex flex-wrap gap-2">{data.payOnline && i.status !== "PAID" && i.status !== "WRITTEN_OFF" && <Button onClick={() => pay(i.id)}>Pay online</Button>}{!data.payOnline && i.status !== "PAID" && i.status !== "WRITTEN_OFF" && <Button variant="secondary" onClick={() => document.getElementById("ways-to-pay")?.scrollIntoView({ behavior: "smooth" })}>How to pay</Button>}<Button variant="secondary" onClick={() => api.download(`/api/facility/billing/invoices/${i.id}/pdf`, `${i.number}.pdf`)}>Download PDF</Button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Panel>
        {data.payOnline && <p className="text-sm text-[var(--muted)]">Pay online by mobile money, card or bank, or transfer using the invoice details.</p>}
        <Panel title="Questions about billing">
          <p className="text-[15px]">{data.contact.email ? `Write to ${data.contact.email}` : "Contact PS Tech"}{data.contact.phone ? ` or call ${data.contact.phone}` : ""}.</p>
        </Panel>
      </div>
    </>
  );
}
