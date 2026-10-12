"use client";

// The month grid (Part 3, 0.6, AD6): one component, used later for the
// roster builder, attendance and the published roster.
//
// - Rows are staff, grouped by department, then cadre. The name column stays
//   put when the grid scrolls sideways; the date header stays put when it
//   scrolls down.
// - Each cell shows a short code chip chosen by the caller, and can carry a
//   status stripe on its left edge.
// - The grid scrolls inside its own box. The page never scrolls sideways,
//   and at 360px it still scrolls rather than collapsing into cards.
// - Cells are reachable by keyboard: Tab enters the grid once, then the
//   arrow keys move, Home/End jump within a row, Enter or Space selects.
import { KeyboardEvent, ReactNode, useMemo, useRef, useState } from "react";

export interface GridStaff {
  id: string;
  name: string;
  cadreCode?: string | null;
  cadreName?: string | null;
  cadreOrder?: number;
  departmentName?: string | null;
}

export type ChipTone = "morning" | "afternoon" | "night" | "off" | "neutral";

const CHIP_COLOR: Record<ChipTone, string> = {
  morning: "var(--shift-morning)",
  afternoon: "var(--shift-afternoon)",
  night: "var(--shift-night)",
  off: "var(--shift-off-duty)",
  neutral: "var(--status-neutral)",
};

/** A short code on a tinted background: never colour alone, the code carries the meaning. */
export function GridChip({ code, tone, colour }: { code: string; tone: ChipTone; colour?: string }) {
  const c = colour ?? CHIP_COLOR[tone];
  return (
    <span
      className="figures inline-flex h-6 min-w-7 items-center justify-center rounded-[4px] px-1 text-[12px] font-semibold"
      style={{ color: `color-mix(in srgb, ${c} 72%, var(--foreground))`, backgroundColor: `color-mix(in srgb, ${c} 14%, var(--surface))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} 35%, transparent)` }}
    >
      {code}
    </span>
  );
}

const WEEKDAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAME = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** YYYY-MM-DD for each day of the month, as calendar dates (no time zones involved). */
function daysOf(year: number, month: number) {
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => {
    const d = i + 1;
    const weekday = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    return { day: d, weekday, iso: `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
  });
}

interface Props<T> {
  year: number;
  /** 1 to 12 */
  month: number;
  staff: GridStaff[];
  /** The data for one cell; undefined for an empty cell. */
  cellData?: (staffId: string, date: string) => T | undefined;
  /** What the cell shows, usually a GridChip. */
  renderCell?: (data: T) => ReactNode;
  /** A word for screen readers, for example "Morning". */
  describeCell?: (data: T) => string;
  /** A CSS colour for the cell's left-edge stripe, or null. */
  stripe?: (staffId: string, date: string, data: T | undefined) => string | null;
  onCellClick?: (staffId: string, date: string, data: T | undefined) => void;
  caption: string;
}

type Row = { kind: "group"; label: string; key: string } | { kind: "staff"; staff: GridStaff; index: number };

export function MonthGrid<T>({ year, month, staff, cellData, renderCell, describeCell, stripe, onCellClick, caption }: Props<T>) {
  const days = useMemo(() => daysOf(year, month), [year, month]);

  // Department, then cadre (by its order), then name.
  const rows = useMemo<Row[]>(() => {
    const sorted = [...staff].sort(
      (a, b) =>
        (a.departmentName ?? "￿").localeCompare(b.departmentName ?? "￿") ||
        (a.cadreOrder ?? 999) - (b.cadreOrder ?? 999) ||
        (a.cadreName ?? "").localeCompare(b.cadreName ?? "") ||
        a.name.localeCompare(b.name)
    );
    const out: Row[] = [];
    let dept: string | null | undefined = undefined;
    let i = 0;
    for (const s of sorted) {
      if (s.departmentName !== dept) {
        dept = s.departmentName;
        out.push({ kind: "group", label: dept ?? "No department", key: `g-${dept ?? "none"}` });
      }
      out.push({ kind: "staff", staff: s, index: i++ });
    }
    return out;
  }, [staff]);

  const staffRows = rows.filter((r): r is Extract<Row, { kind: "staff" }> => r.kind === "staff");
  const [active, setActive] = useState({ r: 0, c: 0 });
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  const interactive = Boolean(onCellClick);

  function focusCell(r: number, c: number) {
    const rr = Math.max(0, Math.min(staffRows.length - 1, r));
    const cc = Math.max(0, Math.min(days.length - 1, c));
    setActive({ r: rr, c: cc });
    cellRefs.current.get(`${rr}:${cc}`)?.focus();
  }

  function onKey(e: KeyboardEvent, r: number, c: number) {
    const moves: Record<string, [number, number]> = {
      ArrowRight: [r, c + 1],
      ArrowLeft: [r, c - 1],
      ArrowDown: [r + 1, c],
      ArrowUp: [r - 1, c],
      Home: [r, 0],
      End: [r, days.length - 1],
    };
    const to = moves[e.key];
    if (to) {
      e.preventDefault();
      focusCell(to[0], to[1]);
    }
  }

  return (
    <div
      className="print-grid relative max-h-[70vh] overflow-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]"
      role="region"
      aria-label={caption}
      tabIndex={interactive ? -1 : 0}
    >
      <table className="border-separate border-spacing-0 text-[14px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky top-0 left-0 z-30 min-w-[9.5rem] border-r border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left text-[13px] font-medium text-[var(--muted)] sm:min-w-[12rem]"
            >
              Staff
            </th>
            {days.map((d) => {
              const weekend = d.weekday === 0 || d.weekday === 6;
              return (
                <th
                  key={d.iso}
                  scope="col"
                  className="sticky top-0 z-20 min-w-9 border-b border-[var(--border)] px-0.5 py-1.5 text-center font-normal"
                  style={{ background: weekend ? "color-mix(in srgb, var(--border) 45%, var(--surface))" : "var(--surface)" }}
                >
                  <abbr title={`${WEEKDAY_NAME[d.weekday]} ${d.day} ${MONTH_NAME[month - 1]}`} className="no-underline">
                    <span className="figures block text-[13px] font-semibold">{d.day}</span>
                    <span className="block text-[11px] text-[var(--muted)]">{WEEKDAY_LETTER[d.weekday]}</span>
                  </abbr>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) =>
            row.kind === "group" ? (
              <tr key={row.key}>
                <th
                  scope="colgroup"
                  colSpan={1}
                  className="sticky left-0 z-10 border-r border-b border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-left text-[13px] font-semibold"
                >
                  {row.label}
                </th>
                <td colSpan={days.length} className="border-b border-[var(--border)] bg-[var(--background)]" />
              </tr>
            ) : (
              <tr key={row.staff.id}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-r border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-left font-normal"
                >
                  <span className="block max-w-[11rem] truncate font-medium" title={row.staff.name}>
                    {row.staff.name}
                  </span>
                  {row.staff.cadreCode && <span className="figures block text-[12px] text-[var(--muted)]">{row.staff.cadreCode}</span>}
                </th>
                {days.map((d, c) => {
                  const data = cellData?.(row.staff.id, d.iso);
                  const edge = stripe?.(row.staff.id, d.iso, data) ?? null;
                  const weekend = d.weekday === 0 || d.weekday === 6;
                  const content = data !== undefined && renderCell ? renderCell(data) : null;
                  const label = `${row.staff.name}, ${WEEKDAY_NAME[d.weekday]} ${d.day} ${MONTH_NAME[month - 1]}: ${
                    data !== undefined && describeCell ? describeCell(data) : "nothing assigned"
                  }`;
                  const isActive = active.r === row.index && active.c === c;
                  return (
                    <td
                      key={d.iso}
                      className="h-10 border-b border-[var(--border)] p-0 text-center"
                      style={{
                        background: weekend ? "color-mix(in srgb, var(--border) 30%, var(--surface))" : undefined,
                        boxShadow: edge ? `inset 3px 0 0 ${edge}` : undefined,
                      }}
                    >
                      {interactive ? (
                        <button
                          type="button"
                          ref={(el) => {
                            const k = `${row.index}:${c}`;
                            if (el) cellRefs.current.set(k, el);
                            else cellRefs.current.delete(k);
                          }}
                          tabIndex={isActive ? 0 : -1}
                          aria-label={label}
                          onFocus={() => setActive({ r: row.index, c })}
                          onKeyDown={(e) => onKey(e, row.index, c)}
                          onClick={() => onCellClick?.(row.staff.id, d.iso, data)}
                          className="flex h-10 w-full min-w-9 items-center justify-center hover:bg-[var(--accent-soft)]"
                        >
                          {content}
                        </button>
                      ) : (
                        <span className="flex h-10 items-center justify-center" aria-label={label}>
                          {content}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
