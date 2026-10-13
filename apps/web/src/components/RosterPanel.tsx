"use client";

import { KeyboardEvent, ReactNode, useMemo, useRef, useState } from "react";
import { showDate } from "@/lib/format";
import { coverage, fairness, isoDays, patterns, type Measure } from "@/lib/rosterStats";
import type { RosterView } from "@/lib/types";

type Tab = "compliance" | "coverage" | "fairness" | "patterns";

const TABS: { id: Tab; label: string }[] = [
  { id: "compliance", label: "Compliance" },
  { id: "coverage", label: "Coverage" },
  { id: "fairness", label: "Fairness" },
  { id: "patterns", label: "Patterns" },
];

export function RosterPanel({ data, compliance, blockCount, warnCount }: { data: RosterView; compliance: ReactNode; blockCount: number; warnCount: number }) {
  const [tab, setTab] = useState<Tab>("compliance");
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const { year, month } = data.roster;
  const days = useMemo(() => isoDays(year, month), [year, month]);

  function onKey(e: KeyboardEvent, i: number) {
    const to = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = TABS[(to + TABS.length) % TABS.length];
    setTab(next.id);
    refs.current[next.id]?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label="Roster checks" className="mb-3 flex flex-wrap gap-1 border-b border-[var(--border)]">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            role="tab"
            id={`tab-${t.id}`}
            type="button"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={`-mb-px min-h-11 border-b-2 px-3 text-sm font-medium ${tab === t.id ? "border-[var(--accent)] text-[var(--foreground)]" : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"}`}
          >
            {t.label}
            {t.id === "compliance" && blockCount + warnCount > 0 && <span className="figures ml-1.5 text-[var(--muted)]">{blockCount + warnCount}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0} className="outline-offset-4">
        {tab === "compliance" && compliance}
        {tab === "coverage" && <CoverageTab data={data} days={days} />}
        {tab === "fairness" && <FairnessTab data={data} />}
        {tab === "patterns" && <PatternsTab data={data} days={days} />}
      </div>
    </div>
  );
}

function CoverageTab({ data, days }: { data: RosterView; days: string[] }) {
  const { shifts, rows } = useMemo(() => coverage(data, days), [data, days]);
  const shortDays = rows.filter((r) => r.short);
  const name = (id: string) => shifts.find((s) => s.id === id)?.name ?? "";
  if (!shifts.length) return <p className="text-[15px] text-[var(--muted)]">No shift asks for a minimum number of people, so there is nothing to measure. Set minimums under Shifts.</p>;
  return (
    <div className="space-y-4">
      <p className="text-[15px]">
        {shortDays.length === 0 ? "Every shift has the people it needs on every day." : `${shortDays.length} ${shortDays.length === 1 ? "day is" : "days are"} short of cover.`}
      </p>
      {shortDays.length > 0 && (
        <ul className="divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
          {shortDays.map((r) => (
            <li key={r.date} className="px-3 py-2 text-[15px]">
              <span className="font-medium">{showDate(r.date)}</span>
              {r.cells
                .filter((c) => c.short)
                .map((c) => (
                  <span key={c.shiftId} className="block text-sm">
                    <span className="font-medium text-[var(--status-block)]">Short:</span> {name(c.shiftId)}, {c.staffed} of {c.required}
                    {c.cadreGaps.length ? `. ${c.cadreGaps.join(". ")}.` : "."}
                  </span>
                ))}
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-[var(--accent-text)]">Every day, shift by shift</summary>
        <div className="overflow-x-auto">
          <table className="figures w-full border-collapse text-sm">
            <caption className="sr-only">People on each shift, against the number required</caption>
            <thead>
              <tr>
                <th scope="col" className="border-b border-[var(--border-strong)] px-2 py-1.5 text-left font-medium">
                  Day
                </th>
                {shifts.map((s) => (
                  <th key={s.id} scope="col" className="border-b border-[var(--border-strong)] px-2 py-1.5 text-right font-medium">
                    {s.code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date}>
                  <th scope="row" className="border-b border-[var(--border)] px-2 py-1 text-left font-normal">
                    {Number(r.date.slice(8))}
                  </th>
                  {r.cells.map((c) => (
                    <td key={c.shiftId} className={`border-b border-[var(--border)] px-2 py-1 text-right ${c.short ? "font-semibold text-[var(--status-block)]" : ""}`}>
                      {c.staffed}/{c.required}
                      {c.short && <span className="sr-only"> short</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

const MEASURES: { id: Measure; label: string; unit: string }[] = [
  { id: "nights", label: "Nights", unit: "nights" },
  { id: "weekends", label: "Weekend duties", unit: "weekend duties" },
  { id: "hours", label: "Hours", unit: "hours" },
];

function FairnessTab({ data }: { data: RosterView }) {
  const [measure, setMeasure] = useState<Measure>("nights");
  const rows = useMemo(() => fairness(data, measure), [data, measure]);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.value, r.average)));
  const unit = MEASURES.find((m) => m.id === measure)!.unit;
  const groups = [...new Set(rows.map((r) => r.cadre))];
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Measure" className="flex flex-wrap gap-2">
        {MEASURES.map((m) => (
          <label
            key={m.id}
            className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius)] border px-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ${measure === m.id ? "border-[var(--foreground)]" : "border-[var(--border-strong)]"}`}
          >
            <input type="radio" name="measure" className="size-4 accent-[var(--accent)]" checked={measure === m.id} onChange={() => setMeasure(m.id)} />
            {m.label}
          </label>
        ))}
      </div>
      <p className="text-sm text-[var(--muted)]">Each bar is one person&apos;s {unit} this month. The tick is the average for their cadre.</p>
      {groups.map((g) => (
        <section key={g} aria-label={g}>
          <h3 className="mb-1 text-sm font-semibold">{g}</h3>
          <ul className="space-y-1.5">
            {rows
              .filter((r) => r.cadre === g)
              .map((r) => {
                const over = r.value > r.average * 1.25 && r.value - r.average >= 1;
                return (
                  <li key={r.id} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-2 text-sm">
                    <span className="truncate" title={r.name}>
                      {r.name}
                    </span>
                    <span className="relative block h-3 rounded-[3px] bg-[var(--border)]" role="img" aria-label={`${r.name}: ${fmt(r.value)} ${unit}, cadre average ${fmt(r.average)}`}>
                      <span className="absolute inset-y-0 left-0 rounded-[3px] bg-[var(--accent)]" style={{ width: `${(r.value / max) * 100}%` }} />
                      <span className="absolute -inset-y-0.5 w-0.5 bg-[var(--foreground)]" style={{ left: `${(r.average / max) * 100}%` }} />
                    </span>
                    <span className="figures w-16 text-right">
                      {fmt(r.value)}
                      {over && <span className="block text-xs text-[var(--status-warning-text,var(--foreground))]">Above average</span>}
                    </span>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function PatternsTab({ data, days }: { data: RosterView; days: string[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const asOf = today < days[0] ? days[0] : today > days[days.length - 1] ? days[days.length - 1] : today;
  const rows = useMemo(() => patterns(data, days, asOf), [data, days, asOf]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--muted)]">
        Where each person is in their run on {showDate(asOf)}{asOf === today ? ", today" : ""}.
      </p>
      <ul className="divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
        {rows.map((r) => (
          <li key={r.id} className="px-3 py-2 text-[15px]">
            <span className="block font-medium">{r.name}</span>
            <span className="block text-sm">
              {r.run > 0
                ? `Duty ${r.run} in a row (${r.codes.slice(-6).join(", ")}). ${r.nextOff ? `Next day off: ${showDate(r.nextOff)}.` : "No day off for the rest of the month."}`
                : `Off. ${r.nextDuty ? `Back on duty ${showDate(r.nextDuty)}.` : "No more duties this month."}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
