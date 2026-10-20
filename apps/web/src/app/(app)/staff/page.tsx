"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useFacility } from "@/components/AppShell";
import { useResource } from "@/lib/useApi";
import { EMPLOYMENT, STAFF_STATUS } from "@/lib/format";
import type { Cadre, Department, Staff } from "@/lib/types";
import {
  ButtonLink,
  EmptyState,
  Field,
  Input,
  Loading,
  LoadError,
  PageHeader,
  Select,
  StatusBadge,
  TableScroll,
  TD,
  TH,
} from "@/components/ui";

type Show = "current" | "former" | "all";

const SHOW_LABEL: Record<Show, string> = {
  current: "Current staff",
  former: "Former staff",
  all: "Everyone",
};

function countLine(n: number, show: Show, narrowed: boolean) {
  const who = { current: "current staff", former: "former staff", all: n === 1 ? "person" : "people" }[show];
  return `${n} ${who}${narrowed ? " matching your filters" : ""}`;
}

export default function StaffListPage() {
  const { isAdmin } = useFacility();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [show, setShow] = useState<Show>("current");
  const [cadreId, setCadreId] = useState("");
  const [departmentId, setDepartmentId] = useState("");

  // Search as the person types, without a request per keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => setQ(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  const path = useMemo(() => {
    const p = new URLSearchParams({ show });
    if (q) p.set("q", q);
    if (cadreId) p.set("cadreId", cadreId);
    if (departmentId) p.set("departmentId", departmentId);
    return `/api/facility/staff?${p}`;
  }, [q, show, cadreId, departmentId]);

  const staff = useResource<{ staff: Staff[] }>(path);
  const cadres = useResource<{ cadres: Cadre[] }>("/api/facility/cadres");
  const departments = useResource<{ departments: Department[] }>("/api/facility/departments");

  const filtered = Boolean(q || cadreId || departmentId || show !== "current");
  const rows = staff.data?.staff ?? [];

  return (
    <>
      <PageHeader
        title="Staff"
        description={staff.data ? countLine(rows.length, show, Boolean(q || cadreId || departmentId)) : undefined}
        actions={
          isAdmin && (
            <>
              <ButtonLink href="/staff/invite">Invite staff</ButtonLink>
              <ButtonLink href="/staff/access" variant="secondary">
                Access code
              </ButtonLink>
              <ButtonLink href="/staff/new" variant="secondary">
                Add staff member
              </ButtonLink>
              <ButtonLink href="/staff/import" variant="secondary">
                Import from a file
              </ButtonLink>
            </>
          )
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Search">
          {(a) => (
            <Input
              {...a}
              type="search"
              placeholder="Name or staff number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
        </Field>
        <Field label="Show">
          {(a) => (
            <Select {...a} value={show} onChange={(e) => setShow(e.target.value as Show)}>
              {(Object.keys(SHOW_LABEL) as Show[]).map((k) => (
                <option key={k} value={k}>
                  {SHOW_LABEL[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Department">
          {(a) => (
            <Select {...a} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">All departments</option>
              {departments.data?.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.active ? "" : " (inactive)"}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Cadre">
          {(a) => (
            <Select {...a} value={cadreId} onChange={(e) => setCadreId(e.target.value)}>
              <option value="">All cadres</option>
              {cadres.data?.cadres.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.active ? "" : " (inactive)"}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {staff.error && !staff.data && <LoadError onRetry={staff.reload} />}
      {!staff.data && !staff.error && <Loading label="Loading staff" />}

      {staff.data && rows.length === 0 && (
        filtered ? (
          <EmptyState title="No one matches these filters">Clear the search or choose different filters.</EmptyState>
        ) : (
          <EmptyState
            title="No staff yet"
            action={isAdmin && <ButtonLink href="/staff/new">Add the first staff member</ButtonLink>}
          >
            Set up departments and cadres first, then add staff.
          </EmptyState>
        )
      )}

      {rows.length > 0 && (
        <TableScroll label="Staff list">
          <table className="w-full min-w-[46rem] border-collapse text-[15px]">
            <thead>
              <tr>
                <th scope="col" className={`${TH} sticky left-0 z-10 bg-[var(--surface)]`}>
                  Name
                </th>
                <th scope="col" className={TH}>Staff no.</th>
                <th scope="col" className={TH}>Cadre</th>
                <th scope="col" className={TH}>Department</th>
                <th scope="col" className={TH}>Employment</th>
                <th scope="col" className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const status = STAFF_STATUS[s.status] ?? { label: s.status, tone: "neutral" as const };
                return (
                  <tr key={s.id} className="hover:bg-[var(--accent-soft)]">
                    <td className={`${TD} sticky left-0 bg-[var(--surface)]`}>
                      <Link
                        href={`/staff/${s.id}`}
                        className="font-medium text-[var(--accent-text)] underline-offset-4 hover:underline"
                      >
                        {s.fullName}
                      </Link>
                      {s.position && <p className="text-sm text-[var(--muted)]">{s.position}</p>}
                    </td>
                    <td className={`${TD} figures`}>{s.staffNo}</td>
                    <td className={TD}>
                      {s.cadre ? (
                        <>
                          {s.cadre.name}
                          {s.cadre.code && <span className="figures ml-1.5 text-sm text-[var(--muted)]">{s.cadre.code}</span>}
                        </>
                      ) : (
                        <span className="text-[var(--muted)]">Not set</span>
                      )}
                    </td>
                    <td className={TD}>{s.department?.name ?? <span className="text-[var(--muted)]">Not set</span>}</td>
                    <td className={TD}>{EMPLOYMENT[s.employmentStatus]}</td>
                    <td className={TD}>
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
    </>
  );
}
