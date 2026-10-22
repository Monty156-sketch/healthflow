"use client";

import Link from "next/link";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import { EmptyState, Loading, LoadError, PageHeader, StatusBadge, TD, TH, TableScroll } from "@/components/ui";

interface Row {
  id: string; name: string; type: string; district: string | null; registeredAt: string; trialEndsAt: string | null; daysLeft: number | null;
  staff: number; accounts: number; lastSignInAt: string | null; lastRosterPublishedAt: string | null;
}

const words = (t: string) => t.toLowerCase().replace(/_/g, " ");

function Left({ days }: { days: number | null }) {
  if (days === null) return <StatusBadge tone="neutral">No end date</StatusBadge>;
  if (days < 0) return <StatusBadge tone="block">Ended {-days} {days === -1 ? "day" : "days"} ago</StatusBadge>;
  if (days <= 7) return <StatusBadge tone="warning">{days} {days === 1 ? "day" : "days"} left</StatusBadge>;
  return <StatusBadge tone="neutral">{days} days left</StatusBadge>;
}

export default function TrialsPage() {
  const { data, error, reload } = useResource<{ trials: Row[] }>("/api/platform/trials");
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading trials" />;
  return (
    <>
      <PageHeader title="Trials" description="Facilities that registered themselves and are still on a trial, the ones ending soonest first. Telephone those that have set up but not yet published a roster." />
      {data.trials.length === 0 ? (
        <EmptyState title="No facility is on a trial">New registrations appear here.</EmptyState>
      ) : (
        <TableScroll label="Facilities on trial">
          <table className="w-full min-w-[56rem] border-collapse text-[15px]">
            <thead>
              <tr>
                <th scope="col" className={TH}>Facility</th>
                <th scope="col" className={TH}>Registered</th>
                <th scope="col" className={TH}>Trial</th>
                <th scope="col" className={TH}>Staff</th>
                <th scope="col" className={TH}>Accounts</th>
                <th scope="col" className={TH}>Last sign in</th>
                <th scope="col" className={TH}>Roster published</th>
              </tr>
            </thead>
            <tbody>
              {data.trials.map((t) => (
                <tr key={t.id}>
                  <th scope="row" className={`${TD} text-left font-medium`}>
                    <Link href={`/platform/facilities/${t.id}`} className="text-[var(--accent-text)] underline-offset-2 hover:underline">{t.name}</Link>
                    <span className="block text-sm font-normal text-[var(--muted)]">{[words(t.type), t.district].filter(Boolean).join(" · ")}</span>
                  </th>
                  <td className={TD}>{showDate(t.registeredAt)}</td>
                  <td className={TD}><Left days={t.daysLeft} /></td>
                  <td className={`${TD} figures`}>{t.staff}</td>
                  <td className={`${TD} figures`}>{t.accounts}</td>
                  <td className={TD}>{t.lastSignInAt ? showDate(t.lastSignInAt) : <span className="text-[var(--muted)]">Never</span>}</td>
                  <td className={TD}>{t.lastRosterPublishedAt ? showDate(t.lastRosterPublishedAt) : <span className="text-[var(--muted)]">Not yet</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </>
  );
}
