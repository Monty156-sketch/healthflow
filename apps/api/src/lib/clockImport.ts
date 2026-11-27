// Reads what a clock device or its software gives out, in two shapes:
//  1. ZKBio Time's "Transaction" report (CSV/Excel text, or the printed layout): Employee ID, name, department, date, time, Check In / Check Out.
//  2. The machine's own USB file (*_attlog.dat): the person's number, then the date and time.
// Anything it cannot read is counted, never guessed.
export type Punch = { pin: string; at: Date; name?: string; dept?: string; state?: "IN" | "OUT" };
export type ParsedPunches = { punches: Punch[]; skipped: number };

const DT = /^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
const D = /^(\d{4})[-/](\d{2})[-/](\d{2})$/;
const T = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const REPORT = /(\d{4}[-/]\d{2}[-/]\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)\s+(check in|check out|overtime in|overtime out|break in|break out|in|out)\b/i;

const make = (y: string, mo: string, d: string, h: string, mi: string, s?: string) => {
  const at = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0));
  // Reject dates like 2026-13-45 that JavaScript would roll over.
  return at.getUTCMonth() === +mo - 1 && at.getUTCDate() === +d && +h < 24 && +mi < 60 ? at : null;
};
const when = (date: string, time: string) => {
  const d = D.exec(date);
  const t = T.exec(time);
  return d && t ? make(d[1], d[2], d[3], t[1], t[2], t[3]) : null;
};
/** Break punches are not arrivals or departures. */
const stateOf = (w: string): "IN" | "OUT" | "BREAK" => (/^break/i.test(w) ? "BREAK" : /in$/i.test(w) ? "IN" : "OUT");
const cells = (line: string) => (line.includes("\t") ? line.split("\t") : line.includes(",") ? line.split(",") : line.split(/\s{2,}/)).map((x) => x.trim().replace(/^"|"$/g, ""));

/** The machine keeps local time; Ghana is on UTC all year, so the time is read as UTC, the same as every other time in HealthFlow. */
export function parsePunches(text: string): ParsedPunches {
  const punches: Punch[] = [];
  let skipped = 0;
  let cols: { id: number; name: number[]; dept: number; date: number; time: number; state: number } | null = null;
  for (const raw of (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const f = cells(line);

    // A header row tells us which column is which, whatever order the export uses.
    if (/employee\s*id|emp\.?\s*id|person\s*id/i.test(line) && /(date|time)/i.test(line)) {
      const at = (re: RegExp) => f.findIndex((c) => re.test(c));
      cols = { id: at(/employee\s*id|emp\.?\s*id|person\s*id/i), name: f.map((c, i) => (/first name|last name|^name$|full name/i.test(c) ? i : -1)).filter((i) => i >= 0), dept: at(/department/i), date: at(/^date$/i), time: at(/^time$/i), state: at(/punch state|state|status/i) };
      continue;
    }
    if (/^(transaction|start date|\d+\/\d+)\b/i.test(line) && !REPORT.test(line)) continue; // report title, period and page lines

    // Report rows, found by their date, time and Check In / Check Out words so extra columns do not matter.
    if (cols && cols.id >= 0 && cols.date >= 0 && cols.time >= 0 && cols.state >= 0 && f.length > cols.state) {
      const at = when(f[cols.date], f[cols.time]);
      const st = /in$|out$/i.test(f[cols.state]) ? stateOf(f[cols.state]) : null;
      if (st === "BREAK") continue;
      if (f[cols.id] && at && st) { punches.push({ pin: f[cols.id], at, name: cols.name.map((i) => f[i]).filter(Boolean).join(" ") || undefined, dept: cols.dept >= 0 ? f[cols.dept] || undefined : undefined, state: st }); continue; }
    }
    const m = REPORT.exec(line);
    if (m) {
      const st = stateOf(m[3]);
      if (st === "BREAK") continue;
      const at = when(m[1].replace(/\//g, "-"), m[2]);
      const head = line.slice(0, m.index).trim();
      const parts = head.split(/\s{2,}|\t|,/).map((x) => x.trim()).filter(Boolean);
      const pin = parts[0] ?? head.split(/\s+/)[0];
      const name = parts.length >= 2 ? parts[1] : head.split(/\s+/).slice(1).join(" ");
      if (at && pin && /^[A-Za-z0-9-]+$/.test(pin)) { punches.push({ pin, at, name: name || undefined, dept: parts[2] || undefined, state: st }); continue; }
      skipped++;
      continue;
    }

    // The machine's own file: number, then date and time.
    const g = line.includes("\t") ? f : line.includes(",") ? f : line.split(/\s+/);
    const pin = g[0];
    let at: Date | null = null;
    const a = DT.exec(g[1] ?? "");
    if (a) at = make(a[1], a[2], a[3], a[4], a[5], a[6]);
    else at = when(g[1] ?? "", g[2] ?? "");
    if (!pin || !/^[A-Za-z0-9-]+$/.test(pin) || !at) { skipped++; continue; }
    punches.push({ pin, at });
  }
  return { punches, skipped };
}

/**
 * What the machine itself sends as it is used (the ADMS feed): one punch per line, tab-separated, as
 * number, date and time, status, how it was verified, work code. Status 0 and 4 are a check-in, 1 and 5 a check-out,
 * 2 and 3 are breaks (ignored). Any other status (a machine that does not say) leaves the punch without a word,
 * so the first and last punch of a duty are used, the same as for a USB file.
 */
export function parseAdmsAttlog(text: string): ParsedPunches {
  const punches: Punch[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const f = (line.includes("\t") ? line.split("\t") : line.split(/\s+/)).map((x) => x.trim());
    const joined = DT.exec(f[1] ?? "");
    const at = joined ? make(joined[1], joined[2], joined[3], joined[4], joined[5], joined[6]) : when(f[1] ?? "", f[2] ?? "");
    const status = joined ? f[2] : f[3];
    if (!f[0] || !/^[A-Za-z0-9-]+$/.test(f[0]) || !at) { skipped++; continue; }
    const n = status !== undefined && /^\d+$/.test(status) ? Number(status) : NaN;
    if (n === 2 || n === 3) continue;
    punches.push({ pin: f[0], at, ...(n === 0 || n === 4 ? { state: "IN" as const } : n === 1 || n === 5 ? { state: "OUT" as const } : {}) });
  }
  return { punches, skipped };
}

/** "007" and "7" are the same person on most machines. */
export const normalisePin = (p: string) => p.replace(/^0+(?=.)/, "").toLowerCase();

const HOURS = 3_600_000;
export type Visit = { arrived: Date; left: Date | null };

/**
 * One person's punches, in order, turned into visits using the machine's own Check In / Check Out words.
 * A Check Out closes the Check In before it if that was within 18 hours (a night shift is 12 or 13).
 * A Check In with no Check Out is a visit with no departure. A Check Out with nothing to close is "orphan": we cannot know when they arrived.
 */
export function pairVisits(punches: { at: Date; state: "IN" | "OUT" }[]): { visits: Visit[]; orphanOuts: Date[] } {
  const sorted = [...punches].sort((a, b) => a.at.getTime() - b.at.getTime());
  const visits: Visit[] = [];
  const orphanOuts: Date[] = [];
  let open: Visit | null = null;
  for (const p of sorted) {
    if (p.state === "IN") {
      if (open) visits.push(open);
      open = { arrived: p.at, left: null };
    } else if (open && p.at.getTime() - open.arrived.getTime() <= 18 * HOURS) {
      open.left = p.at;
      visits.push(open);
      open = null;
    } else {
      if (open) { visits.push(open); open = null; }
      orphanOuts.push(p.at);
    }
  }
  if (open) visits.push(open);
  return { visits, orphanOuts };
}

const tokens = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean).sort();
/** Same name in another order or with an extra name counts as a match, so long as two or more names agree. */
export function sameName(a: string, b: string) {
  const x = tokens(a);
  const y = tokens(b);
  const [small, big] = x.length <= y.length ? [x, y] : [y, x];
  return small.length >= 2 && small.every((t) => big.includes(t));
}

/** One transaction as ZKBio Time's own API reports it: employee code, "YYYY-MM-DD HH:MM:SS" and "Check In" / "Check Out". Null for breaks and anything unreadable. */
export function punchFrom(code: string, time: string, state: string, name?: string, dept?: string): Punch | null {
  const m = DT.exec(time.trim());
  const st = /(in|out)$/i.test(state.trim()) ? stateOf(state.trim()) : null;
  if (!m || !st || st === "BREAK" || !/^[A-Za-z0-9-]+$/.test(code)) return null;
  const at = make(m[1], m[2], m[3], m[4], m[5], m[6]);
  return at ? { pin: code, at, name: name || undefined, dept: dept || undefined, state: st } : null;
}
