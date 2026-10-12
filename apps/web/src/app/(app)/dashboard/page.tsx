"use client";

import Link from "next/link";
import { useFacility } from "@/components/AppShell";
import { useResource } from "@/lib/useApi";
import { FACILITY_TYPE, showDateTime } from "@/lib/format";
import { PageHeader, Panel, StatusBadge } from "@/components/ui";

interface AuditEntry {
  id: string;
  createdAt: string;
  summary: string;
}

/** The facility's set-up, in the order it has to be done. */
function SetupSteps() {
  const { facility, setup, isAdmin } = useFacility();
  const steps = [
    {
      title: "Facility details",
      done: Boolean(facility.region && facility.ghsFacilityCode),
      detail: facility.region ? `${FACILITY_TYPE[facility.facilityType]} in ${facility.region}` : "Region and GHS facility code not set yet",
      href: "/settings",
      action: "Review details",
      adminOnly: true,
    },
    {
      title: "Departments",
      done: setup.departments > 0,
      detail: setup.departments ? `${setup.departments} active` : "None yet. Rosters are grouped by department.",
      href: "/departments-and-cadres",
      action: setup.departments ? "View departments" : "Add departments",
    },
    {
      title: "Cadres",
      done: setup.cadres > 0,
      detail: setup.cadres ? `${setup.cadres} active` : "None yet. Each staff member belongs to a cadre.",
      href: "/departments-and-cadres#cadres",
      action: setup.cadres ? "View cadres" : "Add cadres",
    },
    {
      title: "Staff",
      done: setup.staff > 0,
      detail: setup.staff ? `${setup.staff} current staff` : "No staff yet.",
      href: "/staff",
      action: setup.staff ? "View staff" : "Add staff",
    },
  ].filter((s) => isAdmin || !s.adminOnly);

  return (
    <Panel title="Setting up your facility" description="Shifts, duty rules and roster generation are set up in the next phase.">
      <ol className="divide-y divide-[var(--border)]">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
            <span className="figures w-6 text-[var(--muted)]" aria-hidden="true">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{s.title}</p>
              <p className="text-sm text-[var(--muted)]">{s.detail}</p>
            </div>
            <StatusBadge tone={s.done ? "success" : "warning"}>{s.done ? "Done" : "To do"}</StatusBadge>
            <Link href={s.href} className="flex min-h-11 items-center text-sm font-medium text-[var(--accent-text)] underline-offset-4 hover:underline">
              {s.action}
            </Link>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function RecentActivity() {
  const { data, error } = useResource<{ entries: AuditEntry[] }>("/api/facility/audit-log?pageSize=10");
  const entries = data?.entries.slice(0, 5) ?? [];
  return (
    <Panel
      title="Recent activity"
      actions={
        <Link href="/audit-log" className="flex min-h-11 items-center text-sm font-medium text-[var(--accent-text)] underline-offset-4 hover:underline">
          Full audit log
        </Link>
      }
    >
      {error && <p className="text-sm text-[var(--muted)]">Recent activity could not be loaded.</p>}
      {!error && !data && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {data && entries.length === 0 && <p className="text-sm text-[var(--muted)]">Nothing has been changed yet.</p>}
      {entries.length > 0 && (
        <ul className="space-y-3">
          {entries.map((e) => (
            <li key={e.id}>
              <p className="text-[15px]">{e.summary}</p>
              <p className="figures text-[13px] text-[var(--muted)]">{showDateTime(e.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default function OverviewPage() {
  const { facility, isAdmin } = useFacility();
  const place = [facility.subDistrict, facility.region].filter(Boolean).join(", ");
  return (
    <>
      <PageHeader
        title={facility.name}
        description={`${FACILITY_TYPE[facility.facilityType] ?? "Facility"}${place ? `, ${place}` : ""}`}
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <SetupSteps />
        {isAdmin && <RecentActivity />}
      </div>
    </>
  );
}
