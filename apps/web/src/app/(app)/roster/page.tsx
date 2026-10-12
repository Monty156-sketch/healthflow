"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFacility } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { MONTHS } from "@/lib/format";
import type { RosterSummary } from "@/lib/types";
import { STATUS_WORD, statusTone } from "@/lib/rosterStatus";
import { Button, EmptyState, Loading, LoadError, Notice, PageHeader, Panel, Select, StatusBadge, TableScroll } from "@/components/ui";

function StartRoster({ onCreated }: { onCreated: (id: string) => void }) {
  const now = new Date();
  const next = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));
  const [year, setYear] = useState(next.getUTCFullYear());
  const [month, setMonth] = useState(next.getUTCMonth() + 1);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const years = Array.from({ length: 4 }, (_, i) => now.getFullYear() - 1 + i);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const res = await api.post<{ roster: { id: string } }>("/api/facility/rosters", { year, month });
      onCreated(res.roster.id);
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { message?: string; id?: string }) : undefined;
      if (body?.id) return onCreated(body.id);
      setProblem(body?.message ?? "The roster could not be started. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor="new-month" className="mb-1 block text-sm font-medium">
          Month
        </label>
        <Select id="new-month" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor="new-year" className="mb-1 block text-sm font-medium">
          Year
        </label>
        <Select id="new-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y}>{y}</option>
          ))}
        </Select>
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? "Starting…" : "Start roster"}
      </Button>
      {problem && (
        <div className="basis-full">
          <Notice tone="block">{problem}</Notice>
        </div>
      )}
    </form>
  );
}

export default function RosterListPage() {
  const facility = useFacility();
  const canRoster = ["FACILITY_ADMIN", "ROSTER_MANAGER"].includes(facility.me.role);
  const router = useRouter();
  const { data, error, reload } = useResource<{ rosters: RosterSummary[] }>("/api/facility/rosters");

  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading rosters" />;

  const go = (id: string) => router.push(`/roster/${id}`);

  return (
    <>
      <PageHeader title="Roster" description="One roster for each month. Start a month, generate it, and check it against the rules." />
      {canRoster && (
        <div className="mb-6">
          <Panel title="Start a month">
            <StartRoster onCreated={go} />
          </Panel>
        </div>
      )}
      {data.rosters.length === 0 ? (
        <EmptyState title="No rosters yet">{canRoster ? "Start the first month above. Set up your shifts and duty cycles first if you have not." : "Nothing has been planned yet."}</EmptyState>
      ) : (
        <TableScroll label="Rosters">
          <table className="w-full min-w-[40rem] text-left text-[15px]">
            <caption className="sr-only">Rosters, newest first</caption>
            <thead className="border-b border-[var(--border)] text-sm text-[var(--muted)]">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Month</th>
                <th scope="col" className="px-4 py-2 font-medium">Status</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Duties</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Unfilled</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Blocking</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Warnings</th>
              </tr>
            </thead>
            <tbody>
              {data.rosters.map((r) => (
                <tr key={r.id} className="border-b border-[var(--border)] last:border-b-0">
                  <th scope="row" className="px-4 py-3 font-medium">
                    <Link href={`/roster/${r.id}`} className="text-[var(--accent)] underline-offset-2 hover:underline">
                      {r.label}
                    </Link>
                  </th>
                  <td className="px-4 py-3">
                    <StatusBadge tone={statusTone(r.status)}>{STATUS_WORD[r.status]}</StatusBadge>
                  </td>
                  <td className="figures px-4 py-3 text-right">{r.duties}</td>
                  <td className="figures px-4 py-3 text-right">{r.unfilled}</td>
                  <td className="figures px-4 py-3 text-right">{r.blocks}</td>
                  <td className="figures px-4 py-3 text-right">{r.warnings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </>
  );
}
