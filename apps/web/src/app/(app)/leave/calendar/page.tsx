"use client";

import { useMemo, useState } from "react";
import { useResource } from "@/lib/useApi";
import { MONTHS } from "@/lib/format";
import type { LeaveCalendar } from "@/lib/types";
import { GridChip, MonthGrid } from "@/components/MonthGrid";
import { Loading, LoadError, PageHeader, Panel, Select } from "@/components/ui";

interface Cell {
  code: string;
  colour: string | null;
  typeName: string;
  pending: boolean;
}

export default function LeaveCalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [cadre, setCadre] = useState("");
  const [dept, setDept] = useState("");
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const { data, error, reload } = useResource<LeaveCalendar>(`/api/facility/leave/calendar?month=${key}`);

  const staff = useMemo(() => (data?.staff ?? []).filter((s) => (!cadre || s.cadreId === cadre) && (!dept || s.departmentId === dept)), [data, cadre, dept]);
  const cells = useMemo(() => {
    const m = new Map<string, Cell>();
    for (const l of data?.leave ?? []) {
      for (let d = Date.parse(l.startDate); d <= Date.parse(l.endDate); d += 86_400_000) {
        const iso = new Date(d).toISOString().slice(0, 10);
        m.set(`${l.staffId}|${iso}`, { code: l.code, colour: l.colour, typeName: l.typeName, pending: l.pending });
      }
    }
    return m;
  }, [data]);

  // How many of each cadre are away on each day, for the side panel.
  const away = useMemo(() => {
    const byDay = new Map<string, Map<string, number>>();
    for (const s of staff) {
      for (const [k] of cells) {
        if (!k.startsWith(`${s.id}|`)) continue;
        const iso = k.split("|")[1];
        const c = cells.get(k)!;
        if (c.pending) continue;
        const name = s.cadreName ?? "No cadre";
        const day = byDay.get(iso) ?? new Map<string, number>();
        day.set(name, (day.get(name) ?? 0) + 1);
        byDay.set(iso, day);
      }
    }
    return [...byDay].sort(([a], [b]) => a.localeCompare(b));
  }, [staff, cells]);

  const years = Array.from({ length: 4 }, (_, i) => now.getFullYear() - 1 + i);

  return (
    <>
      <PageHeader title="Leave calendar" description="Dashed: waiting for a decision." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="cal-month" className="mb-1 block text-sm font-medium">
            Month
          </label>
          <Select id="cal-month" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="cal-year" className="mb-1 block text-sm font-medium">
            Year
          </label>
          <Select id="cal-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="cal-cadre" className="mb-1 block text-sm font-medium">
            Cadre
          </label>
          <Select id="cal-cadre" value={cadre} onChange={(e) => setCadre(e.target.value)}>
            <option value="">All cadres</option>
            {(data?.cadres ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="cal-dept" className="mb-1 block text-sm font-medium">
            Department
          </label>
          <Select id="cal-dept" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">All departments</option>
            {(data?.departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error && !data ? (
        <LoadError onRetry={reload} />
      ) : !data ? (
        <Loading label="Loading calendar" />
      ) : (
        <div className="gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
            <MonthGrid<Cell>
              year={year}
              month={month}
              staff={staff}
              caption={`Leave in ${MONTHS[month - 1]} ${year}`}
              cellData={(id, iso) => cells.get(`${id}|${iso}`)}
              renderCell={(c) =>
                c.pending ? (
                  <span className="inline-flex rounded-[5px] outline-1 outline-offset-1 outline-dashed outline-[var(--muted)]">
                    <GridChip code={c.code} tone="neutral" colour={c.colour ?? undefined} />
                  </span>
                ) : (
                  <GridChip code={c.code} tone="neutral" colour={c.colour ?? undefined} />
                )
              }
              describeCell={(c) => `${c.typeName} leave${c.pending ? ", waiting for a decision" : ""}`}
            />
          </div>
          <div className="mt-6 lg:mt-0">
            <Panel title="Away each day" description="Approved leave only, by cadre.">
              {away.length === 0 ? (
                <p className="text-[15px] text-[var(--muted)]">Nobody is away this month.</p>
              ) : (
                <ul className="max-h-[28rem] divide-y divide-[var(--border)] overflow-auto text-[15px]">
                  {away.map(([iso, byCadre]) => (
                    <li key={iso} className="flex justify-between gap-3 py-1.5">
                      <span className="figures">{Number(iso.slice(8))} {MONTHS[month - 1].slice(0, 3)}</span>
                      <span className="text-right">{[...byCadre].map(([n, c]) => `${c} ${n}`).join(", ")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
