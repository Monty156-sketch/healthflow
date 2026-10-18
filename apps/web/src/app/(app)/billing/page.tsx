"use client";

import { useState } from "react";
import { useFacility } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import { Button, EmptyState, Loading, LoadError, Notice, PageHeader, Panel, StatusBadge, TD, TH, TableScroll } from "@/components/ui";

interface Data {
  facilityStatus: string;
  subscription: { plan: string; monthlyPriceGhs: number; status: string; billingCycle: string; renews: string | null; trialEndsAt: string | null } | null;
  invoices: { id: string; number: string; issuedAt: string; dueAt: string | null; totalGhs: number; status: string; paidAt: string | null }[];
  payOnline: boolean;
  contact: { email: string | null; phone: string | null };
}
const cedi = (n: number) => `GH₵ ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function FacilityBilling() {
  const { isAdmin } = useFacility();
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
      {data.facilityStatus === "SUSPENDED" && <div className="mb-4"><Notice tone="warning">Your account is suspended. You can still read your rosters and export all of your data. Contact PS Tech to restore changes.</Notice></div>}
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
                      <td className={TD}><div className="flex flex-wrap gap-2">{data.payOnline && i.status !== "PAID" && i.status !== "WRITTEN_OFF" && <Button onClick={() => pay(i.id)}>Pay online</Button>}<Button variant="secondary" onClick={() => api.download(`/api/facility/billing/invoices/${i.id}/pdf`, `${i.number}.pdf`)}>Download PDF</Button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Panel>
        {data.payOnline && <p className="text-sm text-[var(--muted)]">Pay online takes you to Paystack, where you can pay by mobile money, card or bank transfer. Bank transfer to PS Tech directly is also accepted, using the details on the invoice.</p>}
        <Panel title="Questions about billing">
          <p className="text-[15px]">{data.contact.email ? `Write to ${data.contact.email}` : "Contact PS Tech"}{data.contact.phone ? ` or call ${data.contact.phone}` : ""}.</p>
        </Panel>
      </div>
    </>
  );
}
