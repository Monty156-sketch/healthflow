// One place that turns a value into a CSV cell. Besides quoting, it defuses cells a spreadsheet would
// read as a formula (starting with = + - @ tab or return) by putting a single quote in front, so text typed by
// one person cannot run when another opens the download. Plain numbers (including negatives) are left alone.
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
