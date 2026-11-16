// Reads the punches file a clock device gives out (ZKTeco-style *_attlog.dat or a CSV export).
// One punch per line: the person's number on the machine, then the date and time. Anything else on the line is ignored.
export type Punch = { pin: string; at: Date };
export type ParsedPunches = { punches: Punch[]; skipped: number };

const DT = /^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
const D = /^(\d{4})[-/](\d{2})[-/](\d{2})$/;
const T = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

const make = (y: string, mo: string, d: string, h: string, mi: string, s?: string) => {
  const at = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0));
  // Reject dates like 2026-13-45 that JavaScript would roll over.
  return at.getUTCMonth() === +mo - 1 && at.getUTCDate() === +d && +h < 24 && +mi < 60 ? at : null;
};

/** The machine keeps local time; Ghana is on UTC all year, so the time is read as UTC, the same as every other time in HealthFlow. */
export function parsePunches(text: string): ParsedPunches {
  const punches: Punch[] = [];
  let skipped = 0;
  for (const raw of (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const f = (line.includes("\t") ? line.split("\t") : line.includes(",") ? line.split(",") : line.split(/\s+/)).map((x) => x.trim().replace(/^"|"$/g, ""));
    const pin = f[0];
    let at: Date | null = null;
    const a = DT.exec(f[1] ?? "");
    if (a) at = make(a[1], a[2], a[3], a[4], a[5], a[6]);
    else {
      const d = D.exec(f[1] ?? "");
      const t = T.exec(f[2] ?? "");
      if (d && t) at = make(d[1], d[2], d[3], t[1], t[2], t[3]);
    }
    if (!pin || !/^[A-Za-z0-9-]+$/.test(pin) || !at) { skipped++; continue; }
    punches.push({ pin, at });
  }
  return { punches, skipped };
}

/** "007" and "7" are the same person on most machines. */
export const normalisePin = (p: string) => p.replace(/^0+(?=.)/, "").toLowerCase();
