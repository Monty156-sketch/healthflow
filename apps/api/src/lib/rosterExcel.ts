// The roster as a spreadsheet: one row per person, one column per day, shift
// codes in the cells coloured as on screen, with duty and hour totals that are
// live formulas so a hand edit keeps adding up.
import ExcelJS from "exceljs";
import type { PdfRoster } from "./rosterPdf.js";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const argb = (hex: string | null) => (hex && /^#[0-9a-f]{6}$/i.test(hex) ? `FF${hex.slice(1).toUpperCase()}` : null);

export async function rosterWorkbook(r: PdfRoster, hoursByShift: Map<string, number>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HealthFlow";
  wb.created = new Date();
  const ws = wb.addWorksheet("Roster", { views: [{ state: "frozen", xSplit: 3, ySplit: 5 }], pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const days = new Date(Date.UTC(r.year, r.month, 0)).getUTCDate();
  const iso = (d: number) => `${r.year}-${String(r.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const dow = (d: number) => new Date(Date.UTC(r.year, r.month - 1, d)).getUTCDay();
  const shiftBy = new Map(r.shifts.map((s) => [s.id, s]));
  const firstDay = 4;
  const totalCol = firstDay + days;
  const lastCol = totalCol + 1;

  ws.getCell("A1").value = r.facilityName;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").value = `Duty roster, ${r.title}`;
  ws.getCell("A2").font = { size: 11 };
  ws.getCell("A3").value = `${r.statusWord}, version ${r.version}. Exported ${r.printedOn}.`;
  ws.getCell("A3").font = { size: 9, color: { argb: "FF555555" } };

  const head = ws.getRow(4);
  const sub = ws.getRow(5);
  ["No.", "Name", "Cadre"].forEach((h, i) => {
    head.getCell(i + 1).value = h;
    ws.mergeCells(4, i + 1, 5, i + 1);
  });
  const holidays = new Set(r.holidays ?? []);
  for (let d = 1; d <= days; d++) {
    head.getCell(firstDay + d - 1).value = d;
    sub.getCell(firstDay + d - 1).value = holidays.has(d) ? "PH" : WEEKDAY[dow(d)];
  }
  head.getCell(totalCol).value = "Duties";
  head.getCell(lastCol).value = "Hours";
  ws.mergeCells(4, totalCol, 5, totalCol);
  ws.mergeCells(4, lastCol, 5, lastCol);
  for (const row of [head, sub]) {
    row.font = { bold: true, size: 9 };
    row.alignment = { horizontal: "center", vertical: "middle" };
    row.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9E9E9" } };
      c.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
    });
  }
  for (let d = 1; d <= days; d++) {
    if (dow(d) === 0 || dow(d) === 6 || holidays.has(d)) for (const row of [head, sub]) row.getCell(firstDay + d - 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: holidays.has(d) ? "FFBFBFBF" : "FFD9D9D9" } };
  }

  const dutyShift = new Set(r.shifts.filter((s) => s.countsAsDuty).map((s) => s.id));
  r.staff.forEach((p, i) => {
    const row = ws.getRow(6 + i);
    row.getCell(1).value = p.staffNo;
    row.getCell(2).value = p.name + (r.leads?.has(p.id) ? " *" : "");
    row.getCell(3).value = p.cadre ?? "";
    let hours = 0;
    for (let d = 1; d <= days; d++) {
      const sid = r.cells.get(`${p.id}|${iso(d)}`);
      const s = sid ? shiftBy.get(sid) : undefined;
      const cell = row.getCell(firstDay + d - 1);
      const mark = r.marks?.get(`${p.id}|${iso(d)}`);
      if (mark && (!s || !dutyShift.has(s.id))) {
        cell.value = mark;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDE6CC" } };
        cell.font = { bold: true, size: 9 };
      } else if (s) {
        cell.value = s.code;
        const fill = argb(s.colour);
        if (fill && dutyShift.has(s.id)) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
          cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
        } else cell.font = { color: { argb: "FF666666" }, size: 9 };
        if (dutyShift.has(s.id)) hours += hoursByShift.get(sid!) ?? 0;
      }
      cell.alignment = { horizontal: "center" };
      cell.border = { top: { style: "hair" }, bottom: { style: "hair" }, left: { style: "hair" }, right: { style: "hair" } };
    }
    const from = ws.getCell(6 + i, firstDay).address;
    const to = ws.getCell(6 + i, firstDay + days - 1).address;
    const codes = r.shifts.filter((s) => s.countsAsDuty).map((s) => `COUNTIF(${from}:${to},"${s.code.replace(/"/g, '""')}")`);
    row.getCell(totalCol).value = { formula: codes.length ? codes.join("+") : "0", result: [...Array(days).keys()].filter((d) => dutyShift.has(r.cells.get(`${p.id}|${iso(d + 1)}`) ?? "")).length };
    row.getCell(lastCol).value = Math.round(hours * 10) / 10;
    row.getCell(totalCol).alignment = row.getCell(lastCol).alignment = { horizontal: "center" };
    row.getCell(1).font = row.getCell(3).font = { size: 9 };
    row.getCell(2).font = { size: 10 };
  });

  // Daily counts under the grid, as live formulas: people on each shift, and people off.
  const firstRow = 6;
  const lastRow = 6 + r.staff.length - 1;
  const duty = r.shifts.filter((s) => s.countsAsDuty);
  if (r.staff.length) {
    const rows = [...duty.map((s) => ({ label: s.name, code: s.code })), { label: "Off", code: null as string | null }];
    rows.forEach((x, k) => {
      const row = ws.getRow(lastRow + 2 + k);
      row.getCell(2).value = x.label;
      row.getCell(2).font = { bold: true, size: 9 };
      for (let d = 1; d <= days; d++) {
        const col = ws.getColumn(firstDay + d - 1).letter;
        const range = `${col}${firstRow}:${col}${lastRow}`;
        const cell = row.getCell(firstDay + d - 1);
        if (x.code) cell.value = { formula: `COUNTIF(${range},"${x.code.replace(/"/g, '""')}")` };
        else cell.value = { formula: `${r.staff.length}-${duty.map((s) => `COUNTIF(${range},"${s.code.replace(/"/g, '""')}")`).join("-")}-${[...new Set(r.marks?.values() ?? [])].map((m) => `COUNTIF(${range},"${m}")`).join("-") || "0"}` };
        cell.alignment = { horizontal: "center" };
        cell.font = { size: 9 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F3F3" } };
      }
    });
  }

  ws.getColumn(1).width = 8;
  ws.getColumn(2).width = 28;
  ws.getColumn(3).width = 16;
  for (let d = 0; d < days; d++) ws.getColumn(firstDay + d).width = 4.3;
  ws.getColumn(totalCol).width = 8;
  ws.getColumn(lastCol).width = 8;

  const key = wb.addWorksheet("Key");
  key.addRow(["Code", "Shift", "Time", "Counts as duty"]).font = { bold: true };
  for (const s of r.shifts) key.addRow([s.code, s.name, s.time ?? "", s.countsAsDuty ? "Yes" : "No"]);
  for (const m of r.markLegend ?? []) key.addRow([m.code, m.label, "", "No"]);
  if (holidays.size) key.addRow(["PH", "Public holiday", "", ""]);
  if (r.leads?.size) key.addRow(["*", "Can lead a shift", "", ""]);
  key.addRow([]);
  key.addRow([`Prepared by: ${r.preparedBy ?? ""}`]);
  key.addRow([`Approved by: ${r.approvedBy ?? ""}`]);
  key.columns = [{ width: 8 }, { width: 28 }, { width: 18 }, { width: 16 }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}
