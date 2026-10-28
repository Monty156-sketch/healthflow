import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";
import { fairnessFlags } from "../src/lib/reportStats.js";

beforeEach(resetDatabase);

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
  const api = as(admin);
  const nurse = await prisma.cadre.create({ data: { facilityId: facility.id, name: "Nurse", code: "RN", sortOrder: 1 } });
  for (let i = 1; i <= 12; i++) await prisma.staff.create({ data: { facilityId: facility.id, staffNo: `S${String(i).padStart(2, "0")}`, fullName: `Nurse ${i}`, status: "ACTIVE", cadreId: nurse.id } });
  const mk = (code: string, name: string, startTime: string, endTime: string, isOvernight: boolean, minStaff: number) =>
    api.post("/api/facility/shifts", { name, code, startTime, endTime, isOvernight, minStaff, colour: "#25619f" });
  await mk("A", "Morning", "08:00", "14:00", false, 2);
  await mk("N", "Night", "20:00", "08:00", true, 2);
  const now = new Date();
  const roster = (await api.post("/api/facility/rosters", { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 })).body.roster as { id: string };
  await api.post(`/api/facility/rosters/${roster.id}/generate`);
  return { api, facility, month: now.toISOString().slice(0, 7), rosterId: roster.id };
}

describe("duty days and allowance sheet", () => {
  it("counts every duty, nights and hours from the roster, and says when the roster is still a draft", async () => {
    const { api, month, rosterId } = await setup();
    const res = await api.get(`/api/facility/reports/allowances?month=${month}`);
    expect(res.status).toBe(200);
    const sheet = res.body.sheet;
    const stored = await prisma.rosterAssignment.count({ where: { rosterId, shift: { countsAsDuty: true } } });
    expect(sheet.totals.duties).toBe(stored);
    expect(sheet.rows.reduce((n: number, r: { duties: number }) => n + r.duties, 0)).toBe(stored);
    expect(sheet.totals.nights).toBeGreaterThan(0);
    expect(sheet.totals.hours).toBeGreaterThan(0);
    expect(sheet.final).toBe(false);
    expect(sheet.shifts.map((s: { name: string }) => s.name)).toEqual(expect.arrayContaining(["Morning", "Night"]));
    // Nothing has been recorded yet, so every duty is "not recorded".
    expect(sheet.totals.unrecorded).toBe(stored);
  });

  it("sets attendance against the duties", async () => {
    const { api, facility, month, rosterId } = await setup();
    const a = await prisma.rosterAssignment.findFirstOrThrow({ where: { rosterId, shift: { countsAsDuty: true } } });
    await prisma.attendance.create({ data: { facilityId: facility.id, staffId: a.staffId, rosterId, rosterAssignmentId: a.id, dutyDate: a.dutyDate, shiftId: a.shiftId, status: "ABSENT" } });
    const sheet = (await api.get(`/api/facility/reports/allowances?month=${month}`)).body.sheet;
    expect(sheet.totals.absent).toBe(1);
    expect(sheet.rows.find((r: { staffId: string }) => r.staffId === a.staffId).absent).toBe(1);
  });

  it("downloads as a workbook and a CSV, and is closed to ordinary staff", async () => {
    const { api, facility, month } = await setup();
    const xlsx = await api.get(`/api/facility/reports/allowances.xlsx?month=${month}`);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers["content-type"]).toContain("spreadsheetml");
    const csv = await api.get(`/api/facility/reports/allowances.csv?month=${month}`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("Duty days");
    expect(csv.text).toContain("Total");
    expect(await prisma.auditLog.count({ where: { facilityId: facility.id, action: "allowance_sheet_downloaded" } })).toBe(2);
    const { user: staff } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Plain Nurse" } });
    expect((await as(staff).get(`/api/facility/reports/allowances?month=${month}`)).status).toBe(403);
    expect((await api.get(`/api/facility/reports/allowances?month=2019-01`)).body.sheet).toBeNull();
  });
});

describe("fairness flags and longer periods", () => {
  it("flags only people well away from their cadre average, and only in cadres of three or more", () => {
    const means = { nights: 4, weekends: 2, holidays: 1, duties: 20 };
    const person = (o: Partial<Record<"nights" | "weekends" | "holidays" | "duties", number>>) => ({ staffId: "x", name: "X", hours: 0, nights: 4, weekends: 2, holidays: 1, duties: 20, ...o });
    expect(fairnessFlags(person({}), means, 5)).toEqual([]);
    expect(fairnessFlags(person({ nights: 8 }), means, 5)[0]).toMatch(/More night duties/);
    expect(fairnessFlags(person({ nights: 1 }), means, 5)[0]).toMatch(/Fewer night duties/);
    expect(fairnessFlags(person({ nights: 8 }), means, 2)).toEqual([]);
    expect(fairnessFlags(person({ weekends: 3 }), means, 5)).toEqual([]);
  });

  it("takes a six or twelve month period and refuses any other", async () => {
    const { api, month } = await setup();
    expect((await api.get(`/api/facility/reports/fairness?month=${month}&span=6`)).body.span).toBe(6);
    expect((await api.get(`/api/facility/reports/fairness?month=${month}&span=12`)).body.monthsAsked).toBe(12);
    expect((await api.get(`/api/facility/reports/fairness?month=${month}&span=5`)).status).toBe(400);
  });
});
