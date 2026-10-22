"use client";

import Link from "next/link";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import { cedi } from "@/lib/console";
import { EmptyState, Loading, LoadError, PageHeader, StatusBadge, TD, TH, TableScroll } from "@/components/ui";

interface Row { id: string; name: string; status: string; plan: string | null; kind: "trial" | "subscription"; endsOn: string | null; daysLeft: number | null; owingGhs: number; note: string | null }

function State({ r }: { r: Row }) {
  if (r.status === "LAPSED") return <StatusBadge tone="block">Locked, unpaid</StatusBadge>;
  if (r.status === "SUSPENDED") return <StatusBadge tone="block">Suspended</StatusBadge>;
  if (r.daysLeft !== null && r.daysLeft <= 7) return <StatusBadge tone="warning">{r.daysLeft} {r.daysLeft === 1 ? "day" : "days"} left</StatusBadge>;
  return <StatusBadge tone="success">{r.status === "TRIAL" ? "On trial" : "Paid up"}</StatusBadge>;
}

export default function RenewalsPage() {
  const { data, error, reload } = useResource<{ renewals: Row[] }>("/api/platform/renewals");
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading renewals" />;
  return (
    <>
      <PageHeader title="Renewals" description="When each facility's trial or paid month ends. Locked facilities come first, then the ones nearest their date. They are reminded daily in the last week, and locked the day it passes unpaid. Payment by Paystack opens them again for a month by itself." />
      {data.renewals.length === 0 ? (
        <EmptyState title="No facilities yet" />
      ) : (
        <TableScroll label="Renewals">
          <table className="w-full min-w-[48rem] border-collapse text-[15px]">
            <thead>
              <tr>
                {["Facility", "State", "Plan", "Runs to", "Owing"].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.renewals.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className={`${TD} text-left font-medium`}>
                    <Link href={`/platform/facilities/${r.id}`} className="text-[var(--accent-text)] underline-offset-2 hover:underline">{r.name}</Link>
                    {r.note && <span className="block text-sm font-normal text-[var(--muted)]">{r.note}</span>}
                  </th>
                  <td className={TD}><State r={r} /></td>
                  <td className={TD}>{r.plan ?? <span className="text-[var(--muted)]">No plan</span>}{r.plan && <span className="block text-sm text-[var(--muted)]">{r.kind === "trial" ? "trial" : "subscription"}</span>}</td>
                  <td className={`${TD} figures`}>{r.endsOn ? showDate(r.endsOn) : <span className="text-[var(--muted)]">No end date</span>}</td>
                  <td className={`${TD} figures`}>{r.owingGhs > 0 ? cedi(r.owingGhs) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </>
  );
}
