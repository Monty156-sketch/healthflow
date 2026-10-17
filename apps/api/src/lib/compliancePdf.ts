// The monthly compliance report as an A4 landscape PDF: one line per person,
// the overrides with who approved them and why, and signature lines. It is
// the page a facility head signs and files.
import PDFDocument from "pdfkit";
import { plain } from "./rosterPdf.js";
import type { StaffFigures } from "./reportStats.js";

export interface ComplianceDoc {
  facilityName: string;
  title: string; // "October 2026"
  rosterStatus: string;
  version: number;
  generatedOn: string;
  generatedBy: string;
  rows: StaffFigures[];
  overrides: { rule: string; message: string; staff: string | null; reason: string; approver: string; date: string | null }[];
  summary: { staffAboveNormalWeek: number; restBreaches: number; overridesGranted: number; unfilledShifts: number };
  normalWeek: number;
}

const W = 841.89;
const H = 595.28;
const M = 32;

export function compliancePdf(d: ComplianceDoc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: M, bufferPages: true, info: { Title: `${d.facilityName} compliance report ${d.title}`, Author: "HealthFlow" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#000").text(plain(d.facilityName), M, M);
    doc.font("Helvetica").fontSize(11).fillColor("#333").text(`Compliance report, ${d.title}`, M, M + 20);
    doc.fontSize(8.5).fillColor("#555").text(`Roster ${d.rosterStatus.toLowerCase()}, version ${d.version}. Generated ${dmy(d.generatedOn)} by ${plain(d.generatedBy)}.`, M, M + 36);

    // Summary band
    let y = M + 58;
    const items: [string, number][] = [
      [`Staff above ${d.normalWeek} hours in a week`, d.summary.staffAboveNormalWeek],
      ["Rest breaches", d.summary.restBreaches],
      ["Overrides granted", d.summary.overridesGranted],
      ["Unfilled shifts", d.summary.unfilledShifts],
    ];
    const bw = (W - 2 * M) / items.length;
    items.forEach(([label, n], i) => {
      doc.rect(M + i * bw, y, bw, 38).lineWidth(0.6).strokeColor("#888").stroke();
      doc.font("Helvetica-Bold").fontSize(15).fillColor("#000").text(String(n), M + i * bw + 8, y + 5, { width: bw - 16 });
      doc.font("Helvetica").fontSize(8.5).fillColor("#333").text(label, M + i * bw + 8, y + 24, { width: bw - 16 });
    });
    y += 52;

    const cols: { h: string; w: number; align?: "right" | "left"; get: (r: StaffFigures) => string }[] = [
      { h: "Name", w: 170, get: (r) => plain(r.name) },
      { h: "Cadre", w: 100, get: (r) => plain(r.cadre ?? "") },
      { h: "Hours", w: 54, align: "right", get: (r) => String(r.hours) },
      { h: "Duty days", w: 60, align: "right", get: (r) => String(r.dutyDays) },
      { h: "Nights", w: 50, align: "right", get: (r) => String(r.nights) },
      { h: "Highest week (h)", w: 90, align: "right", get: (r) => String(r.highestWeekHours) },
      { h: `Hours over ${d.normalWeek}/wk`, w: 90, align: "right", get: (r) => String(r.hoursAboveNormal) },
      { h: "Longest rest (h)", w: 80, align: "right", get: (r) => (r.longestRestHours === null ? "n/a" : String(r.longestRestHours)) },
      { h: "Rest breaches", w: 68, align: "right", get: (r) => String(r.restBreaches) },
    ];
    const rowH = 15;
    const headRow = () => {
      doc.rect(M, y, cols.reduce((n, c) => n + c.w, 0), 18).fillAndStroke("#e9e9e9", "#000");
      let x = M;
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#000");
      for (const c of cols) {
        doc.text(c.h, x + 4, y + 5, { width: c.w - 8, align: c.align ?? "left", lineBreak: false });
        x += c.w;
      }
      y += 18;
    };
    headRow();
    for (const r of d.rows) {
      if (y + rowH > H - M - 24) {
        doc.addPage();
        y = M;
        headRow();
      }
      let x = M;
      doc.font("Helvetica").fontSize(8.5).fillColor(r.highestWeekHours > d.normalWeek || r.restBreaches > 0 ? "#7a1f1f" : "#000");
      for (const c of cols) {
        doc.text(c.get(r), x + 4, y + 4, { width: c.w - 8, align: c.align ?? "left", lineBreak: false });
        x += c.w;
      }
      doc.moveTo(M, y + rowH).lineTo(M + cols.reduce((n, c) => n + c.w, 0), y + rowH).lineWidth(0.3).strokeColor("#bbb").stroke();
      y += rowH;
    }
    y += 14;

    // Overrides
    const need = 40 + Math.max(1, d.overrides.length) * 24;
    if (y + need > H - M - 110) {
      doc.addPage();
      y = M;
    }
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#000").text("Overrides", M, y);
    y += 16;
    if (d.overrides.length === 0) {
      doc.font("Helvetica").fontSize(9).fillColor("#333").text("No rule was overridden in this roster.", M, y);
      y += 16;
    } else {
      for (const o of d.overrides) {
        if (y + 26 > H - M - 110) {
          doc.addPage();
          y = M;
        }
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#000").text(`${o.rule}${o.staff ? `, ${plain(o.staff)}` : ""}`, M, y, { continued: true });
        doc.font("Helvetica").text(`  ${plain(o.message)}`);
        doc.fontSize(8.5).fillColor("#333").text(`Reason: ${plain(o.reason)}. Approved by ${plain(o.approver)}${o.date ? ` on ${dmy(o.date)}` : ""}.`, M + 10, doc.y, { width: W - 2 * M - 10 });
        y = doc.y + 6;
      }
    }

    // Signatures and the note, kept together at the foot of the last page
    if (y > H - M - 100) {
      doc.addPage();
      y = M;
    }
    const sy = H - M - 78;
    doc.lineWidth(0.6).strokeColor("#000");
    for (const [i, label] of ["Prepared by", "Facility head"].entries()) {
      const x = M + i * 300;
      doc.moveTo(x, sy).lineTo(x + 240, sy).stroke();
      doc.font("Helvetica").fontSize(8.5).fillColor("#000").text(`${label}: name, signature and date`, x, sy + 4, { width: 240 });
    }
    doc.font("Helvetica").fontSize(7).fillColor("#666").text(
      "Hours and rest are computed from the roster against limits set for this facility, which are drawn from published summaries of the Labour Act 2003 (Act 651) and should be confirmed with a qualified labour law practitioner. This report is not legal advice. Limits shown: normal week " +
        `${d.normalWeek} hours.`,
      M, H - M - 36, { width: W - 2 * M },
    );
    doc.end();
  });
}
