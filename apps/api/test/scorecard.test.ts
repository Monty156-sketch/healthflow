import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";
import { bandOf, mean } from "../src/lib/scorecard.js";

beforeEach(resetDatabase);

const ym = (back: number) => { const d = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - back, 1)); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, start: d }; };

async function setup() {
  const district = await prisma.district.create({ data: { name: "Wa West", region: "Upper West" } });
  const clinic = await makeFacility("Granted Clinic");
  const hidden = await makeFacility("Hidden Clinic");
  await prisma.facility.updateMany({ where: { id: { in: [clinic.id, hidden.id] } }, data: { districtId: district.id } });
  const officer = await prisma.userProfile.create({ data: { userEmail: "dho@example.test", passwordHash: "x", role: "DISTRICT_OFFICER", scopeType: "DISTRICT", scopeId: district.id } });
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: clinic.id, withStaff: { fullName: "Ama Admin" } });
  return { clinic, hidden, officer, admin };
}

async function published(facilityId: string, back: number, completeness: number | null, publishedDaysBeforeStart: number) {
  const m = ym(back);
  return prisma.roster.create({ data: { facilityId, year: m.year, month: m.month, status: "PUBLISHED", publishedAt: new Date(m.start.getTime() - publishedDaysBeforeStart * 86_400_000), attendanceCompleteness: completeness } });
}

describe("bands", () => {
  it("states the thresholds the page shows", () => {
    expect([bandOf("coverage", 95), bandOf("coverage", 80), bandOf("coverage", 40), bandOf("coverage", null)]).toEqual(["GOOD", "WATCH", "CONCERN", null]);
    expect([bandOf("blocking", 0), bandOf("blocking", 2), bandOf("blocking", 3)]).toEqual(["GOOD", "WATCH", "CONCERN"]);
    expect([bandOf("publishedBeforeStart", 100), bandOf("publishedBeforeStart", 60), bandOf("publishedBeforeStart", 0)]).toEqual(["GOOD", "WATCH", "CONCERN"]);
    expect(mean([80, null, 90])).toBe(85);
    expect(mean([null])).toBeNull();
  });
});

describe("district performance scorecard", () => {
  it("shows only what each facility has granted and leaves the rest blank", async () => {
    const { clinic, hidden, officer, admin } = await setup();
    await published(clinic.id, 1, 0.8, 5);
    await published(hidden.id, 1, 0.1, 5);
    const api = as(officer);
    expect((await api.get("/api/district/scorecard")).body.facilities).toHaveLength(0);
    await as(admin).put("/api/facility/directorate", { scopes: ["ATTENDANCE"] });
    const body = (await api.get("/api/district/scorecard")).body;
    expect(body.facilities).toHaveLength(1);
    const row = body.facilities[0];
    expect(row.name).toBe("Granted Clinic");
    expect(row.month.attendance).toBe(80);
    // Coverage and compliance were not shared, so they are blank rather than zero.
    expect(row.month.coverage).toBeNull();
    expect(row.month.publishedBeforeStart).toBeNull();
    expect(row.month.blocking).toBeNull();
    expect(JSON.stringify(body)).not.toContain("Hidden Clinic");
  });

  it("compares with the month before and counts open blocking findings", async () => {
    const { clinic, officer, admin } = await setup();
    await published(clinic.id, 2, 0.6, 3);
    const last = await published(clinic.id, 1, 0.9, 3);
    await prisma.complianceFinding.createMany({
      data: [1, 2, 3].map((i) => ({ facilityId: clinic.id, rosterId: last.id, ruleCode: `R${i}`, severity: "BLOCK" as const, status: "OPEN" as const, message: "x" })),
    });
    await as(admin).put("/api/facility/directorate", { scopes: ["ATTENDANCE", "COMPLIANCE", "COVERAGE"] });
    const row = (await as(officer).get("/api/district/scorecard")).body.facilities[0];
    expect(row.month.attendance).toBe(90);
    expect(row.previous.attendance).toBe(60);
    expect(row.change.attendance).toBe(30);
    expect(row.month.blocking).toBe(3);
    expect(row.bands.blocking).toBe("CONCERN");
    expect(row.month.publishedBeforeStart).toBe(100);
    expect(row.concerns).toBeGreaterThan(0);
  });

  it("writes each read to the facility's audit log and downloads as CSV", async () => {
    const { clinic, officer, admin } = await setup();
    await published(clinic.id, 1, 0.75, 2);
    await as(admin).put("/api/facility/directorate", { scopes: ["ATTENDANCE", "COMPLIANCE", "COVERAGE"] });
    const csv = await as(officer).get("/api/district/scorecard.csv");
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("Granted Clinic");
    expect(csv.text).toContain("Attendance recorded %");
    expect(await prisma.auditLog.count({ where: { facilityId: clinic.id, action: "district_read" } })).toBe(3);
    // Closed to a facility user.
    expect((await as(admin).get("/api/district/scorecard")).status).toBe(403);
  });

  it("ignores a month in the future and falls back to last month", async () => {
    const { clinic, officer, admin } = await setup();
    await published(clinic.id, 1, 0.5, 1);
    await as(admin).put("/api/facility/directorate", { scopes: ["ATTENDANCE"] });
    const last = ym(1);
    const res = (await as(officer).get("/api/district/scorecard?month=2999-01")).body;
    expect(res.month).toBe(`${last.year}-${String(last.month).padStart(2, "0")}`);
  });
});
