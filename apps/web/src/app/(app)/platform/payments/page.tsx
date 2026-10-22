"use client";

import Link from "next/link";
import { useState } from "react";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import { cedi } from "@/lib/console";
import { EmptyState, Field, Input, Loading, LoadError, PageHeader, Panel, StatusBadge, TD, TH, TableScroll } from "@/components/ui";

interface Data {
  month: string | null;
  payments: { id: string; number: string; facilityId: string; facility: string; totalGhs: number; paidAt: string | null; method: string | null; reference: string | null }[];
  receivedGhs: number;
  facilities: { id: string; name: string; status: string; payments: number; paidGhs: number; lastPaidAt: string | null; paidUpTo: string | null }[];
}

const words = (t: string | null) => (t ? t.toLowerCase().replace(/_/g, " ") : "");

export default function PaymentsPage() {
  const [month, setMonth] = useState("");
  const { data, error, reload } = useResource<Data>(`/api/platform/payments${month ? `?month=${month}` : ""}`);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading payments" />;
  return (
    <>
      <PageHeader title="Payments" description="Every payment received, and which facilities are paying. Online payments appear here by themselves once Paystack confirms them." />
      <div className="mb-4 max-w-xs">
        <Field label="Month" hint="Leave empty for the latest payments.">{(a) => <Input {...a} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />}</Field>
      </div>
      <div className="space-y-6">
        <Panel title={`Received${data.month ? ` in ${data.month}` : ""}: ${cedi(data.receivedGhs)} from ${data.payments.length} ${data.payments.length === 1 ? "payment" : "payments"}`}>
          {data.payments.length === 0 ? <EmptyState title="No payments" /> : (
            <TableScroll label="Payments received">
              <table className="w-full min-w-[44rem] border-collapse text-[15px]">
                <thead><tr>{["Paid", "Facility", "Invoice", "Amount", "How", "Reference"].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.id}>
                      <td className={`${TD} figures`}>{showDate(p.paidAt)}</td>
                      <th scope="row" className={`${TD} text-left font-medium`}><Link href={`/platform/facilities/${p.facilityId}`} className="text-[var(--accent-text)] underline-offset-2 hover:underline">{p.facility}</Link></th>
                      <td className={`${TD} figures`}>{p.number}</td>
                      <td className={`${TD} figures`}>{cedi(p.totalGhs)}</td>
                      <td className={TD}>{words(p.method)}</td>
                      <td className={`${TD} figures`}>{p.reference}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Panel>
        <Panel title="Facilities and what they have paid">
          <TableScroll label="Payment record by facility">
            <table className="w-full min-w-[44rem] border-collapse text-[15px]">
              <thead><tr>{["Facility", "State", "Payments", "Total paid", "Last paid", "Paid up to"].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
              <tbody>
                {data.facilities.map((f) => (
                  <tr key={f.id}>
                    <th scope="row" className={`${TD} text-left font-medium`}><Link href={`/platform/facilities/${f.id}`} className="text-[var(--accent-text)] underline-offset-2 hover:underline">{f.name}</Link></th>
                    <td className={TD}><StatusBadge tone={f.status === "ACTIVE" ? "success" : f.status === "TRIAL" ? "neutral" : "block"}>{f.status === "LAPSED" ? "locked, unpaid" : f.status.toLowerCase()}</StatusBadge></td>
                    <td className={`${TD} figures`}>{f.payments}</td>
                    <td className={`${TD} figures`}>{f.paidGhs ? cedi(f.paidGhs) : ""}</td>
                    <td className={`${TD} figures`}>{f.lastPaidAt ? showDate(f.lastPaidAt) : <span className="text-[var(--muted)]">Never</span>}</td>
                    <td className={`${TD} figures`}>{f.paidUpTo ? showDate(f.paidUpTo) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      </div>
    </>
  );
}
