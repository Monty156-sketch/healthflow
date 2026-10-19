"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { Button, Loading, LoadError, Notice, PageHeader, Panel } from "@/components/ui";

interface Pack {
  generatedOn: string;
  district: string;
  period: string;
  used: { scope: string; facilities: number }[];
  sections: Record<string, Record<string, unknown>[]>;
}

const TITLE: Record<string, string> = { establishment: "Establishment and vacancies", coverage: "Coverage, next seven days", attendance: "Attendance completeness", compliance: "Compliance summary" };

export default function DistrictReports() {
  const { data, error, reload } = useResource<Pack>("/api/district/report-pack");
  const [err, setErr] = useState<string | null>(null);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Preparing the report pack" />;
  return (
    <>
      <PageHeader
        title="Report pack"
        description={`${data.district}, ${data.period}. Built only from what facilities have granted.`}
        actions={
          <Button variant="secondary" onClick={() => api.download("/api/district/report-pack.csv", "district-report-pack.csv").catch(() => setErr("The file could not be downloaded. Try again."))}>
            Download as CSV
          </Button>
        }
      />
      {err && <Notice tone="block">{err}</Notice>}
      <p className="mb-4 text-sm text-[var(--muted)]">{data.used.map((u) => `${u.scope}: ${u.facilities} ${u.facilities === 1 ? "facility" : "facilities"}`).join(". ")}.</p>
      <div className="space-y-6">
        {Object.entries(data.sections).map(([key, rows]) => (
          <Panel key={key} title={TITLE[key] ?? key}>
            {rows.length === 0 ? (
              <p className="text-[15px] text-[var(--muted)]">No facility has granted this information.</p>
            ) : (
              <div className="overflow-x-auto" role="region" aria-label="Report table" tabIndex={0}>
                <table className="w-full min-w-[28rem] border-collapse text-[15px]">
                  <thead>
                    <tr>
                      {Object.keys(rows[0]).map((h) => (
                        <th key={h} scope="col" className="border-b border-[var(--border)] px-3 py-2 text-left text-sm font-medium text-[var(--muted)]">{h.replace(/([A-Z])/g, " $1").toLowerCase()}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        {Object.values(r).map((v, j) => (
                          <td key={j} className="figures border-b border-[var(--border)] px-3 py-2">{v === null ? "Not recorded" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ))}
      </div>
    </>
  );
}
