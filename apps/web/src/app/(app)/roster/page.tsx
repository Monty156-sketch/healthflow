"use client";

import { useMemo, useState } from "react";
import { useResource } from "@/lib/useApi";
import { MONTHS } from "@/lib/format";
import type { Staff } from "@/lib/types";
import { Button, Checkbox, EmptyState, Loading, LoadError, Notice, PageHeader, Select } from "@/components/ui";
import { ChipTone, GridChip, MonthGrid } from "@/components/MonthGrid";

type Sample = { code: string; tone: ChipTone; word: string };

const PATTERN: Sample[] = [
  { code: "M", tone: "morning", word: "Morning" },
  { code: "M", tone: "morning", word: "Morning" },
  { code: "A", tone: "afternoon", word: "Afternoon" },
  { code: "A", tone: "afternoon", word: "Afternoon" },
  { code: "N", tone: "night", word: "Night" },
  { code: "N", tone: "night", word: "Night" },
  { code: "O", tone: "off", word: "Off duty" },
  { code: "O", tone: "off", word: "Off duty" },
];

/** Sample duties only: a fixed pattern offset per person, so the grid has something to show. */
function sampleFor(index: number, day: number): Sample {
  return PATTERN[(day + index * 3) % PATTERN.length];
}

export default function RosterPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [sample, setSample] = useState(false);
  const { data, error, reload } = useResource<{ staff: Staff[] }>("/api/facility/staff?show=current");

  const rows = useMemo(
    () =>
      (data?.staff ?? []).map((s) => ({
        id: s.id,
        name: s.fullName,
        cadreCode: s.cadre?.code ?? s.cadre?.name ?? null,
        cadreName: s.cadre?.name ?? null,
        departmentName: s.department?.name ?? null,
      })),
    [data]
  );
  const indexOf = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);

  function step(delta: number) {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    setYear(d.getUTCFullYear());
    setMonth(d.getUTCMonth() + 1);
  }

  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading staff" />;

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 1 + i);
  const day = (iso: string) => Number(iso.slice(8, 10));

  return (
    <>
      <PageHeader title="Roster" description="Everyone on the staff list, by department and cadre, for one month." />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Button variant="secondary" onClick={() => step(-1)} aria-label="Previous month">
          Previous
        </Button>
        <div>
          <label htmlFor="r-month" className="sr-only">
            Month
          </label>
          <Select id="r-month" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="r-year" className="sr-only">
            Year
          </label>
          <Select id="r-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </Select>
        </div>
        <Button variant="secondary" onClick={() => step(1)} aria-label="Next month">
          Next
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No staff yet">Add staff first. They appear here, ready to be rostered.</EmptyState>
      ) : (
        <>
          <div className="mb-3">
            {sample ? (
              <Notice tone="warning">
                Sample duties. These are invented to show how the grid will look. They are not saved and are not anyone&apos;s real roster.
              </Notice>
            ) : (
              <Notice>No duties have been planned for {MONTHS[month - 1]} {year}. Building rosters arrives in the next phase.</Notice>
            )}
          </div>
          <div className="mb-3">
            <Checkbox label="Show sample duties" hint="Switch off to see the real, empty month." checked={sample} onChange={setSample} />
          </div>
          <MonthGrid<Sample>
            year={year}
            month={month}
            staff={rows}
            caption={`${MONTHS[month - 1]} ${year} roster${sample ? ", with sample duties" : ""}`}
            cellData={sample ? (id, iso) => sampleFor(indexOf.get(id) ?? 0, day(iso)) : undefined}
            renderCell={(d) => <GridChip code={d.code} tone={d.tone} />}
            describeCell={(d) => d.word}
          />
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {[PATTERN[0], PATTERN[2], PATTERN[4], PATTERN[6]].map((p) => (
              <div key={p.code} className="flex items-center gap-2">
                <dt>
                  <GridChip code={p.code} tone={p.tone} />
                </dt>
                <dd>{p.word}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </>
  );
}
