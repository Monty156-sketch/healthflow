"use client";

import Link from "next/link";
import { useResource } from "@/lib/useApi";
import { showDateTime } from "@/lib/format";
import { EmptyState, Loading, LoadError, PageHeader, Panel, StatusBadge } from "@/components/ui";

interface Dash {
  requests: { waiting: number; oldestHours: number | null; publishedHours: number; late: boolean };
  invoices: { overdue: number; outstandingGhs: number };
  atRisk: number;
  errors24h: number;
  activeFacilities: number;
  mrrGhs: number;
  recentRequests: { id: string; facilityName: string; district: string | null; status: string; createdAt: string }[];
  recentErrors: { id: string; description: string; screen: string | null; status: string; createdAt: string; facility: string | null }[];
}

const cedi = (n: number) => `GH₵ ${n.toLocaleString("en-GH", { maximumFractionDigits: 0 })}`;
const age = (h: number) => (h < 48 ? `${h} hours` : `${Math.floor(h / 24)} days`);

function Count({ href, label, value, note, tone }: { href: string; label: string; value: string; note?: string; tone?: "block" | "warning" }) {
  return (
    <Link href={href} className="block rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 hover:bg-[var(--accent-soft)]" style={tone ? { borderLeft: `3px solid var(--status-${tone})` } : undefined}>
      <p className="text-sm text-[var(--muted)]">{label}</p>
      <p className="figures mt-1 text-3xl font-semibold">{value}</p>
      {note && <p className="mt-1 text-sm" style={tone ? { color: `var(--status-${tone})` } : { color: "var(--muted)" }}>{note}</p>}
    </Link>
  );
}

export default function ConsolePage() {
  const { data, error, reload } = useResource<Dash>("/api/platform/dashboard");
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading the console" />;
  const r = data.requests;
  return (
    <>
      <PageHeader title="Console" description="What needs you today." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Count
          href="/admin/requests"
          label="Requests awaiting a first response"
          value={String(r.waiting)}
          note={r.oldestHours === null ? "None waiting" : `Oldest: ${age(r.oldestHours)}${r.late ? `, past the ${r.publishedHours} hours we publish` : ""}`}
          tone={r.late ? "block" : undefined}
        />
        <Count href="/admin/facilities?health=AT_RISK" label="Facilities at risk" value={String(data.atRisk)} note={data.atRisk ? "Telephone them" : "None"} tone={data.atRisk ? "block" : undefined} />
        <Count href="/admin/billing" label="Overdue invoices" value={String(data.invoices.overdue)} note={`${cedi(data.invoices.outstandingGhs)} outstanding`} tone={data.invoices.overdue ? "warning" : undefined} />
        <Count href="/system-health" label="Errors in the last 24 hours" value={String(data.errors24h)} />
        <Count href="/admin/billing" label="Active facilities" value={String(data.activeFacilities)} note={`Monthly recurring revenue ${cedi(data.mrrGhs)}`} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Latest access requests" actions={<Link href="/admin/requests" className="text-sm text-[var(--accent-text)] underline underline-offset-2">All requests</Link>}>
          {data.recentRequests.length === 0 ? (
            <EmptyState title="No requests yet" />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.recentRequests.map((q) => (
                <li key={q.id}>
                  <Link href={`/admin/requests/${q.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="block font-medium">{q.facilityName}</span>
                      <span className="block text-sm text-[var(--muted)]">{[q.district, showDateTime(q.createdAt)].filter(Boolean).join(" · ")}</span>
                    </span>
                    <StatusBadge tone={q.status === "NEW" ? "warning" : "neutral"}>{q.status.replace(/_/g, " ").toLowerCase()}</StatusBadge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Latest error reports" actions={<Link href="/system-health" className="text-sm text-[var(--accent-text)] underline underline-offset-2">System health</Link>}>
          {data.recentErrors.length === 0 ? (
            <EmptyState title="No error reports" />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.recentErrors.map((e) => (
                <li key={e.id} className="py-2">
                  <p className="text-[15px]">{e.description}</p>
                  <p className="text-sm text-[var(--muted)]">{[e.facility, e.screen, showDateTime(e.createdAt)].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
