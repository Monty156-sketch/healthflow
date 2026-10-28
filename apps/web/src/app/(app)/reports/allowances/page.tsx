"use client";

import { useState } from "react";
import { WardSelect } from "@/components/WardSelect";
import { api } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { Button, EmptyState, Field, Input, Loading, LoadError, Notice, PageHeader, Panel } from "@/components/ui";

interface Row { staffId: string; staffNo: string; name: string; cadre: string | null; ward: string | null; duties: number; byShift: Record<string, number>; nights: number; weekends: number; holidays: number; hours: number; present: number; late: number; absent: number; excused: number; onLeave: number; official: number; unrecorded: number }
interface Totals extends Omit<Row, "staffId" | "staffNo" | "name" | "cadre" | "ward" | "byShift"> { byShift: Record<string, number> }
interface Sheet { rosterStatus: string; final: boolean; ward: string | null; hasWards: boolean; shifts: { id: string; name: string }[]; rows: Row[]; totals: Totals }

const lastMonth = () => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

export default function AllowancesPage() {
  const [month, setMonth] = useState(lastMonth());
  const [ward, setWard] = useState("");
  const q = `month=${month}${ward ? `&ward=${ward}` : ""}`;
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { data, error, reload } = useResource<{ sheet: Sheet | null }>(`/api/facility/reports/allowances?${q}`);

  async function download(kind: "xlsx" | "csv") {
    setBusy(kind);
    setProblem(null);
    try {
      await api.download(`/api/facility/reports/allowances.${kind}?${q}`, `duty-days-${month}.${kind}`);
    } catch {
      setProblem("The file could not be made. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const sheet = data?.sheet;
  return (
    <>
      <PageHeader title="Duty days and allowances" description="What each person worked in the month, from the roster and attendance. Counts and hours only: your accounts office sets the rates. Prepare it after the month closes." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="max-w-[12rem]">
          <Field label="Month">{(a) => <Input {...a} type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />}</Field>
        </div>
        <WardSelect value={ward} onChange={setWard} />
        <Button disabled={!sheet || busy !== null} onClick={() => download("xlsx")}>{busy === "xlsx" ? "Preparing…" : "Download workbook"}</Button>
        <Button variant="secondary" disabled={!sheet || busy !== null} onClick={() => download("csv")}>{busy === "csv" ? "Preparing…" : "Download CSV"}</Button>
      </div>
      {problem && <div className="mb-4"><Notice tone="block">{problem}</Notice></div>}
      {error && !data ? (
        <LoadError onRetry={reload} />
      ) : !data ? (
        <Loading label="Working out the figures" />
      ) : !sheet ? (
        <EmptyState title="No roster for this month">Choose a month that has a roster.</EmptyState>
      ) : (
        <div className="space-y-4">
          {!sheet.final && <Notice tone="warning"><strong className="block">Draft figures.</strong>Some rosters for this month are not yet approved or published. Do not pay from this sheet until they are.</Notice>}
          {sheet.totals.unrecorded > 0 && <Notice tone="neutral">{sheet.totals.unrecorded} rostered {sheet.totals.unrecorded === 1 ? "duty has" : "duties have"} no attendance record. Have attendance completed before the sheet is signed.</Notice>}
          <Panel title={`${sheet.rows.length} ${sheet.rows.length === 1 ? "person" : "people"}`}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[15px]">
                <thead>
                  <tr className="text-sm text-[var(--muted)]">
                    {["Name", "Duties", ...sheet.shifts.map((s) => s.name), "Nights", "Weekends", "Holidays", "Hours", "Present", "Late", "Absent", "Not recorded"].map((h, i) => (
                      <th key={h} className={`border-b border-[var(--border-strong)] px-3 py-2 font-medium ${i === 0 ? "" : "text-right"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map((r) => (
                    <tr key={r.staffId}>
                      <td className="border-b border-[var(--border)] px-3 py-2">{r.name}<span className="block text-xs text-[var(--muted)]">{r.staffNo}{r.cadre ? `, ${r.cadre}` : ""}{r.ward ? `, ${r.ward}` : ""}</span></td>
                      {[r.duties, ...sheet.shifts.map((s) => r.byShift[s.id] ?? 0), r.nights, r.weekends, r.holidays, r.hours, r.present, r.late, r.absent, r.unrecorded].map((v, i) => (
                        <td key={i} className="figures border-b border-[var(--border)] px-3 py-2 text-right">{v}</td>
                      ))}
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="px-3 py-2">Total</td>
                    {[sheet.totals.duties, ...sheet.shifts.map((s) => sheet.totals.byShift[s.id] ?? 0), sheet.totals.nights, sheet.totals.weekends, sheet.totals.holidays, sheet.totals.hours, sheet.totals.present, sheet.totals.late, sheet.totals.absent, sheet.totals.unrecorded].map((v, i) => (
                      <td key={i} className="figures px-3 py-2 text-right">{v}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
