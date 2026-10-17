// The roster as an A4 landscape sheet that looks like the paper one: facility
// and month at the top, one row per person, one column per day, a shift-code
// legend, and signature lines for Prepared by and Approved by.
// Built with the PDF library's own Helvetica, so no font files are needed.
import PDFDocument from "pdfkit";

export interface PdfRoster {
  facilityName: string;
  place: string | null; // e.g. "Health Centre, Nadowli-Kaleo, Upper West"
  title: string; // "October 2026"
  statusWord: string;
  version: number;
  year: number;
  month: number;
  staff: { id: string; name: string; staffNo: string; cadre: string | null }[];
  shifts: { id: string; code: string; name: string; time: string | null; colour: string | null; countsAsDuty: boolean }[];
  /** staffId|YYYY-MM-DD -> shift id */
  cells: Map<string, string>;
  preparedBy: string | null;
  approvedBy: string | null;
  blocking: number;
  warnings: number;
  overrides: number;
  printedOn: string;
}

const W = 841.89;
const H = 595.28;
const M = 28;
const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

/** The built-in font covers Latin-1; map the Ghanaian letters it lacks to the nearest ones. */
export function plain(s: string): string {
  return s
    .replace(/ɛ/g, "e").replace(/Ɛ/g, "E").replace(/ɔ/g, "o").replace(/Ɔ/g, "O").replace(/ŋ/g, "ng").replace(/Ŋ/g, "Ng")
    .replace(/[^ -~ -ÿ]/g, "");
}

function hexToRgb(hex: string | null): [number, number, number] | null {
  const m = hex && /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rosterPdf(r: PdfRoster): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: M, bufferPages: true, info: { Title: `${r.facilityName} duty roster ${r.title}`, Author: "HealthFlow" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const days = new Date(Date.UTC(r.year, r.month, 0)).getUTCDate();
    const iso = (d: number) => `${r.year}-${String(r.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dow = (d: number) => new Date(Date.UTC(r.year, r.month - 1, d)).getUTCDay();
    const shiftBy = new Map(r.shifts.map((s) => [s.id, s]));

    const noW = 22;
    const nameW = 150;
    const cadreW = 62;
    const totalW = 30;
    const dayW = (W - 2 * M - noW - nameW - cadreW - totalW) / days;
    const rowH = 15;
    const headH = 26;
    const footerReserve = 112; // legend and signatures on the last page
    const left = M;

    const header = () => {
      doc.fillColor("#000").font("Helvetica-Bold").fontSize(15).text(plain(r.facilityName), M, M - 4, { width: W - 2 * M - 200 });
      doc.font("Helvetica").fontSize(10).fillColor("#333").text(`Duty roster, ${r.title}`, M, M + 15, { width: W - 2 * M - 200 });
      if (r.place) doc.fontSize(8.5).fillColor("#555").text(plain(r.place), M, M + 29, { width: W - 2 * M - 200 });
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#000").text(`${r.statusWord}, version ${r.version}`, W - M - 200, M - 2, { width: 200, align: "right" });
      doc.font("Helvetica").fontSize(8.5).fillColor("#555").text(`Printed ${r.printedOn}`, W - M - 200, M + 11, { width: 200, align: "right" });
      return M + 46;
    };

    const gridHead = (y: number) => {
      doc.lineWidth(0.6).strokeColor("#000");
      doc.rect(left, y, W - 2 * M, headH).fillAndStroke("#e9e9e9", "#000");
      doc.fillColor("#000").font("Helvetica-Bold").fontSize(7.5);
      doc.text("No.", left + 2, y + 9, { width: noW - 4 });
      doc.text("Name", left + noW + 3, y + 9, { width: nameW - 6 });
      doc.text("Cadre", left + noW + nameW + 3, y + 9, { width: cadreW - 6 });
      for (let d = 1; d <= days; d++) {
        const x = left + noW + nameW + cadreW + (d - 1) * dayW;
        const weekend = dow(d) === 0 || dow(d) === 6;
        if (weekend) doc.rect(x, y, dayW, headH).fillAndStroke("#cfcfcf", "#000");
        doc.fillColor("#000").font("Helvetica-Bold").fontSize(7).text(String(d), x, y + 4, { width: dayW, align: "center" });
        doc.font("Helvetica").fontSize(6).text(WEEKDAY[dow(d)], x, y + 15, { width: dayW, align: "center" });
      }
      doc.font("Helvetica-Bold").fontSize(7.5).text("Duties", left + W - 2 * M - totalW, y + 9, { width: totalW, align: "center" });
      return y + headH;
    };

    let y = gridHead(header());
    r.staff.forEach((p, i) => {
      if (y + rowH > H - M - (i === r.staff.length - 1 ? footerReserve : 22)) {
        doc.addPage();
        y = gridHead(header());
      }
      doc.lineWidth(0.4).strokeColor("#444");
      doc.rect(left, y, W - 2 * M, rowH).stroke();
      doc.fillColor("#000").font("Helvetica").fontSize(7.5);
      doc.text(String(i + 1), left + 2, y + 4.5, { width: noW - 4, lineBreak: false });
      doc.font("Helvetica-Bold").text(plain(p.name), left + noW + 3, y + 4.5, { width: nameW - 6, lineBreak: false, ellipsis: true });
      doc.font("Helvetica").fontSize(7).text(plain(p.cadre ?? ""), left + noW + nameW + 3, y + 4.5, { width: cadreW - 6, lineBreak: false, ellipsis: true });
      let duties = 0;
      for (let d = 1; d <= days; d++) {
        const x = left + noW + nameW + cadreW + (d - 1) * dayW;
        const wk = dow(d) === 0 || dow(d) === 6;
        const s = shiftBy.get(r.cells.get(`${p.id}|${iso(d)}`) ?? "");
        if (s) {
          const rgb = hexToRgb(s.colour);
          if (s.countsAsDuty && rgb) doc.save().rect(x, y, dayW, rowH).fillOpacity(0.18).fill(rgb).restore();
          else if (wk) doc.save().rect(x, y, dayW, rowH).fillOpacity(0.5).fill("#dddddd").restore();
          if (s.countsAsDuty) duties++;
          doc.fillColor(s.countsAsDuty ? "#000" : "#666").font(s.countsAsDuty ? "Helvetica-Bold" : "Helvetica").fontSize(s.code.length > 2 ? 5.5 : 7.5);
          doc.text(plain(s.code), x, y + 4.5, { width: dayW, align: "center", lineBreak: false });
        } else if (wk) {
          doc.save().rect(x, y, dayW, rowH).fillOpacity(0.5).fill("#dddddd").restore();
        }
        doc.lineWidth(0.25).strokeColor("#999").moveTo(x, y).lineTo(x, y + rowH).stroke();
      }
      doc.fillColor("#000").font("Helvetica-Bold").fontSize(7.5).text(String(duties), left + W - 2 * M - totalW, y + 4.5, { width: totalW, align: "center", lineBreak: false });
      y += rowH;
    });
    if (r.staff.length === 0) doc.fillColor("#555").font("Helvetica").fontSize(10).text("No staff on this roster yet.", left, y + 10);

    // Legend, then the signatures, always together on the last page.
    y += 12;
    if (y + footerReserve - 12 > H - M) {
      doc.addPage();
      y = header();
    }
    doc.fillColor("#000").font("Helvetica-Bold").fontSize(8).text("Shift codes", left, y);
    let lx = left;
    let ly = y + 12;
    doc.font("Helvetica").fontSize(7.5);
    for (const s of r.shifts) {
      const label = `${plain(s.code)} = ${plain(s.name)}${s.time ? ` (${s.time})` : ""}`;
      const w = doc.widthOfString(label) + 18;
      if (lx + w > W - M) {
        lx = left;
        ly += 11;
      }
      doc.text(label, lx, ly, { lineBreak: false });
      lx += w + 8;
    }

    const sy = Math.min(ly + 30, H - M - 52);
    const sigW = 230;
    const sig = (x: number, label: string, name: string | null) => {
      doc.lineWidth(0.6).strokeColor("#000").moveTo(x, sy + 16).lineTo(x + sigW, sy + 16).stroke();
      doc.fillColor("#000").font("Helvetica-Bold").fontSize(8).text(label, x, sy + 20);
      if (name) doc.font("Helvetica").fontSize(8).text(plain(name), x, sy + 31, { width: sigW });
      doc.font("Helvetica").fontSize(7).fillColor("#555").text("Signature and date", x, sy + (name ? 42 : 31));
    };
    sig(left, "Prepared by", r.preparedBy);
    sig(left + sigW + 60, "Approved by", r.approvedBy);

    const summary = `${r.blocking} blocking ${r.blocking === 1 ? "finding" : "findings"}, ${r.warnings} ${r.warnings === 1 ? "warning" : "warnings"}, ${r.overrides} ${r.overrides === 1 ? "override" : "overrides"} with a recorded reason.`;
    doc.font("Helvetica").fontSize(7).fillColor("#555").text(summary, W - M - 250, sy + 2, { width: 250, align: "right" });
    doc.text("Hours and rest are checked against limits the facility sets, drawn from the Labour Act 2003 (Act 651). Confirm them with a qualified labour law practitioner.", W - M - 250, sy + 20, { width: 250, align: "right" });

    // Page numbers once the page count is known.
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font("Helvetica").fontSize(7).fillColor("#555").text(`Page ${i + 1} of ${range.count}`, M, H - M - 9, { width: W - 2 * M, align: "center", lineBreak: false });
    }
    doc.end();
  });
}
