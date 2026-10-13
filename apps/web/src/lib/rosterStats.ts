// What the roster panel shows, worked out in the browser from the roster
// as it stands: cover per day, how evenly duties are shared, and where each
// person is in their run. Plain functions so they are easy to check.
import type { RosterView } from "@/lib/types";

type View = Pick<RosterView, "staff" | "shifts" | "assignments" | "cadres">;

export const weekdayOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
export const isoDays = (year: number, month: number) => {
  const n = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`);
};

// ----------------------------------------------------------------- coverage

export interface CoverCell {
  shiftId: string;
  staffed: number;
  required: number;
  /** Cadres short on this shift, for example "Midwife needs 2, has 1". */
  cadreGaps: string[];
  short: boolean;
}
export interface CoverDay {
  date: string;
  cells: CoverCell[];
  short: boolean;
}

export function coverage(view: View, days: string[]) {
  const cadreOf = new Map(view.staff.map((s) => [s.id, s.cadreId]));
  const cadreName = new Map(view.cadres.map((c) => [c.id, c.name]));
  const shifts = view.shifts.filter((s) => s.active && s.countsAsDuty && !s.isOnCall && (s.minStaff > 0 || Object.values(s.minByCadre).some((n) => n > 0)));
  const on = new Map<string, string[]>(); // `${date}|${shiftId}` -> staff ids
  for (const a of view.assignments) {
    const k = `${a.date}|${a.shiftId}`;
    (on.get(k) ?? on.set(k, []).get(k)!).push(a.staffId);
  }
  const rows: CoverDay[] = days.map((date) => {
    const cells = shifts.map((s) => {
      const people = on.get(`${date}|${s.id}`) ?? [];
      const gaps: string[] = [];
      for (const [cid, need] of Object.entries(s.minByCadre)) {
        const has = people.filter((p) => cadreOf.get(p) === cid).length;
        if (need > 0 && has < need) gaps.push(`${cadreName.get(cid) ?? "A cadre"} needs ${need}, has ${has}`);
      }
      const required = Math.max(s.minStaff, Object.values(s.minByCadre).reduce((a, b) => a + b, 0));
      return { shiftId: s.id, staffed: people.length, required, cadreGaps: gaps, short: people.length < s.minStaff || gaps.length > 0 };
    });
    return { date, cells, short: cells.some((c) => c.short) };
  });
  return { shifts, rows };
}

// ----------------------------------------------------------------- fairness

export type Measure = "nights" | "weekends" | "hours";

export interface FairRow {
  id: string;
  name: string;
  cadre: string;
  value: number;
  average: number;
}

export function fairness(view: View, measure: Measure): FairRow[] {
  const shift = new Map(view.shifts.map((s) => [s.id, s]));
  const total = new Map<string, number>();
  for (const a of view.assignments) {
    const s = shift.get(a.shiftId);
    if (!s || !s.countsAsDuty) continue;
    const add = measure === "nights" ? (s.isOvernight ? 1 : 0) : measure === "weekends" ? ([0, 6].includes(weekdayOf(a.date)) ? 1 : 0) : s.durationHours;
    total.set(a.staffId, (total.get(a.staffId) ?? 0) + add);
  }
  const byCadre = new Map<string, number[]>();
  for (const p of view.staff) {
    const k = p.cadreName ?? "No cadre";
    (byCadre.get(k) ?? byCadre.set(k, []).get(k)!).push(total.get(p.id) ?? 0);
  }
  const avg = new Map([...byCadre].map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length]));
  return view.staff
    .map((p) => ({ id: p.id, name: p.name, cadre: p.cadreName ?? "No cadre", value: total.get(p.id) ?? 0, average: avg.get(p.cadreName ?? "No cadre") ?? 0 }))
    .sort((a, b) => a.cadre.localeCompare(b.cadre) || b.value - a.value);
}

// ----------------------------------------------------------------- patterns

export interface PatternRow {
  id: string;
  name: string;
  /** Duties in the run that ends on the day looked at; 0 when off that day. */
  run: number;
  codes: string[];
  nextOff: string | null;
  nextDuty: string | null;
  today: string;
}

/** Where each person is in their run on the given day. */
export function patterns(view: View, days: string[], asOf: string): PatternRow[] {
  const shift = new Map(view.shifts.map((s) => [s.id, s]));
  const cell = new Map(view.assignments.map((a) => [`${a.staffId}|${a.date}`, a.shiftId]));
  const duty = (id: string, d: string) => {
    const s = shift.get(cell.get(`${id}|${d}`) ?? "");
    return s && s.countsAsDuty ? s : null;
  };
  const at = days.indexOf(asOf);
  return view.staff.map((p) => {
    const codes: string[] = [];
    for (let i = at; i >= 0; i--) {
      const s = duty(p.id, days[i]);
      if (!s) break;
      codes.unshift(s.code);
    }
    let nextOff: string | null = null;
    let nextDuty: string | null = null;
    for (let i = at + 1; i < days.length; i++) {
      const on = Boolean(duty(p.id, days[i]));
      if (codes.length > 0 && !on) { nextOff = days[i]; break; }
      if (codes.length === 0 && on) { nextDuty = days[i]; break; }
    }
    return { id: p.id, name: p.name, run: codes.length, codes, nextOff, nextDuty, today: asOf };
  });
}
