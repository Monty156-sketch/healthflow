"use client";

import Link from "next/link";
import { useFacility, useOptionalFacility } from "@/components/AppShell";
import { useResource } from "@/lib/useApi";
import { FACILITY_TYPE, MONTHS, showDate, showDateTime } from "@/lib/format";
import { Loading, LoadError, PageHeader, Panel, StatusBadge } from "@/components/ui";

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

interface Dash {
  date: string;
  staff: { total: number; active: number; onLeaveToday: number };
  today: {
    scheduled: number;
    recorded: number;
    present: number;
    late: number;
    absent: number;
    shifts: { id: string; name: string; code: string; colour: string | null; startTime: string | null; endTime: string | null; minStaff: number; scheduled: number }[];
  };
  roster: {
    status: string;
    version: number;
    publishedAt: string | null;
    attendanceCompleteness: number | null;
    hasUnresolvedConflicts: boolean;
    openBlocks: number;
    openWarnings: number;
  } | null;
  month: number;
  year: number;
  nextMonthStatus: string | null;
  waiting: { leave: number; swaps: number; returnsDue: number; returnsOverdue: number };
  week: { date: string; scheduled: number; present: number; absent: number; recorded: number }[];
}

const ROSTER_STATUS: Record<string, { label: string; tone: "neutral" | "warning" | "success" }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  GENERATED: { label: "Generated", tone: "warning" },
  UNDER_REVIEW: { label: "Under review", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  PUBLISHED: { label: "Published", tone: "success" },
  ARCHIVED: { label: "Archived", tone: "neutral" },
};

function Kpi({ label, value, note, href }: { label: string; value: string | number; note: string; href?: string }) {
  const body = (
    <div className="h-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-[13px] font-medium text-[var(--muted)]">{label}</p>
      <p className="figures mt-1 text-3xl font-semibold leading-tight">{value}</p>
      <p className="mt-1 text-[13px] text-[var(--muted)]">{note}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-lg outline-offset-2 hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}

function Bar({ value, max, colour }: { value: number; max: number; colour: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--accent-soft)]">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: colour }} />
    </div>
  );
}

function TodayCover({ d }: { d: Dash }) {
  return (
    <Panel title="Today's cover" description={`Scheduled against the minimum for each shift, ${showDate(d.date)}.`}>
      {d.today.shifts.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No shifts are set up yet.</p>
      ) : (
        <ul className="space-y-4">
          {d.today.shifts.map((s) => {
            const short = s.minStaff > 0 && s.scheduled < s.minStaff;
            return (
              <li key={s.id}>
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">
                    {s.name}
                    {s.startTime && s.endTime && <span className="ml-2 text-sm font-normal text-[var(--muted)]">{s.startTime} to {s.endTime}</span>}
                  </p>
                  <p className="figures text-sm">
                    {s.scheduled} scheduled{s.minStaff > 0 ? ` of ${s.minStaff} needed` : ""}
                    {short && <span className="ml-2 font-medium text-[var(--status-warning)]">Short by {s.minStaff - s.scheduled}</span>}
                  </p>
                </div>
                <Bar value={s.scheduled} max={Math.max(s.minStaff, s.scheduled)} colour={short ? "var(--status-warning)" : (s.colour ?? "var(--accent)")} />
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function Week({ d }: { d: Dash }) {
  const max = Math.max(1, ...d.week.map((w) => w.scheduled));
  return (
    <Panel title="Last 7 days" description="Staff scheduled, and how many of them were recorded present.">
      <div className="flex h-40 items-end gap-2" role="img" aria-label="Scheduled and present staff for each of the last seven days">
        {d.week.map((w) => {
          const day = new Date(`${w.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
          return (
            <div key={w.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <div className="flex h-full w-full items-end justify-center gap-1">
                <div className="w-1/2 max-w-6 rounded-t bg-[var(--accent-soft)]" style={{ height: `${(w.scheduled / max) * 100}%`, minHeight: w.scheduled ? 2 : 0 }} title={`${w.scheduled} scheduled`} />
                <div className="w-1/2 max-w-6 rounded-t bg-[var(--accent)]" style={{ height: `${(w.present / max) * 100}%`, minHeight: w.present ? 2 : 0 }} title={`${w.present} present`} />
              </div>
              <span className="text-[12px] text-[var(--muted)]">{day}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-[13px] text-[var(--muted)]">
        <span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--accent-soft)]" /> Scheduled</span>
        <span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--accent)]" /> Present</span>
      </div>
    </Panel>
  );
}

function RosterCard({ d }: { d: Dash }) {
  const r = d.roster;
  const st = r ? ROSTER_STATUS[r.status] : null;
  return (
    <Panel
      title={`${MONTHS[d.month - 1]} roster`}
      actions={
        <Link href="/roster" className="flex min-h-11 items-center text-sm font-medium text-[var(--accent-text)] underline-offset-4 hover:underline">
          Open rosters
        </Link>
      }
    >
      {!r ? (
        <p className="text-sm text-[var(--muted)]">There is no roster for this month yet.</p>
      ) : (
        <dl className="space-y-3 text-[15px]">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-[var(--muted)]">Status</dt>
            <dd>{st && <StatusBadge tone={st.tone}>{st.label}</StatusBadge>}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-[var(--muted)]">Version</dt>
            <dd className="figures">{r.version}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-[var(--muted)]">Rule breaks open</dt>
            <dd className="figures">{r.openBlocks}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-[var(--muted)]">Warnings open</dt>
            <dd className="figures">{r.openWarnings}</dd>
          </div>
          {r.attendanceCompleteness !== null && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--muted)]">Attendance recorded</dt>
              <dd className="figures">{Math.round(r.attendanceCompleteness)}%</dd>
            </div>
          )}
          {r.publishedAt && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--muted)]">Published</dt>
              <dd className="figures">{showDate(r.publishedAt)}</dd>
            </div>
          )}
        </dl>
      )}
      {d.nextMonthStatus === null && (
        <p className="mt-4 border-t border-[var(--border)] pt-3 text-sm text-[var(--muted)]">
          {MONTHS[d.month % 12]} has no roster yet.
        </p>
      )}
    </Panel>
  );
}

function Waiting({ d }: { d: Dash }) {
  const rows = [
    { n: d.waiting.leave, text: "leave requests to decide", href: "/leave" },
    { n: d.waiting.swaps, text: "duty swaps to approve", href: "/swaps" },
    { n: d.waiting.returnsOverdue, text: "returns from leave overdue", href: "/returns" },
    { n: d.waiting.returnsDue, text: "returns from leave due", href: "/returns" },
  ].filter((r) => r.n > 0);
  return (
    <Panel title="Waiting for you">
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Nothing is waiting.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {rows.map((r) => (
            <li key={r.text}>
              <Link href={r.href} className="flex min-h-11 items-center gap-3 py-2 hover:opacity-80">
                <span className="figures w-8 text-xl font-semibold">{r.n}</span>
                <span className="flex-1 text-[15px]">{r.text}</span>
                <span className="text-sm font-medium text-[var(--accent-text)]">Open</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Dashboard() {
  const { data, error, reload } = useResource<Dash>("/api/facility/dashboard");
  const { setup } = useFacility();
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading the dashboard" />;
  const waitingTotal = data.waiting.leave + data.waiting.swaps + data.waiting.returnsDue + data.waiting.returnsOverdue;
  const att = data.today.scheduled > 0 ? `${data.today.recorded} of ${data.today.scheduled} recorded` : "No duties scheduled";
  const setupDone = setup.departments > 0 && setup.cadres > 0 && setup.staff > 0;
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Active staff" value={data.staff.active} note={`${data.staff.onLeaveToday} on approved leave today`} href="/staff" />
        <Kpi label="On duty today" value={data.today.scheduled} note={`${data.today.present} present, ${data.today.absent} absent`} href="/today" />
        <Kpi label="Attendance today" value={data.today.recorded} note={att} href="/attendance" />
        <Kpi label="Waiting for you" value={waitingTotal} note={waitingTotal ? "Leave, swaps and returns" : "Nothing outstanding"} />
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <TodayCover d={data} />
          <Week d={data} />
        </div>
        <div className="space-y-6">
          <RosterCard d={data} />
          <Waiting d={data} />
        </div>
      </div>
      {!setupDone && (
        <div className="mt-6">
          <SetupSteps />
        </div>
      )}
    </>
  );
}

export default function DashboardPage() {
  const ctx = useOptionalFacility();
  if (!ctx) return null; // the shell shows NoFacilityNotice instead
  return <FacilityDashboard />;
}

function FacilityDashboard() {
  const { facility, isAdmin } = useFacility();
  const place = [facility.subDistrict, facility.region].filter(Boolean).join(", ");
  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${facility.name}. ${FACILITY_TYPE[facility.facilityType] ?? "Facility"}${place ? `, ${place}` : ""}`}
      />
      <Dashboard />
      {isAdmin && (
        <div className="mt-6">
          <RecentActivity />
        </div>
      )}
    </>
  );
}
