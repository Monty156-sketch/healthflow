"use client";

// Every ward with its in-charge and its people, for the nursing manager and the administrators.
import Link from "next/link";
import { useResource } from "@/lib/useApi";
import { MONTHS } from "@/lib/format";
import { EmptyState, Loading, LoadError, PageHeader, Panel, StatusBadge } from "@/components/ui";

interface Ward {
  id: string; name: string; kind: string; rosterId: string | null; rosterStatus: string | null;
  inCharge: string[]; people: { id: string; name: string; cadre: string | null; status: string }[];
}

const STATE: Record<string, string> = {
  DRAFT: "Draft", GENERATED: "Generated", UNDER_REVIEW: "With the nursing manager", WITH_ADMINISTRATOR: "With the administrator",
  WITH_SUPERINTENDENT: "With the medical superintendent", APPROVED: "Approved", PUBLISHED: "Published", ARCHIVED: "Archived",
};

export default function WardsPage() {
  const r = useResource<{ month: number; year: number; wards: Ward[]; unassigned: number }>("/api/facility/approvals/wards");
  if (r.error && !r.data) return <LoadError onRetry={r.reload} />;
  if (!r.data) return <Loading label="Loading wards" />;
  const { wards, month, year, unassigned } = r.data;
  return (
    <>
      <PageHeader title="Wards and people" description={`Every ward, its in-charge and its staff. Roster state is for ${MONTHS[month - 1]} ${year}.`} />
      {wards.length === 0 ? (
        <EmptyState title="No wards yet" />
      ) : (
        <div className="space-y-6">
          {wards.map((w) => (
            <Panel key={w.id} title={w.name}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-[var(--muted)]">In-charge: {w.inCharge.join(", ") || "none named"}. {w.people.length} {w.people.length === 1 ? "person" : "people"}.</p>
                {w.rosterId ? (
                  <Link href={`/roster/${w.rosterId}`} className="text-sm underline">{STATE[w.rosterStatus ?? ""] ?? w.rosterStatus}</Link>
                ) : (
                  <StatusBadge tone="neutral">No roster yet</StatusBadge>
                )}
              </div>
              {w.people.length > 0 && (
                <ul className="mt-3 grid gap-x-6 sm:grid-cols-2">
                  {w.people.map((p) => (
                    <li key={p.id} className="flex justify-between border-t border-[var(--border)] py-2 text-sm">
                      <Link href={`/staff/${p.id}`} className="underline">{p.name}</Link>
                      <span className="text-[var(--muted)]">{p.cadre ?? ""}{p.status === "ON_LEAVE" ? " (on leave)" : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ))}
          {unassigned > 0 && <p className="text-sm text-[var(--muted)]">{unassigned} {unassigned === 1 ? "person is" : "people are"} not in a ward yet.</p>}
        </div>
      )}
    </>
  );
}
