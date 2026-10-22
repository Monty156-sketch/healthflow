// An invoice as an A4 PDF: the facility's name, the number, the period, the
// amount in cedis, PS Tech's bank details and the payment terms.
import PDFDocument from "pdfkit";
import { plain } from "./rosterPdf.js";

export interface InvoiceDoc {
  number: string;
  facilityName: string;
  issuedAt: Date;
  dueAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  lines: { description: string; amountGhs: number }[];
  totalGhs: number;
  status: string;
  paidAt: Date | null;
  paymentReference: string | null;
  paymentMethod?: string | null;
  /** A receipt is the same document once paid: it says what was received, when and how. */
  receipt?: boolean;
}

const M = 50;
const ghs = (n: number) => `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (d: Date | null) => (d ? `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}` : "");

/** Bank details come from the environment, never from code. Without them the invoice says to ask, rather than inventing any. */
export function bankDetails(): string[] {
  const { BILLING_BANK_NAME: bank, BILLING_ACCOUNT_NAME: name, BILLING_ACCOUNT_NUMBER: no, BILLING_BRANCH: branch } = process.env;
  if (!bank || !name || !no) return ["Bank details are given on request. Contact PS Tech before paying."];
  return [`Bank: ${bank}${branch ? `, ${branch}` : ""}`, `Account name: ${name}`, `Account number: ${no}`];
}

export const paymentTermsDays = () => Number(process.env.BILLING_TERMS_DAYS ?? 30);

export function invoicePdf(d: InvoiceDoc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: M, info: { Title: `${d.receipt ? "Receipt" : "Invoice"} ${d.number}`, Author: "PS Tech" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(20).fillColor("#000").text(d.receipt ? "Receipt" : "Invoice", M, M);
    doc.font("Helvetica").fontSize(10).fillColor("#333").text("PS Tech, provider of HealthFlow", M, M + 26);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#000").text(`Number: ${d.number}`, 360, M, { width: 185, align: "right" });
    doc.font("Helvetica").text(`Issued: ${dmy(d.issuedAt)}`, 360, M + 14, { width: 185, align: "right" });
    if (d.dueAt) doc.text(`Due: ${dmy(d.dueAt)}`, 360, M + 28, { width: 185, align: "right" });
    if (d.status === "PAID") doc.font("Helvetica-Bold").text(`PAID ${dmy(d.paidAt)}`, 360, M + 42, { width: 185, align: "right" });

    doc.font("Helvetica-Bold").fontSize(9).fillColor("#555").text("BILLED TO", M, 130);
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#000").text(plain(d.facilityName), M, 144);
    if (d.periodStart && d.periodEnd) doc.font("Helvetica").fontSize(10).fillColor("#333").text(`Period: ${dmy(d.periodStart)} to ${dmy(d.periodEnd)}`, M, 164);

    let y = 200;
    doc.moveTo(M, y).lineTo(545, y).strokeColor("#999").stroke();
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#555").text("DESCRIPTION", M, y + 6).text("AMOUNT", 400, y + 6, { width: 145, align: "right" });
    y += 22;
    doc.moveTo(M, y).lineTo(545, y).stroke();
    y += 8;
    doc.font("Helvetica").fontSize(10.5).fillColor("#000");
    for (const l of d.lines) {
      doc.text(plain(l.description), M, y, { width: 340 }).text(ghs(l.amountGhs), 400, y, { width: 145, align: "right" });
      y += 20;
    }
    y += 6;
    doc.moveTo(M, y).lineTo(545, y).strokeColor("#999").stroke();
    doc.font("Helvetica-Bold").fontSize(12).text("Total", M, y + 10).text(ghs(d.totalGhs), 400, y + 10, { width: 145, align: "right" });

    y += 60;
    if (d.receipt) {
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#555").text("PAYMENT RECEIVED", M, y);
      doc.font("Helvetica").fontSize(10).fillColor("#000").text(`${ghs(d.totalGhs)} received from ${plain(d.facilityName)} on ${dmy(d.paidAt)} against invoice ${d.number}.`, M, y + 14, { width: 495 });
      doc.text(`Method: ${(d.paymentMethod ?? "other").replace(/_/g, " ").toLowerCase()}`, M, y + 44);
      if (d.paymentReference) doc.text(`Reference: ${plain(d.paymentReference)}`, M, y + 58);
      doc.fontSize(9).fillColor("#555").text("All amounts are in Ghana cedis. This receipt is issued by PS Tech, Wa, Upper West Region.", M, y + 84);
      doc.end();
      return;
    }
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#555").text("HOW TO PAY", M, y);
    doc.font("Helvetica").fontSize(10).fillColor("#000").text(`Payment is due within ${paymentTermsDays()} days of the date of issue. Pay by bank transfer, quoting the invoice number ${d.number}.`, M, y + 14, { width: 495 });
    let by = y + 46;
    for (const line of bankDetails()) { doc.text(plain(line), M, by); by += 14; }
    doc.fontSize(9).fillColor("#555").text("Mobile Money is available on request. All amounts are in Ghana cedis.", M, by + 8);
    doc.end();
  });
}
