"use client";

import Link from "next/link";
import { useState } from "react";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import { HEALTH_TONE, HEALTH_WORD } from "@/lib/console";
import { ButtonLink, EmptyState, Input, Loading, LoadError, PageHeader, Select, StatusBadge, TD, TH, TableScroll } from "@/components/ui";

interface Row {
  id: string;
  name: string;
  district: string | null;
  status: string;
  plan: string | null;
  subscriptionStatus: string | null;
  staff: number;
  accounts: number;
  attendanceCompleteness: number | null;
  lastRosterPublishedAt: string | null;
  lastSignInAt: string | null;
  health: string;
  healthWhy: string[];
}

const ORDER: Record<string, number> = { AT_RISK: 0, WATCH: 1, HEALTHY: 2 };

export default function FacilitiesPage() {
  const [q, setQ] = useState("");
  const [health, setHealth] = useState(() => (typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("health") ?? "")));
  const { data, error, reload } = useResource<{ facilities: Row[] }>("/api/platform/facilities");
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading facilities" />;
  const rows = data.facilities
    .filter((f) => (!health || f.health === health) && (!q || `${f.name} ${f.district ?? ""}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => ORDER[a.health] - ORDER[b.health] || a.name.localeCompare(b.name));
  return (
    <>
      <PageHeader title="Facilities" description="At risk first. An at-risk facility gets a telephone call, not an email." actions={<ButtonLink href="/platform/facilities/new">New facility</ButtonLink>} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input type="search" placeholder="Search by name or district" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search facilities" className="max-w-xs" />
        <Select value={health} onChange={(e) => setHealth(e.target.value)} aria-label="Health" className="w-40">
          <option value="">Every state</option>
          {Object.entries(HEALTH_WORD).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No facilities match" />
      ) : (
        <TableScroll label="Facilities">
          <table className="w-full min-w-[64rem] border-collapse text-[15px]">
            <thead>
              <tr>
                {["Facility", "District", "Plan", "Subscription", "Staff", "With accounts", "Attendance records", "Last roster published", "Last sign-in", "Health"].map((h) => (
                  <th key={h} scope="col" className={TH}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id}>
                  <th scope="row" className={`${TD} text-left font-medium`}>
                    <Link href={`/platform/facilities/${f.id}`} className="text-[var(--accent-text)] underline-offset-2 hover:underline">{f.name}</Link>
                  </th>
                  <td className={TD}>{f.district ?? ""}</td>
                  <td className={TD}>{f.plan ?? "None"}</td>
                  <td className={TD}>{f.subscriptionStatus ? f.subscriptionStatus.replace(/_/g, " ").toLowerCase() : f.status.toLowerCase()}</td>
                  <td className={`${TD} figures`}>{f.staff}</td>
                  <td className={`${TD} figures`}>{f.staff > 0 ? `${Math.min(100, Math.round((f.accounts / f.staff) * 100))}%` : ""}</td>
                  <td className={`${TD} figures`}>{f.attendanceCompleteness === null ? "Not measured" : `${Math.round(f.attendanceCompleteness * 100)}% complete`}</td>
                  <td className={`${TD} figures whitespace-nowrap`}>{f.lastRosterPublishedAt ? showDate(f.lastRosterPublishedAt) : "Never"}</td>
                  <td className={`${TD} figures whitespace-nowrap`}>{f.lastSignInAt ? showDate(f.lastSignInAt) : "Never"}</td>
                  <td className={TD} title={f.healthWhy.join(" ")}><StatusBadge tone={HEALTH_TONE[f.health]}>{HEALTH_WORD[f.health]}</StatusBadge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </>
  );
}
