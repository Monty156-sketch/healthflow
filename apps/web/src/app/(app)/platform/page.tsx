"use client";

import Link from "next/link";
import { useResource } from "@/lib/useApi";
import { showDateTime } from "@/lib/format";
import { EmptyState, Loading, LoadError, Panel, StatusBadge } from "@/components/ui";
import { CountUp, Lift, Stagger, StaggerItem } from "@/components/motion";

interface Dash {
  invoices: { overdue: number; outstandingGhs: number };
  atRisk: number;
  errors24h: number;
  activeFacilities: number;
  mrrGhs: number;
  trials: { onTrial: number; endingThisWeek: number; expired: number };
  rostersPublishedThisMonth: number;
  access: { pendingApproval: number; lapsed: number; suspended: number };
  newestFacilities: { id: string; name: string; district: string | null; status: string; createdAt: string }[];
  recentErrors: { id: string; description: string; screen: string | null; status: string; createdAt: string; facility: string | null }[];
}

const cedi = (n: number) => `GH₵ ${n.toLocaleString("en-GH", { maximumFractionDigits: 0 })}`;

function Count({ href, label, value, note, tone, money }: { href: string; label: string; value: number; note?: string; tone?: "block" | "warning"; money?: boolean }) {
  const dot = tone ? `var(--status-${tone})` : "var(--accent)";
  return (
    <StaggerItem className="h-full">
      <Lift className="h-full">
        <Link href={href} className="block h-full rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 hover:border-[var(--border-strong)] sm:p-5">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: dot }} />
            <p className="text-sm font-medium text-[var(--muted)]">{label}</p>
          </div>
          <p className="figures mt-3 text-3xl leading-none sm:text-4xl font-semibold tracking-tight">
            <CountUp value={value} format={money ? cedi : undefined} />
          </p>
          {note && <p className="mt-2 text-sm" style={tone ? { color: `var(--status-${tone})` } : { color: "var(--muted)" }}>{note}</p>}
        </Link>
      </Lift>
    </StaggerItem>
  );
}

const greeting = () => {
  const h = new Date().getUTCHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export default function ConsolePage() {
  const { data, error, reload } = useResource<Dash>("/api/platform/dashboard");
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading the console" />;
  return (
    <>
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">{greeting()}</h1>
        <p className="mt-1 text-lg text-[var(--muted)]">
          {data.access.pendingApproval + data.atRisk + data.invoices.overdue > 0 ? "Here is what needs you today." : "Nothing is waiting for you. Here is how the platform looks."}
        </p>
      </header>
      <Stagger className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Count href="/platform/registrations" label="Registrations waiting" value={data.access.pendingApproval} note={data.access.pendingApproval ? "Approve or decline" : "None"} tone={data.access.pendingApproval ? "warning" : undefined} />
        <Count href="/platform/renewals" label="Locked for non-payment" value={data.access.lapsed} note={data.access.suspended ? `${data.access.suspended} suspended by hand` : "None suspended"} tone={data.access.lapsed ? "block" : undefined} />
        <Count href="/platform/facilities?health=AT_RISK" label="Facilities at risk" value={data.atRisk} note={data.atRisk ? "Telephone them" : "None"} tone={data.atRisk ? "block" : undefined} />
        <Count href="/platform/billing" label="Overdue invoices" value={data.invoices.overdue} note={`${cedi(data.invoices.outstandingGhs)} outstanding`} tone={data.invoices.overdue ? "warning" : undefined} />
        <Count href="/system-health" label="Errors in the last 24 hours" value={data.errors24h} />
        <Count href="/platform/trials" label="Facilities on trial" value={data.trials.onTrial} note={data.trials.expired ? `${data.trials.expired} past the end date` : data.trials.endingThisWeek ? `${data.trials.endingThisWeek} ending this week` : "None ending this week"} tone={data.trials.expired ? "block" : data.trials.endingThisWeek ? "warning" : undefined} />
        <Count href="/platform/facilities" label="Rosters published this month" value={data.rostersPublishedThisMonth} />
        <Count href="/platform/billing" label="Active facilities" value={data.activeFacilities} note={`Monthly recurring revenue ${cedi(data.mrrGhs)}`} />
      </Stagger>
      <Stagger delay={0.25} className="mt-6 grid gap-6 lg:grid-cols-2">
        <StaggerItem><Panel title="Newest facilities" actions={<Link href="/platform/facilities" className="text-sm text-[var(--accent-text)] underline underline-offset-2">All facilities</Link>}>
          {data.newestFacilities.length === 0 ? (
            <EmptyState title="No facilities yet" />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.newestFacilities.map((f) => (
                <li key={f.id}>
                  <Link href={`/platform/facilities/${f.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="block font-medium">{f.name}</span>
                      <span className="block text-sm text-[var(--muted)]">{[f.district, showDateTime(f.createdAt)].filter(Boolean).join(" · ")}</span>
                    </span>
                    <StatusBadge tone={f.status === "ACTIVE" ? "success" : f.status === "PENDING" ? "warning" : ["SUSPENDED", "LAPSED", "DECLINED"].includes(f.status) ? "block" : "neutral"}>{f.status.toLowerCase()}</StatusBadge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel></StaggerItem>
        <StaggerItem><Panel title="Latest error reports" actions={<Link href="/system-health" className="text-sm text-[var(--accent-text)] underline underline-offset-2">System health</Link>}>
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
        </Panel></StaggerItem>
      </Stagger>
    </>
  );
}
