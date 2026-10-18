"use client";

import Link from "next/link";
import { useState } from "react";
import { useResource } from "@/lib/useApi";
import { showDateTime } from "@/lib/format";
import { REQUEST_STATUS } from "@/lib/console";
import { EmptyState, Loading, LoadError, PageHeader, Select, StatusBadge, TD, TH, TableScroll } from "@/components/ui";

interface Row {
  id: string;
  facilityName: string;
  district: string | null;
  contactName: string;
  contactEmail: string;
  createdAt: string;
  ageHours: number;
  status: string;
  assignedTo: string | null;
}
interface Res {
  requests: Row[];
  conversion: { received: number; responded: number; provisioned: number; medianHoursToFirstResponse: number | null };
  publishedHours: number;
}

const age = (h: number) => (h < 48 ? `${h} hours` : `${Math.floor(h / 24)} days`);

export default function RequestsPage() {
  const [filter, setFilter] = useState("");
  const { data, error, reload } = useResource<Res>(`/api/platform/requests${filter ? `?status=${filter}` : ""}`);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading requests" />;
  const c = data.conversion;
  return (
    <>
      <PageHeader
        title="Access requests"
        description="Oldest first. The oldest unanswered request is the one at risk."
        actions={
          <label className="flex items-center gap-2 text-sm">
            Show
            <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-44">
              <option value="">New and contacted</option>
              <option value="ALL">Everything</option>
              {Object.entries(REQUEST_STATUS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </label>
        }
      />
      <dl className="figures mb-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[["Received", String(c.received)], ["Responded", String(c.responded)], ["Provisioned", String(c.provisioned)], ["Median time to first response", c.medianHoursToFirstResponse === null ? "none yet" : `${c.medianHoursToFirstResponse} hours`]].map(([k, v]) => (
          <div key={k} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
            <dt className="text-[var(--muted)]">{k}</dt>
            <dd className="text-lg font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {data.requests.length === 0 ? (
        <EmptyState title="Nothing here">No requests match this filter.</EmptyState>
      ) : (
        <TableScroll label="Access requests">
          <table className="w-full min-w-[44rem] border-collapse text-[15px]">
            <thead>
              <tr>
                {["Facility", "District", "Contact", "Submitted", "Age", "Status", "Assigned"].map((h) => (
                  <th key={h} scope="col" className={TH}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.requests.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className={`${TD} text-left font-medium`}>
                    <Link href={`/platform/requests/${r.id}`} className="text-[var(--accent-text)] underline-offset-2 hover:underline">{r.facilityName}</Link>
                  </th>
                  <td className={TD}>{r.district ?? ""}</td>
                  <td className={TD}>{r.contactName}</td>
                  <td className={`${TD} figures whitespace-nowrap`}>{showDateTime(r.createdAt)}</td>
                  <td className={`${TD} figures whitespace-nowrap`} style={r.status === "NEW" && r.ageHours > data.publishedHours ? { color: "var(--status-block)", fontWeight: 600 } : undefined}>{age(r.ageHours)}</td>
                  <td className={TD}><StatusBadge tone={r.status === "NEW" ? "warning" : r.status === "PROVISIONED" ? "success" : "neutral"}>{REQUEST_STATUS[r.status]}</StatusBadge></td>
                  <td className={TD}>{r.assignedTo ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </>
  );
}
