"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { DistrictReading, type Reading } from "@/components/DistrictReading";
import { Button, EmptyState, Field, Loading, LoadError, Notice, PageHeader, Panel, Select, StatusBadge, TD, TH, TableScroll } from "@/components/ui";

type Band = "GOOD" | "WATCH" | "CONCERN" | null;
type Key = "coverage" | "publishedBeforeStart" | "attendance" | "staffing" | "blocking" | "warnings";
interface Metrics { coverage: number | null; publishedBeforeStart: number | null; attendance: number | null; staffing: number | null; blocking: number | null; warnings: number | null }
interface Row { facilityId: string; name: string; district: string | null; month: Metrics; previous: Metrics; change: Record<Key, number | null>; bands: Record<Key, Band>; concerns: number }
interface Data {
  reading: Reading; month: string; label: string; previousLabel: string;
  summary: { facilities: number; inConcern: number; coverage: number | null; previousCoverage: number | null; attendance: number | null; previousAttendance: number | null; publishedBeforeStart: number | null; staffing: number | null; previousStaffing: number | null };
  thresholds: Record<string, string>;
  facilities: Row[];
  districts?: { district: string; facilities: number; coverage: number | null; previousCoverage: number | null; attendance: number | null; previousAttendance: number | null; publishedBeforeStart: number | null; staffing: number | null; blocking: number | null; inConcern: number }[];
}

const TONE = { GOOD: "success", WATCH: "warning", CONCERN: "block" } as const;
const WORD = { GOOD: "On track", WATCH: "Watch", CONCERN: "Concern" } as const;

const months = () => Array.from({ length: 13 }, (_, i) => {
  const d = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - i, 1));
  return { value: d.toISOString().slice(0, 7), label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) };
});

/** A rise or fall since the month before, in words that say whether it helps. */
function Change({ v, unit, lowerIsBetter }: { v: number | null; unit: string; lowerIsBetter?: boolean }) {
  if (v === null) return null;
  if (v === 0) return <span className="block text-xs text-[var(--muted)]">No change</span>;
  const better = lowerIsBetter ? v < 0 : v > 0;
  return <span className={`block text-xs ${better ? "text-[var(--status-success)]" : "text-[var(--status-block)]"}`}>{v > 0 ? "Up" : "Down"} {Math.abs(v)}{unit} on last month</span>;
}

function Cell({ value, unit, band, change, lowerIsBetter }: { value: number | null; unit: string; band: Band; change: number | null; lowerIsBetter?: boolean }) {
  if (value === null) return <span className="text-sm text-[var(--muted)]">Not shared or no data</span>;
  return (
    <>
      <span className="figures font-medium">{value}{unit}</span>{" "}
      {band && <StatusBadge tone={TONE[band]}>{WORD[band]}</StatusBadge>}
      <Change v={change} unit={unit === "%" ? " points" : ""} lowerIsBetter={lowerIsBetter} />
    </>
  );
}

const SORTS = {
  concerns: { label: "Most concerns first", by: (a: Row, b: Row) => b.concerns - a.concerns || a.name.localeCompare(b.name) },
  coverage: { label: "Days fully staffed, lowest first", by: (a: Row, b: Row) => (a.month.coverage ?? 101) - (b.month.coverage ?? 101) },
  attendance: { label: "Attendance recorded, lowest first", by: (a: Row, b: Row) => (a.month.attendance ?? 101) - (b.month.attendance ?? 101) },
  name: { label: "Name", by: (a: Row, b: Row) => a.name.localeCompare(b.name) },
} as const;

export default function Scorecard() {
  const options = useMemo(() => months(), []);
  const [month, setMonth] = useState(options[1].value);
  const [sort, setSort] = useState<keyof typeof SORTS>("concerns");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { data, error, reload } = useResource<Data>(`/api/district/scorecard?month=${month}`);

  async function download() {
    setBusy(true); setProblem(null);
    try { await api.download(`/api/district/scorecard.csv?month=${month}`, `scorecard-${month}.csv`); }
    catch { setProblem("The file could not be made. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  const rows = data ? [...data.facilities].sort(SORTS[sort].by) : [];
  return (
    <>
      <PageHeader title="Performance scorecard" description="Plain measures for each facility, set against the month before. Each figure comes only from what the facility has chosen to share, and a figure not shared is left blank. There is no single score, because one number hides which part is failing." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="max-w-[14rem]">
          <Field label="Month">{(a) => <Select {...a} value={month} onChange={(e) => setMonth(e.target.value)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>}</Field>
        </div>
        <div className="max-w-[20rem]">
          <Field label="Order by">{(a) => <Select {...a} value={sort} onChange={(e) => setSort(e.target.value as keyof typeof SORTS)}>{Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>}</Field>
        </div>
        <Button variant="secondary" disabled={busy || !data || data.facilities.length === 0} onClick={download}>{busy ? "Preparing…" : "Download CSV"}</Button>
      </div>
      {problem && <div className="mb-4"><Notice tone="block">{problem}</Notice></div>}
      {error && !data ? <LoadError onRetry={reload} /> : !data ? <Loading label="Working out the scorecard" /> : (
        <>
          <DistrictReading reading={data.reading} />
          {data.facilities.length === 0 ? (
            <EmptyState title="Nothing to show">No facility has granted coverage, attendance or compliance yet.</EmptyState>
          ) : (
            <div className="space-y-6">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {([
                  ["Facilities with a concern", `${data.summary.inConcern} of ${data.summary.facilities}`],
                  ["Days fully staffed (average)", data.summary.coverage === null ? "No data" : `${data.summary.coverage}%`],
                  ["Attendance recorded (average)", data.summary.attendance === null ? "No data" : `${data.summary.attendance}%`],
                  ["Rosters published before the month", data.summary.publishedBeforeStart === null ? "No data" : `${data.summary.publishedBeforeStart}%`],
                  ["Approved posts filled (average)", data.summary.staffing === null ? "No data" : `${data.summary.staffing}%`],
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3"><dd className="figures text-2xl font-semibold">{v}</dd><dt className="text-sm text-[var(--muted)]">{k}</dt></div>
                ))}
              </dl>

              {data.districts && data.districts.length > 0 && (
                <Panel title="Districts compared" description={`${data.label}, against ${data.previousLabel}. Averages of the facilities that shared each figure.`}>
                  <TableScroll label="Districts compared">
                    <table className="w-full min-w-[44rem] border-collapse text-[15px]">
                      <thead><tr>{["District", "Facilities", "Days fully staffed", "Attendance recorded", "Published before the month", "Posts filled", "Blocking findings", "With a concern"].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
                      <tbody>
                        {data.districts.map((d) => (
                          <tr key={d.district}>
                            <th scope="row" className={`${TD} text-left font-medium`}>{d.district}</th>
                            <td className={`${TD} figures`}>{d.facilities}</td>
                            <td className={`${TD} figures`}>{d.coverage === null ? "No data" : `${d.coverage}%`}{d.coverage !== null && d.previousCoverage !== null && <Change v={d.coverage - d.previousCoverage} unit=" points" />}</td>
                            <td className={`${TD} figures`}>{d.attendance === null ? "No data" : `${d.attendance}%`}{d.attendance !== null && d.previousAttendance !== null && <Change v={d.attendance - d.previousAttendance} unit=" points" />}</td>
                            <td className={`${TD} figures`}>{d.publishedBeforeStart === null ? "No data" : `${d.publishedBeforeStart}%`}</td>
                            <td className={`${TD} figures`}>{d.staffing === null ? "No data" : `${d.staffing}%`}</td>
                            <td className={`${TD} figures`}>{d.blocking === null ? "No data" : d.blocking}</td>
                            <td className={`${TD} figures`}>{d.inConcern}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableScroll>
                </Panel>
              )}

              <Panel title="Facilities" description={`${data.label}, against ${data.previousLabel}.`}>
                <TableScroll label="Facility scorecard">
                  <table className="w-full min-w-[56rem] border-collapse text-[15px]">
                    <thead><tr>{["Facility", "Days fully staffed", "Published before the month", "Attendance recorded", "Posts filled", "Blocking findings open", "Warnings open"].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.facilityId}>
                          <th scope="row" className={`${TD} text-left font-medium`}>{r.name}{r.district && <span className="block text-xs font-normal text-[var(--muted)]">{r.district}</span>}</th>
                          <td className={TD}><Cell value={r.month.coverage} unit="%" band={r.bands.coverage} change={r.change.coverage} /></td>
                          <td className={TD}><Cell value={r.month.publishedBeforeStart} unit="%" band={r.bands.publishedBeforeStart} change={r.change.publishedBeforeStart} /></td>
                          <td className={TD}><Cell value={r.month.attendance} unit="%" band={r.bands.attendance} change={r.change.attendance} /></td>
                          <td className={TD}><Cell value={r.month.staffing} unit="%" band={r.bands.staffing} change={r.change.staffing} /></td>
                          <td className={TD}><Cell value={r.month.blocking} unit="" band={r.bands.blocking} change={r.change.blocking} lowerIsBetter /></td>
                          <td className={TD}><Cell value={r.month.warnings} unit="" band={r.bands.warnings} change={r.change.warnings} lowerIsBetter /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
                <p className="mt-3 text-sm text-[var(--muted)]">Measured against: days fully staffed, {data.thresholds.coverage}. Attendance recorded, {data.thresholds.attendance}. Published before the month, {data.thresholds.publishedBeforeStart}. Posts filled, {data.thresholds.staffing}. Blocking findings, {data.thresholds.blocking}. Posts filled is counted on the day the month is frozen, so it has no earlier history.</p>
              </Panel>
            </div>
          )}
        </>
      )}
    </>
  );
}
