"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDateTime } from "@/lib/format";
import { Button, EmptyState, Loading, LoadError, Notice, PageHeader, Panel, Select, StatusBadge, TD, TH, TableScroll } from "@/components/ui";

interface Report {
  id: string;
  createdAt: string;
  facility: string | null;
  reportedBy: string | null;
  screen: string | null;
  description: string;
  technicalContext: unknown;
  status: "NEW" | "INVESTIGATING" | "RESOLVED";
}

interface Health {
  api: { ok: boolean; upSinceSeconds: number };
  database: { ok: boolean; ms: number | null };
  errors: { last24h: number; open: number };
  jobs: { name: string; label: string; everyMinutes: number; lastRunAt: string | null; lastOk: boolean | null; lastDetail: string | null; failedLast7Days: number; late: boolean }[];
  reports: Report[];
}

const STATUS_LABEL = { NEW: "New", INVESTIGATING: "Investigating", RESOLVED: "Resolved" } as const;

function upFor(seconds: number) {
  if (seconds < 90) return "under a minute";
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} hours`;
  return `${Math.round(seconds / 86400)} days`;
}

function Check({ label, ok, detail }: { label: string; ok: boolean | null; detail: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-3">
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-sm text-[var(--muted)]">{detail}</p>
      </div>
      <StatusBadge tone={ok === null ? "neutral" : ok ? "success" : "block"}>{ok === null ? "Not built yet" : ok ? "Working" : "Down"}</StatusBadge>
    </div>
  );
}

export default function SystemHealthPage() {
  const { user } = useAuth();
  const { data, error, reload } = useResource<Health>(user?.role === "PLATFORM_ADMIN" ? "/api/platform/health" : null);
  const [problem, setProblem] = useState<string | null>(null);

  if (user?.role !== "PLATFORM_ADMIN") return <Notice tone="warning">System health is for PS Tech platform admins.</Notice>;
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Checking the system" />;

  async function setStatus(id: string, status: string) {
    setProblem(null);
    try {
      await api.patch(`/api/platform/errors/${id}`, { status });
      reload();
    } catch {
      setProblem("The status could not be changed. Try again.");
    }
  }

  return (
    <>
      <PageHeader
        title="System health"
        description="Whether HealthFlow is running, and the problems people and browsers have reported."
        actions={<Button variant="secondary" onClick={reload}>Check again</Button>}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Services">
          <div className="divide-y divide-[var(--border)]">
            <Check label="API" ok={data.api.ok} detail={`Running for ${upFor(data.api.upSinceSeconds)} since its last restart.`} />
            <Check
              label="Database"
              ok={data.database.ok}
              detail={data.database.ok ? `Answered in ${data.database.ms} ms.` : "The database did not answer."}
            />
            {data.jobs.map((j) => (
              <Check key={j.name} label={j.label} ok={j.lastRunAt === null ? null : !j.late && j.lastOk !== false} detail={j.lastRunAt === null ? "Has not run yet." : `Every ${j.everyMinutes >= 60 ? `${Math.round(j.everyMinutes / 60)} hours` : `${j.everyMinutes} minutes`}. Last ran ${new Date(j.lastRunAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${j.lastOk === false ? `, and failed: ${j.lastDetail}` : j.late ? ", and is late" : ""}.${j.failedLast7Days ? ` ${j.failedLast7Days} failed in the last 7 days.` : ""}`} />
            ))}
            <Check label="Notifications" ok={null} detail="Notices appear in the application. Email delivery is not tracked here." />
          </div>
        </Panel>
        <Panel title="Errors">
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-[var(--muted)]">Last 24 hours</dt>
              <dd className="figures text-2xl font-semibold">{data.errors.last24h}</dd>
            </div>
            <div>
              <dt className="text-sm text-[var(--muted)]">Not yet resolved</dt>
              <dd className="figures text-2xl font-semibold">{data.errors.open}</dd>
            </div>
          </dl>
        </Panel>
      </div>
      <h2 className="mt-8 mb-3 text-lg font-semibold">Reported problems</h2>
      {problem && (
        <div className="mb-3">
          <Notice tone="block">{problem}</Notice>
        </div>
      )}
      {data.reports.length === 0 ? (
        <EmptyState title="Nothing reported">Server errors, browser errors and reports from staff appear here.</EmptyState>
      ) : (
        <TableScroll label="Reported problems">
          <table className="w-full text-[15px]">
            <thead>
              <tr>
                <th className={TH}>When</th>
                <th className={TH}>Facility</th>
                <th className={TH}>Screen</th>
                <th className={TH}>What happened</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.reports.map((r) => (
                <tr key={r.id}>
                  <td className={`${TD} figures whitespace-nowrap`}>{showDateTime(r.createdAt)}</td>
                  <td className={TD}>{r.facility ?? "None"}</td>
                  <td className={`${TD} figures`}>{r.screen ?? ""}</td>
                  <td className={`${TD} min-w-64`}>
                    <p>{r.description}</p>
                    <p className="text-sm text-[var(--muted)]">From {r.reportedBy}</p>
                    {r.technicalContext != null && (
                      <details className="mt-1">
                        <summary className="min-h-11 cursor-pointer py-2 text-sm text-[var(--accent-text)]">Technical details</summary>
                        <pre className="figures max-h-48 overflow-auto rounded-[var(--radius)] bg-[var(--background)] p-2 text-[12px] whitespace-pre-wrap">
                          {JSON.stringify(r.technicalContext, null, 2)}
                        </pre>
                      </details>
                    )}
                  </td>
                  <td className={TD}>
                    <label className="sr-only" htmlFor={`st-${r.id}`}>
                      Status of report from {showDateTime(r.createdAt)}
                    </label>
                    <Select id={`st-${r.id}`} value={r.status} onChange={(e) => void setStatus(r.id, e.target.value)}>
                      {Object.entries(STATUS_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </>
  );
}
