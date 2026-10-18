// Bulk staff import: template, column mapping, a preview that lists every
// failing row and why, import of the valid rows only, and a result report.
// Staff are matched on staff number, so importing again updates rather than
// duplicates.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { allowRoles, caller, ADMIN_ROLES } from "../../middleware/facilityAccess.js";
import { parseCsv } from "../../lib/csv.js";

export const staffImportRouter = Router();
staffImportRouter.use(allowRoles(...ADMIN_ROLES));

export const FIELDS = ["staffNo", "fullName", "cadre", "department", "position", "employmentStatus", "phone", "email", "dateJoined"] as const;
type Field = (typeof FIELDS)[number];

const LABEL: Record<Field, string> = { staffNo: "Staff number", fullName: "Full name", cadre: "Cadre", department: "Department", position: "Position", employmentStatus: "Employment type", phone: "Telephone", email: "Email", dateJoined: "Date joined" };
const SYNONYMS: Record<Field, string[]> = {
  staffNo: ["staffno", "staffnumber", "staffid", "employeeno", "payrollno", "no", "number"],
  fullName: ["fullname", "name", "staffname", "employeename"],
  cadre: ["cadre", "grade", "profession", "rank"],
  department: ["department", "dept", "unit", "ward"],
  position: ["position", "title", "jobtitle", "designation"],
  employmentStatus: ["employmenttype", "employmentstatus", "type", "contract"],
  phone: ["phone", "telephone", "mobile", "phonenumber", "contact"],
  email: ["email", "emailaddress"],
  dateJoined: ["datejoined", "joined", "startdate", "dateofappointment", "appointed"],
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const EMPLOYMENT: Record<string, string> = { permanent: "PERMANENT", contract: "CONTRACT", nationalservice: "NATIONAL_SERVICE", nss: "NATIONAL_SERVICE", locum: "LOCUM" };

staffImportRouter.get("/template.csv", (_req, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="staff-import-template.csv"');
  res.send(`${FIELDS.map((f) => LABEL[f]).join(",")}\nGHS-0001,Ama Mensah,Midwife,Maternity,Senior Midwife,Permanent,0244000000,ama@example.com,2019-03-01\n`);
});

function detect(headers: string[]): Partial<Record<Field, number>> {
  const map: Partial<Record<Field, number>> = {};
  headers.forEach((h, i) => {
    const n = norm(h);
    for (const f of FIELDS) if (map[f] === undefined && (n === norm(LABEL[f]) || SYNONYMS[f].includes(n))) { map[f] = i; break; }
  });
  return map;
}

const bodySchema = z.object({
  csv: z.string().min(1, "Choose a file or paste the rows.").max(2_000_000, "That file is too large. Split it into smaller files."),
  mapping: z.record(z.string(), z.number().int().min(0)).optional(),
});

interface Judged { row: number; staffNo: string; fullName: string; action: "create" | "update" | "error"; problems: string[]; data?: Record<string, unknown> }

/** Names people commonly write for the standard cadres and departments, so a spreadsheet does not need retyping. */
const CADRE_ALIAS: Record<string, string> = {
  "staff nurse": "nurse", "registered nurse": "nurse", "general nurse": "nurse", "rn": "nurse", "rgn": "nurse", "senior nursing officer": "nurse", "nursing officer": "nurse",
  "ena": "enrolled nurse", "enrolled nursing": "enrolled nurse", "chn": "community health nurse", "cho": "community health officer",
  "pa": "physician assistant", "medical assistant": "physician assistant", "doctor": "medical officer", "mo": "medical officer",
  "lab scientist": "laboratory scientist", "laboratory technologist": "laboratory scientist", "lab technologist": "laboratory scientist", "lab technician": "laboratory technician",
  "dispensing technician": "pharmacy technician", "pharmacy tech": "pharmacy technician", "dispenser": "pharmacy technician",
  "records officer": "health information officer", "health records officer": "health information officer", "hio": "health information officer",
};
const DEPT_ALIAS: Record<string, string> = {
  "opd": "outpatient", "out patient": "outpatient", "out-patient": "outpatient", "outpatients": "outpatient", "labour ward": "maternity", "delivery": "maternity", "delivery ward": "maternity",
  "antenatal": "antenatal and postnatal", "anc": "antenatal and postnatal", "postnatal": "antenatal and postnatal", "cwc": "child welfare", "child welfare clinic": "child welfare",
  "lab": "laboratory", "admin": "administration", "a&e": "emergency", "casualty": "emergency", "ot": "theatre", "operating theatre": "theatre", "icu": "intensive care",
  "x-ray": "radiology", "xray": "radiology", "finance": "accounts", "paediatric": "paediatrics", "pediatrics": "paediatrics", "children's ward": "paediatrics",
};
const clean = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();

async function judge(facilityId: string, csv: string, given?: Record<string, number>) {
  const table = parseCsv(csv);
  if (table.length < 2) return { error: "The file needs a heading row and at least one person." } as const;
  const headers = table[0].map((h) => h.trim());
  const mapping = { ...detect(headers), ...(given as Partial<Record<Field, number>> | undefined) };
  const [cadres, departments, existing] = await Promise.all([
    prisma.cadre.findMany({ where: { facilityId, active: true }, select: { id: true, name: true } }),
    prisma.department.findMany({ where: { facilityId, active: true }, select: { id: true, name: true } }),
    prisma.staff.findMany({ where: { facilityId }, select: { id: true, staffNo: true } }),
  ]);
  const byNo = new Map(existing.map((s) => [s.staffNo.toLowerCase(), s.id]));
  const cadreBy = new Map(cadres.map((c) => [c.name.toLowerCase(), c.id]));
  const deptBy = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]));
  const seen = new Set<string>();
  const out: Judged[] = [];
  if (mapping.staffNo === undefined || mapping.fullName === undefined) return { error: "Staff number and full name columns are needed. Match them to your columns below.", headers, mapping } as const;
  table.slice(1).forEach((r, i) => {
    const get = (f: Field) => (mapping[f] === undefined ? "" : (r[mapping[f]!] ?? "").trim());
    const problems: string[] = [];
    const staffNo = get("staffNo");
    const fullName = get("fullName");
    if (!staffNo) problems.push("No staff number.");
    if (!fullName) problems.push("No name.");
    if (staffNo && seen.has(staffNo.toLowerCase())) problems.push("This staff number appears twice in the file.");
    seen.add(staffNo.toLowerCase());
    const data: Record<string, unknown> = { staffNo, fullName };
    const cad = get("cadre");
    if (cad) { const id = cadreBy.get(clean(cad)) ?? cadreBy.get(CADRE_ALIAS[clean(cad)] ?? ""); if (id) data.cadreId = id; else problems.push(`Cadre "${cad}" is not one of your cadres.`); }
    const dep = get("department");
    if (dep) { const id = deptBy.get(clean(dep)) ?? deptBy.get(DEPT_ALIAS[clean(dep)] ?? ""); if (id) data.departmentId = id; else problems.push(`Department "${dep}" is not one of your departments.`); }
    const emp = get("employmentStatus");
    if (emp) { const e = EMPLOYMENT[norm(emp)]; if (e) data.employmentStatus = e; else problems.push(`Employment type "${emp}" should be Permanent, Contract, National Service or Locum.`); }
    const email = get("email");
    if (email) { if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) data.email = email; else problems.push(`"${email}" is not an email address.`); }
    const phone = get("phone");
    if (phone) { if (/^[+\d][\d\s-]{6,17}$/.test(phone)) data.phone = phone; else problems.push(`"${phone}" is not a telephone number.`); }
    const pos = get("position");
    if (pos) data.position = pos;
    const dj = get("dateJoined");
    if (dj) { const d = new Date(`${dj}T00:00:00Z`); if (/^\d{4}-\d{2}-\d{2}$/.test(dj) && !Number.isNaN(d.getTime())) data.dateJoined = d; else problems.push(`Date joined "${dj}" should look like 2019-03-01.`); }
    const found = byNo.get(staffNo.toLowerCase());
    out.push({ row: i + 2, staffNo, fullName, action: problems.length ? "error" : found ? "update" : "create", problems, data: problems.length ? undefined : data });
  });
  return { headers, mapping, rows: out } as const;
}

staffImportRouter.post("/preview", async (req, res) => {
  const who = caller(req);
  const input = parseOr400(bodySchema, req.body, res);
  if (!input) return;
  const j = await judge(who.facilityId, input.csv, input.mapping);
  if ("error" in j) return res.status(400).json({ error: "invalid_input", message: j.error, headers: "headers" in j ? j.headers : undefined, mapping: "mapping" in j ? j.mapping : undefined, fields: FIELDS.map((f) => ({ key: f, label: LABEL[f] })) });
  const count = (a: string) => j.rows.filter((r) => r.action === a).length;
  res.json({ headers: j.headers, mapping: j.mapping, fields: FIELDS.map((f) => ({ key: f, label: LABEL[f] })), rows: j.rows.map(({ data: _d, ...r }) => r), totals: { create: count("create"), update: count("update"), error: count("error") } });
});

staffImportRouter.post("/commit", async (req, res) => {
  const who = caller(req);
  const input = parseOr400(bodySchema, req.body, res);
  if (!input) return;
  const j = await judge(who.facilityId, input.csv, input.mapping);
  if ("error" in j) return res.status(400).json({ error: "invalid_input", message: j.error });
  let created = 0, updated = 0;
  for (const r of j.rows) {
    if (r.action === "error" || !r.data) continue;
    const { staffNo, ...rest } = r.data as { staffNo: string } & Record<string, unknown>;
    const prior = await prisma.staff.findFirst({ where: { facilityId: who.facilityId, staffNo: { equals: staffNo, mode: "insensitive" } }, select: { id: true } });
    if (prior) { await prisma.staff.update({ where: { id: prior.id }, data: rest }); updated++; }
    else { await prisma.staff.create({ data: { facilityId: who.facilityId, staffNo, status: "ACTIVE", ...(rest as { fullName: string }) } }); created++; }
  }
  const skipped = j.rows.filter((r) => r.action === "error").map((r) => ({ row: r.row, staffNo: r.staffNo, problems: r.problems }));
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "staff_imported", entityType: "Staff", summary: `${who.displayName} imported staff from a file: ${created} added, ${updated} updated, ${skipped.length} skipped.` });
  res.json({ created, updated, skipped });
});
