import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

const at = (d: number) => new Date(Date.UTC(2026, 2, d));

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id });
  const api = as(admin);
  const morning = (await api.post("/api/facility/shifts", { name: "Morning", code: "A", startTime: "08:00", endTime: "14:00", isOvernight: false, minStaff: 1, colour: "#25619f" })).body.shift;
  const night = (await api.post("/api/facility/shifts", { name: "Night", code: "N", startTime: "20:00", endTime: "08:00", isOvernight: true, minStaff: 1, colour: "#463a85" })).body.shift;
  const cadre = await prisma.cadre.create({ data: { facilityId: facility.id, name: "Midwife", code: "MW", sortOrder: 1 } });
  const people: Awaited<ReturnType<typeof prisma.staff.create>>[] = [];
  for (const n of ["Ama Dery", "Esi Naa", "Yaw Boah"]) people.push(await prisma.staff.create({ data: { facilityId: facility.id, staffNo: n, fullName: n, status: "ACTIVE", cadreId: cadre.id } }));
  const roster = await prisma.roster.create({ data: { facilityId: facility.id, month: 3, year: 2026, status: "PUBLISHED" } });
  const mk = (i: number, shiftId: string, day: number) => prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId: facility.id, staffId: people[i].id, shiftId, dutyDate: at(day) } });
  for (const d of [2, 3, 4]) await mk(0, morning.id, d);
  await mk(0, night.id, 10);
  await mk(1, morning.id, 2);
  await mk(1, night.id, 11);
  await mk(1, night.id, 12);
  const login = async (staffId: string) => {
    const { user } = await makeUser({ role: "STAFF", facilityId: facility.id });
    await prisma.userProfile.update({ where: { id: user.id }, data: { staffId } });
    return as(user);
  };
  return { facility, api, people, roster, login };
}

describe("compliance report", () => {
  it("adds up hours, duty days and nights from the roster, and lists overrides with who approved them", async () => {
    const { api, people, roster } = await setup();
    await prisma.complianceFinding.create({
      data: { rosterId: roster.id, facilityId: roster.facilityId, staffId: people[0].id, ruleCode: "C5", severity: "BLOCK", message: "Less than 11 hours between shifts", status: "OVERRIDDEN", overrideReason: "Ward was short after a bereavement", overrideBy: "kofi@example.com", overrideAt: new Date("2026-03-09") },
    });
    const r = (await api.get("/api/facility/reports/compliance?month=2026-03")).body;
    const ama = r.rows.find((x: { name: string }) => x.name === "Ama Dery");
    expect(ama).toMatchObject({ hours: 30, dutyDays: 4, nights: 1, highestWeekHours: 18, hoursAboveNormal: 0 });
    const esi = r.rows.find((x: { name: string }) => x.name === "Esi Naa");
    expect(esi).toMatchObject({ hours: 30, dutyDays: 3, nights: 2 });
    expect(r.summary).toMatchObject({ overridesGranted: 1, staffAboveNormalWeek: 0 });
    expect(r.overrides[0]).toMatchObject({ rule: "C5", staff: "Ama Dery", approver: "kofi@example.com", date: "2026-03-09" });
  });

  it("flags more than 40 hours in a week", async () => {
    const { api, people, roster, facility } = await setup();
    const night = await prisma.shift.findFirstOrThrow({ where: { facilityId: facility.id, code: "N" } });
    for (const d of [5, 6, 7]) await prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId: facility.id, staffId: people[2].id, shiftId: night.id, dutyDate: at(d) } });
    for (const d of [2, 3]) await prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId: facility.id, staffId: people[2].id, shiftId: night.id, dutyDate: at(d) } });
    const r = (await api.get("/api/facility/reports/compliance?month=2026-03")).body;
    const yaw = r.rows.find((x: { name: string }) => x.name === "Yaw Boah");
    expect(yaw.highestWeekHours).toBeGreaterThan(40);
    expect(yaw.hoursAboveNormal).toBeGreaterThan(0);
    expect(r.summary.staffAboveNormalWeek).toBe(1);
  });

  it("downloads as a PDF and a CSV, and says so when there is no roster", async () => {
    const { api } = await setup();
    const pdf = await api.get("/api/facility/reports/compliance.pdf?month=2026-03");
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(/pdf/);
    const csv = await api.get("/api/facility/reports/compliance.csv?month=2026-03");
    expect(csv.text).toMatch(/Ama Dery/);
    expect(csv.text).toMatch(/Overrides/);
    expect((await api.get("/api/facility/reports/compliance.pdf?month=2025-01")).status).toBe(404);
    expect((await api.get("/api/facility/reports/compliance?month=2025-01")).body.roster).toBeNull();
  });

  it("is closed to staff", async () => {
    const { people, login } = await setup();
    const ama = await login(people[0].id);
    expect((await ama.get("/api/facility/reports/compliance?month=2026-03")).status).toBe(403);
    expect((await ama.get("/api/facility/reports/compliance.csv?month=2026-03")).status).toBe(403);
  });
});

describe("fairness report", () => {
  it("shows managers every cadre member against the mean, most loaded first, with a night-duty sentence", async () => {
    const { api } = await setup();
    const r = (await api.get("/api/facility/reports/fairness?month=2026-03")).body;
    expect(r.manager).toBe(true);
    expect(r.monthsCovered).toBe(1);
    const mw = r.cadres.find((c: { cadre: string }) => c.cadre === "Midwife");
    expect(mw.people.map((p: { name: string }) => p.name)).toEqual(["Ama Dery", "Esi Naa", "Yaw Boah"]);
    expect(mw.means.duties).toBe(2.3);
    expect(mw.sentence).toBe("Night duties among midwives range from 0 to 2 over these three months, against an average of 1.");
  });

  it("shows staff only themselves against the cadre average, with no colleague named", async () => {
    const { people, login } = await setup();
    const yaw = await login(people[2].id);
    const r = (await yaw.get("/api/facility/reports/fairness?month=2026-03")).body;
    expect(r.manager).toBe(false);
    expect(r.mine.me).toMatchObject({ duties: 0, nights: 0 });
    expect(r.mine.means.duties).toBe(2.3);
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/Ama Dery|Esi Naa/);
    expect((await yaw.get("/api/facility/reports/fairness.csv?month=2026-03")).status).toBe(403);
  });
});

describe("Excel export", () => {
  it("downloads a workbook at any status, with duty totals", async () => {
    const { api, roster } = await setup();
    await prisma.roster.update({ where: { id: roster.id }, data: { status: "DRAFT" } });
    const r = await api.get(`/api/facility/rosters/${roster.id}/excel`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/spreadsheetml/);
    expect((r.body as Buffer).subarray(0, 2).toString()).toBe("PK");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body as never);
    const ws = wb.getWorksheet("Roster")!;
    const row = ws.getRow(6);
    expect(row.getCell(2).value).toBe("Ama Dery");
    expect(row.getCell(4 + 1).value).toBe("A"); // 2 March
    const total = row.getCell(4 + 31).value as { result: number };
    expect(total.result).toBe(4);
  });
});
