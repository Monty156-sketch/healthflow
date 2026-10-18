"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { WardSelect } from "@/components/WardSelect";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import type { ComplianceReport } from "@/lib/types";
import { Button, EmptyState, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, StatusBadge, TableScroll } from "@/components/ui";

const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function CompliancePage() {
  const [month, setMonth] = useState(thisMonth());
  const [ward, setWard] = useState("");
  const q = `month=${month}${ward ? `&ward=${ward}` : ""}`;
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { data, error, reload } = useResource<ComplianceReport>(`/api/facility/reports/compliance?${q}`);

  async function get(kind: "pdf" | "csv") {
    setBusy(kind);
    setProblem(null);
    try {
      await api.download(`/api/facility/reports/compliance.${kind}?${q}`, `compliance-${month}.${kind}`);
    } catch {
      setProblem("The file could not be made. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="Compliance report" description="Per person for the month, against the roster as it stands. Signed by the preparer and the facility head, it is the record of how every duty was scheduled." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="max-w-[12rem]">
          <Field label="Month">{(a) => <Input {...a} type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />}</Field>
        </div>
        <WardSelect value={ward} onChange={setWard} />
        {data?.roster && (
          <>
            <Button variant="secondary" disabled={busy !== null} onClick={() => get("pdf")}>{busy === "pdf" ? "Preparing PDF…" : "Download PDF"}</Button>
            <Button variant="secondary" disabled={busy !== null} onClick={() => get("csv")}>{busy === "csv" ? "Preparing CSV…" : "Download CSV"}</Button>
          </>
        )}
      </div>
      {problem && <div className="mb-4"><Notice tone="block">{problem}</Notice></div>}
      {error && !data ? (
        <LoadError onRetry={reload} />
      ) : !data ? (
        <Loading label="Working out the figures" />
      ) : !data.roster ? (
        <EmptyState title="No roster for this month">Build a roster for the month first. The report is worked out from it.</EmptyState>
      ) : (
        <div className="space-y-6">
          <p className="text-[15px] text-[var(--muted)]">
            {data.title}{!data.ward && data.wards?.length ? `, ${data.wards.length} ward rosters` : ""}, roster {data.roster.status.toLowerCase().replace("_", " ")}, version {data.roster.version}.
            {["PUBLISHED", "APPROVED"].includes(data.roster.status) ? "" : " This roster is not approved yet, so the figures may change."}
          </p>
          <dl className="grid gap-3 sm:grid-cols-4">
            {[
              [`Staff above ${data.normalWeek} hours in a week`, data.summary!.staffAboveNormalWeek],
              ["Rest breaches", data.summary!.restBreaches],
              ["Overrides granted", data.summary!.overridesGranted],
              ["Unfilled shifts", data.summary!.unfilledShifts],
            ].map(([label, n]) => (
              <div key={label} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3">
                <dd className="figures text-2xl font-semibold">{n}</dd>
                <dt className="text-sm text-[var(--muted)]">{label}</dt>
              </div>
            ))}
          </dl>
          <TableScroll label="Compliance figures per person, scrolls sideways on small screens">
            <table className="w-full min-w-[46rem] border-collapse text-left text-[15px]">
              <caption className="sr-only">Compliance figures per person</caption>
              <thead>
                <tr className="text-sm text-[var(--muted)]">
                  {["Person", "Hours", "Duty days", "Nights", "Highest week", `Over ${data.normalWeek} h`, "Longest rest", "Rest breaches"].map((h, i) => (
                    <th key={h} scope="col" className={`border-b border-[var(--border-strong)] px-3 py-2 font-medium ${i > 0 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows!.map((r) => (
                  <tr key={r.staffId}>
                    <th scope="row" className="border-b border-[var(--border)] px-3 py-2 font-medium">{r.name}{(r.cadre || r.ward) && <span className="block text-sm font-normal text-[var(--muted)]">{[r.cadre, r.ward].filter(Boolean).join(", ")}</span>}</th>
                    <td className="figures border-b border-[var(--border)] px-3 py-2 text-right">{r.hours}</td>
                    <td className="figures border-b border-[var(--border)] px-3 py-2 text-right">{r.dutyDays}</td>
                    <td className="figures border-b border-[var(--border)] px-3 py-2 text-right">{r.nights}</td>
                    <td className="figures border-b border-[var(--border)] px-3 py-2 text-right">
                      {r.highestWeekHours}
                      {r.highestWeekHours > data.normalWeek! && <StatusBadge tone="warning">Over</StatusBadge>}
                    </td>
                    <td className="figures border-b border-[var(--border)] px-3 py-2 text-right">{r.hoursAboveNormal || ""}</td>
                    <td className="figures border-b border-[var(--border)] px-3 py-2 text-right">{r.longestRestHours === null ? "n/a" : `${r.longestRestHours} h`}</td>
                    <td className="figures border-b border-[var(--border)] px-3 py-2 text-right">{r.restBreaches || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>

          <Panel title="Overrides" description="Every rule that was knowingly overridden, with the reason and who approved it.">
            {data.overrides!.length === 0 ? (
              <p className="text-[15px] text-[var(--muted)]">No rule was overridden in this roster.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {data.overrides!.map((o, i) => (
                  <li key={i} className="py-3 text-[15px]">
                    <p className="font-medium">{o.rule}{o.staff ? `, ${o.staff}` : ""}</p>
                    <p className="text-[var(--muted)]">{o.message}</p>
                    <p>Reason: {o.reason}. Approved by {o.approver}{o.date ? ` on ${showDate(o.date)}` : ""}.</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <p className="max-w-3xl text-sm text-[var(--muted)]">
            Limits come from published summaries of the Labour Act 2003 (Act 651) and should be confirmed with a qualified labour law practitioner. This report is not legal advice.
          </p>
        </div>
      )}
    </>
  );
}
