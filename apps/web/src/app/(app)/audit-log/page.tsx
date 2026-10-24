"use client";

import { useEffect, useMemo, useState } from "react";
import { useFacility } from "@/components/AppShell";
import { useResource } from "@/lib/useApi";
import { showDateTime } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";
import {
  Button,
  EmptyState,
  Field,
  Input,
  Loading,
  LoadError,
  Notice,
  PageHeader,
  Select,
  TableScroll,
  TD,
  TH,
} from "@/components/ui";

interface Entry {
  id: string;
  createdAt: string;
  actorEmail: string | null;
  action: string;
  entityType: string;
  summary: string;
  reason: string | null;
}

const TYPES: Record<string, string> = {
  "": "Everything",
  Staff: "Staff",
  Department: "Departments",
  Cadre: "Cadres",
  Facility: "Facility settings",
  UserProfile: "Sign-ins and accounts",
};

const PAGE_SIZE = 50;

function SupportHistory() {
  const { data } = useResource<{ sessions: { id: string; by: string; reason: string; accessLevel: string; startedAt: string; endedAt: string | null; endedReason: string | null }[] }>("/api/facility/notices/support-history");
  if (!data || data.sessions.length === 0) return null;
  return (
    <section className="mb-6 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4" aria-labelledby="support-h">
      <h2 id="support-h" className="font-semibold">PS Tech support access</h2>
      <p className="mb-2 text-sm text-[var(--muted)]">PS Tech support visits, with the reason.</p>
      <ul className="divide-y divide-[var(--border)] text-[15px]">
        {data.sessions.map((s) => (
          <li key={s.id} className="py-2">
            <span className="figures text-sm text-[var(--muted)]">{showDateTime(s.startedAt)}</span> {s.by}, {s.accessLevel === "FULL" ? "full access" : "read only"}: {s.reason}
            <span className="text-sm text-[var(--muted)]">{s.endedAt ? ` Ended ${s.endedReason === "EXPIRED" ? "by timing out" : "by hand"}.` : " Open now."}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function AuditLogPage() {
  const { isAdmin, facility } = useFacility();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [entityType, setEntityType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const path = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (q) p.set("q", q);
    if (entityType) p.set("entityType", entityType);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return `/api/facility/audit-log?${p}`;
  }, [q, entityType, from, to, page]);

  const { data, error, reload } = useResource<{ entries: Entry[]; total: number }>(isAdmin ? path : null);

  if (!isAdmin) return <Notice>Only a facility admin can view the audit log.</Notice>;

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change, who made it and when. Entries cannot be edited."
        actions={<PrintButton label="Print this page" />}
      />
      <p className="mb-4 hidden text-sm print:block">
        {facility.name}. Printed {showDateTime(new Date().toISOString())}.
        {(q || entityType || from || to) && ` Filtered${q ? ` by "${q}"` : ""}${entityType ? `, ${TYPES[entityType]}` : ""}${from ? `, from ${from}` : ""}${to ? `, to ${to}` : ""}.`}
        {data ? ` Page ${page} of ${pages}, ${data.total} ${data.total === 1 ? "entry" : "entries"} in all.` : ""}
      </p>
      <div className="no-print"><SupportHistory /></div>

      <div className="no-print mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Search">
          {(a) => <Input {...a} type="search" placeholder="A name, or what changed" value={search} onChange={(e) => setSearch(e.target.value)} />}
        </Field>
        <Field label="Show">
          {(a) => (
            <Select
              {...a}
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value);
                setPage(1);
              }}
            >
              {Object.entries(TYPES).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="From">
          {(a) => (
            <Input
              {...a}
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          )}
        </Field>
        <Field label="To">
          {(a) => (
            <Input
              {...a}
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          )}
        </Field>
      </div>

      {error && !data && <LoadError onRetry={reload} />}
      {!data && !error && <Loading label="Loading the audit log" />}
      {data && data.entries.length === 0 && (
        <EmptyState title="No entries">
          {q || entityType || from || to ? "Nothing matches these filters." : "Changes will appear here as they are made."}
        </EmptyState>
      )}

      {data && data.entries.length > 0 && (
        <>
          <TableScroll label="Audit log entries">
            <table className="w-full min-w-[40rem] border-collapse text-[15px]">
              <thead>
                <tr>
                  <th scope="col" className={TH}>When</th>
                  <th scope="col" className={TH}>What happened</th>
                  <th scope="col" className={TH}>Account</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id}>
                    <td className={`${TD} figures whitespace-nowrap text-sm text-[var(--muted)]`}>{showDateTime(e.createdAt)}</td>
                    <td className={`${TD} max-w-[60ch]`}>{e.summary}{e.reason && <span className="mt-1 block text-sm text-[var(--muted)]">Reason: {e.reason}</span>}</td>
                    <td className={`${TD} text-sm text-[var(--muted)]`}>{e.actorEmail ?? "System"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <nav aria-label="Audit log pages" className="no-print mt-4 flex flex-wrap items-center gap-3">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Newer
            </Button>
            <span className="figures text-sm text-[var(--muted)]">
              Page {page} of {pages}, {data.total} {data.total === 1 ? "entry" : "entries"}
            </span>
            <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Older
            </Button>
          </nav>
        </>
      )}
    </>
  );
}
