import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

async function setup() {
  const district = await prisma.district.create({ data: { name: "Wa West", region: "Upper West" } });
  const granted = await makeFacility("Granted Clinic");
  const hidden = await makeFacility("Hidden Clinic");
  await prisma.facility.updateMany({ where: { id: { in: [granted.id, hidden.id] } }, data: { districtId: district.id } });
  const officer = await prisma.userProfile.create({ data: { userEmail: "dho@example.test", passwordHash: "x", role: "DISTRICT_OFFICER", scopeType: "DISTRICT", scopeId: district.id } });
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: granted.id, withStaff: { fullName: "Ama Admin" } });
  return { district, granted, hidden, officer, admin };
}

describe("what a district can see", () => {
  it("sees nothing until a facility grants access, and never sees an ungranted facility", async () => {
    const { officer, granted, hidden, admin } = await setup();
    const api = as(officer);
    expect((await api.get("/api/district/coverage")).body.facilities).toHaveLength(0);
    await as(admin).put("/api/facility/directorate", { scopes: ["COVERAGE"] });
    const body = (await api.get("/api/district/coverage")).body;
    expect(body.facilities.map((f: { name: string }) => f.name)).toEqual([granted.name]);
    expect(JSON.stringify(body)).not.toContain(hidden.name);
  });

  it("limits each screen to the scopes granted", async () => {
    const { officer, admin } = await setup();
    await as(admin).put("/api/facility/directorate", { scopes: ["COVERAGE"] });
    const api = as(officer);
    expect((await api.get("/api/district/establishment")).body.facilities).toHaveLength(0);
    expect((await api.get("/api/district/leave-concentration")).body.weeks[0].cadres).toHaveLength(0);
  });

  it("stops the moment the facility withdraws", async () => {
    const { officer, admin } = await setup();
    await as(admin).put("/api/facility/directorate", { scopes: ["COVERAGE", "STAFFING"] });
    expect((await as(officer).get("/api/district/coverage")).body.facilities).toHaveLength(1);
    expect((await as(admin).post("/api/facility/directorate/withdraw", {})).status).toBe(200);
    expect((await as(officer).get("/api/district/coverage")).body.facilities).toHaveLength(0);
  });

  it("writes one entry to the facility's own audit log for every read", async () => {
    const { officer, admin, granted } = await setup();
    await as(admin).put("/api/facility/directorate", { scopes: ["COVERAGE"] });
    await as(officer).get("/api/district/coverage");
    const rows = await prisma.auditLog.findMany({ where: { facilityId: granted.id, action: "district_read" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toContain("dho@example.test");
    const log = (await as(admin).get("/api/facility/directorate")).body;
    expect(log.log.length).toBeGreaterThan(0);
  });

  it("is read only, and closed to everyone but district officers", async () => {
    const { officer, admin } = await setup();
    expect((await as(officer).post("/api/district/coverage", {})).status).toBe(405);
    expect((await as(admin).get("/api/district/coverage")).status).toBe(403);
    expect((await as(officer).get("/api/facility/directorate")).status).toBeGreaterThanOrEqual(400);
  });

  it("leaves out a cadre of fewer than three, and never shows names or leave types", async () => {
    const { officer, admin, granted } = await setup();
    await as(admin).put("/api/facility/directorate", { scopes: ["STAFFING"] });
    const big = await prisma.cadre.create({ data: { facilityId: granted.id, name: "Nurse" } });
    const small = await prisma.cadre.create({ data: { facilityId: granted.id, name: "Pharmacist" } });
    const lt = await prisma.leaveType.create({ data: { facilityId: granted.id, name: "Sick", code: "SK" } });
    const nurses = await Promise.all([1, 2, 3, 4].map((i) => prisma.staff.create({ data: { facilityId: granted.id, staffNo: `N${i}`, fullName: `Nurse Person${i}`, cadreId: big.id, status: "ACTIVE" } })));
    const pharm = await prisma.staff.create({ data: { facilityId: granted.id, staffNo: "P1", fullName: "Lone Pharmacist", cadreId: small.id, status: "ACTIVE" } });
    const start = new Date(); const end = new Date(Date.now() + 86_400_000);
    for (const s of [nurses[0], nurses[1], pharm]) await prisma.leaveRequest.create({ data: { facilityId: granted.id, staffId: s.id, leaveTypeId: lt.id, startDate: start, endDate: end, status: "APPROVED" } });
    const text = JSON.stringify((await as(officer).get("/api/district/leave-concentration")).body);
    expect(text).toContain("Nurse");
    expect(text).not.toContain("Pharmacist");
    expect(text).not.toContain("Person1");
    expect(text).not.toContain("Sick");
    const week = JSON.parse(text).weeks[0].cadres[0];
    expect(week).toMatchObject({ away: 2, total: 4, concern: true });
  });

  it("builds a report pack as JSON and CSV from the granted scopes only", async () => {
    const { officer, admin } = await setup();
    await as(admin).put("/api/facility/directorate", { scopes: ["COVERAGE"] });
    const pack = (await as(officer).get("/api/district/report-pack")).body;
    expect(pack.sections.coverage).toHaveLength(1);
    expect(pack.sections.establishment).toHaveLength(0);
    const csv = await as(officer).get("/api/district/report-pack.csv");
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
  });
});

describe("establishment", () => {
  it("shows approved against filled and the vacancies", async () => {
    const { officer, admin, granted } = await setup();
    const c = await prisma.cadre.create({ data: { facilityId: granted.id, name: "Midwife" } });
    await prisma.staff.create({ data: { facilityId: granted.id, staffNo: "M1", fullName: "M One", cadreId: c.id, status: "ACTIVE" } });
    expect((await as(admin).put("/api/facility/directorate/establishment", { posts: [{ cadreId: c.id, approvedCount: 3 }] })).status).toBe(200);
    await as(admin).put("/api/facility/directorate", { scopes: ["STAFFING"] });
    const row = (await as(officer).get("/api/district/establishment")).body.facilities[0].cadres[0];
    expect(row).toMatchObject({ cadre: "Midwife", approved: 3, filled: 1, vacancies: 2 });
  });
});

describe("platform side", () => {
  it("creates a district, assigns a facility, and makes an officer login", async () => {
    const { user } = await makeUser({ role: "PLATFORM_ADMIN" });
    const api = as(user);
    const d = (await api.post("/api/platform/districts", { name: "Lawra", region: "Upper West" })).body.district;
    const f = await makeFacility("Lawra Clinic");
    expect((await api.put(`/api/platform/facilities/${f.id}/district`, { districtId: d.id })).status).toBe(200);
    const out = await api.post(`/api/platform/districts/${d.id}/officers`, { email: "officer@lawra.example" });
    expect(out.status).toBe(201);
    expect(out.body.url).toContain("reset-password");
    expect((await api.post(`/api/platform/districts/${d.id}/officers`, { email: "officer@lawra.example" })).status).toBe(409);
  });
});

describe("attendance and compliance screens", () => {
  it("show only what the facility granted and expose counts, never names", async () => {
    const { officer, admin, granted } = await setup();
    const api = as(officer);
    expect((await api.get("/api/district/attendance")).body.facilities).toHaveLength(0);
    expect((await api.get("/api/district/compliance")).body.facilities).toHaveLength(0);
    await as(admin).put("/api/facility/directorate", { scopes: ["ATTENDANCE"] });
    const a = (await api.get("/api/district/attendance")).body;
    expect(a.facilities.map((f: { name: string }) => f.name)).toEqual([granted.name]);
    expect(a.months).toHaveLength(3);
    expect(a.facilities[0].months[0]).toEqual({ published: false, percent: null });
    expect((await api.get("/api/district/compliance")).body.facilities).toHaveLength(0);
    await as(admin).put("/api/facility/directorate", { scopes: ["COMPLIANCE"] });
    const c = (await api.get("/api/district/compliance")).body;
    expect(c.facilities[0].months[0]).toEqual({ published: false, blockingOpen: 0, warningsOpen: 0, overridden: 0 });
  });

  it("lists each facility on the overview, worst first", async () => {
    const { officer, admin } = await setup();
    await as(admin).put("/api/facility/directorate", { scopes: ["COVERAGE"] });
    const d = (await as(officer).get("/api/district/dashboard")).body;
    expect(d.facilities).toHaveLength(1);
    expect(d.facilities[0]).toMatchObject({ shortDays: 0, nextMonthPublished: false });
  });
});
