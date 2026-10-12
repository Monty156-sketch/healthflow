"use client";

import { useEffect, useMemo, useState } from "react";
import { useFacility } from "@/components/AppShell";
import { useResource } from "@/lib/useApi";
import { showDateTime } from "@/lib/format";
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

export default function AuditLogPage() {
  const { isAdmin } = useFacility();
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
        description="Every change to your facility's records, with who made it and when. Entries cannot be edited or deleted by anyone."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                    <td className={`${TD} max-w-[60ch]`}>{e.summary}</td>
                    <td className={`${TD} text-sm text-[var(--muted)]`}>{e.actorEmail ?? "System"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <nav aria-label="Audit log pages" className="mt-4 flex flex-wrap items-center gap-3">
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
