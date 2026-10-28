// The allowance sheet as a workbook the accounts office can open: facility and month at the top,
// one row per person, totals as live formulas, and the signature lines every payment schedule needs.
import ExcelJS from "exceljs";
import type { AllowanceSheet } from "./allowances.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export async function allowanceWorkbook(sheet: AllowanceSheet, facilityName: string, preparedBy: string, printedOn: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HealthFlow";
  wb.created = new Date();
  const ws = wb.addWorksheet("Duty days", { views: [{ state: "frozen", ySplit: 6 }], pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const title = `${MONTHS[sheet.month - 1]} ${sheet.year}${sheet.ward ? `, ${sheet.ward}` : ""}`;
  ws.getCell("A1").value = facilityName;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").value = `Duty days and allowance sheet, ${title}`;
  ws.getCell("A3").value = sheet.final ? "From published or approved rosters." : "DRAFT: some rosters are not yet approved or published. Do not pay from this sheet.";
  ws.getCell("A3").font = { bold: !sheet.final, color: { argb: sheet.final ? "FF555555" : "FFB00020" } };
  ws.getCell("A4").value = `Counts and hours only. Rates and amounts are set by the accounts office. Prepared ${printedOn}.`;
  ws.getCell("A4").font = { size: 9, color: { argb: "FF555555" } };

  const fixed = ["Staff no", "Name", "Cadre", ...(sheet.hasWards ? ["Ward"] : [])];
  const head = [...fixed, "Duty days", ...sheet.shifts.map((s) => s.name), "Nights", "Weekend duties", "Holiday duties", "Hours", "Present", "Late", "Absent", "Excused", "On leave", "Official", "Not recorded"];
  const hr = ws.getRow(6);
  head.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { bold: true };
    c.alignment = { wrapText: true, vertical: "middle", horizontal: i < fixed.length ? "left" : "center" };
    c.border = { bottom: { style: "medium" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEFF2" } };
  });
  hr.height = 32;
  let r = 7;
  for (const p of sheet.rows) {
    const vals: (string | number)[] = [p.staffNo, p.name, p.cadre ?? "", ...(sheet.hasWards ? [p.ward ?? ""] : []), p.duties, ...sheet.shifts.map((s) => p.byShift[s.id] ?? 0), p.nights, p.weekends, p.holidays, p.hours, p.present, p.late, p.absent, p.excused, p.onLeave, p.official, p.unrecorded];
    vals.forEach((v, i) => { ws.getCell(r, i + 1).value = v; if (i >= fixed.length) ws.getCell(r, i + 1).alignment = { horizontal: "center" }; });
    r++;
  }
  const first = 7;
  const last = r - 1;
  ws.getCell(r, 1).value = "Total";
  ws.getCell(r, 1).font = { bold: true };
  for (let i = fixed.length; i < head.length; i++) {
    const col = ws.getColumn(i + 1).letter;
    const c = ws.getCell(r, i + 1);
    c.value = { formula: last >= first ? `SUM(${col}${first}:${col}${last})` : "0" };
    c.font = { bold: true };
    c.alignment = { horizontal: "center" };
    c.border = { top: { style: "thin" } };
  }
  ws.getColumn(1).width = 11;
  ws.getColumn(2).width = 28;
  ws.getColumn(3).width = 22;
  for (let i = 4; i <= head.length; i++) ws.getColumn(i).width = i === 4 && sheet.hasWards ? 22 : 11;
  r += 3;
  for (const line of ["Prepared by (in-charge)", "Checked by (administrator)", "Approved by (head of facility)"]) {
    ws.getCell(r, 2).value = `${line}: ______________________   Date: ____________`;
    r += 2;
  }
  void preparedBy;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
