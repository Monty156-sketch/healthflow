"use client";

import { useState } from "react";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import type { ReturnItem, ReturnsDue } from "@/lib/types";
import { ReturnActions } from "@/components/ReturnActions";
import { DeploymentReturns } from "@/components/DeploymentReturns";
import { Button, EmptyState, Loading, LoadError, PageHeader, Panel, StatusBadge, TableScroll } from "@/components/ui";

function Table({ label, rows, kind, onOpen }: { label: string; rows: ReturnItem[]; kind: "overdue" | "soon" | "open"; onOpen: (id: string) => void }) {
  return (
    <TableScroll label={`${label}, scrolls sideways on small screens`}>
      <table className="w-full min-w-[40rem] border-collapse text-left text-[15px]">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="text-sm text-[var(--muted)]">
            {["Person", "Leave", kind === "open" ? "Away since" : "Expected back", kind === "open" ? "Days away" : "Status", ""].map((h, i) => (
              <th key={i} scope="col" className="border-b border-[var(--border-strong)] px-3 py-2 font-medium">
                {h || <span className="sr-only">Actions</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="border-b border-[var(--border)] px-3 py-2 font-medium">
                {r.staffName}
                {r.cadreName && <span className="block text-sm font-normal text-[var(--muted)]">{r.cadreName}</span>}
              </th>
              <td className="border-b border-[var(--border)] px-3 py-2">
                {r.typeName}
                {r.extensionOfId && <span className="block text-sm text-[var(--muted)]">Extension</span>}
              </td>
              <td className="figures border-b border-[var(--border)] px-3 py-2">{kind === "open" ? showDate(r.startDate) : showDate(r.expectedReturnDate)}</td>
              <td className="border-b border-[var(--border)] px-3 py-2">
                {kind === "open" ? (
                  <span className="figures">{r.daysAway}</span>
                ) : kind === "overdue" ? (
                  <StatusBadge tone="block">{`${r.daysLate} ${r.daysLate === 1 ? "day" : "days"} late`}</StatusBadge>
                ) : (
                  <StatusBadge tone={r.returnStatus === "DUE" ? "warning" : "neutral"}>{r.returnStatus === "DUE" ? "Due" : "Expected"}</StatusBadge>
                )}
                {r.extensionPending && <span className="block text-sm text-[var(--muted)]">More time asked for</span>}
              </td>
              <td className="border-b border-[var(--border)] px-3 py-1 text-right">
                <Button variant="secondary" aria-label={`Open ${r.staffName}, ${r.typeName.toLowerCase()} leave`} onClick={() => onOpen(r.id)}>
                  Open
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

export default function ReturnsPage() {
  const { data, error, reload } = useResource<ReturnsDue>("/api/facility/leave/returns");
  const [selected, setSelected] = useState<string | null>(null);

  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading returns" />;
  const all = [...data.overdue, ...data.soon, ...data.open];
  const chosen = all.find((r) => r.id === selected);
  const none = all.length === 0;

  return (
    <>
      <PageHeader
        title="Returns due"
        description="Confirm each return. Until then the person stays off the roster."
      />
      <DeploymentReturns />
      {chosen && (
        <div className="mb-6">
          <Panel
            title={`${chosen.staffName}: ${chosen.typeName.toLowerCase()} leave`}
            description={chosen.isOpenEnded ? `Away since ${showDate(chosen.startDate)}, no end date.` : `${showDate(chosen.startDate)} to ${showDate(chosen.endDate)}. Expected back ${showDate(chosen.expectedReturnDate)}.`}
            actions={<Button variant="quiet" onClick={() => setSelected(null)}>Close</Button>}
          >
            <ReturnActions request={chosen} onDone={() => { setSelected(null); reload(); }} />
          </Panel>
        </div>
      )}
      {none ? (
        <EmptyState title="Nobody is waiting to be confirmed back">Nobody due back in the next two weeks.</EmptyState>
      ) : (
        <div className="space-y-8">
          {data.overdue.length > 0 && (
            <section aria-labelledby="overdue-h">
              <h2 id="overdue-h" className="mb-1 text-lg font-semibold">
                Overdue, not confirmed back
              </h2>
              <p className="mb-3 text-[15px] text-[var(--muted)]">Confirm their return or extend the leave.</p>
              <Table label="Overdue returns" rows={data.overdue} kind="overdue" onOpen={setSelected} />
            </section>
          )}
          {data.soon.length > 0 && (
            <section aria-labelledby="soon-h">
              <h2 id="soon-h" className="mb-1 text-lg font-semibold">
                Expected back in the next two weeks
              </h2>
              <Table label="Expected returns" rows={data.soon} kind="soon" onOpen={setSelected} />
            </section>
          )}
          {data.open.length > 0 && (
            <section aria-labelledby="open-h">
              <h2 id="open-h" className="mb-1 text-lg font-semibold">
                Away with no end date
              </h2>
              <Table label="Open-ended absences" rows={data.open} kind="open" onOpen={setSelected} />
            </section>
          )}
        </div>
      )}
    </>
  );
}
