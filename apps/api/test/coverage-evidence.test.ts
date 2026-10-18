import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

async function world() {
  const facility = await makeFacility("Evidence Clinic");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Ama Admin" } });
  const { staff } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Kofi Mensah" } });
  const shift = await prisma.shift.create({ data: { facilityId: facility.id, name: "Day", code: "D", startTime: "07:00", endTime: "15:00", durationHours: 8, minStaff: 2 } });
  const now = new Date();
  const roster = await prisma.roster.create({ data: { facilityId: facility.id, year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, status: "PUBLISHED", generationSeconds: 4.2, version: 3 } });
  await prisma.rosterVersionSnapshot.create({ data: { rosterId: roster.id, version: 2, assignments: [], reason: "Cover for a sick colleague" } });
  const day1 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  await prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId: facility.id, staffId: staff!.id, shiftId: shift.id, dutyDate: day1 } });
  await prisma.complianceFinding.create({ data: { rosterId: roster.id, facilityId: facility.id, ruleCode: "C5", severity: "BLOCK", message: "x", status: "OVERRIDDEN" } });
  await prisma.complianceFinding.create({ data: { rosterId: roster.id, facilityId: facility.id, ruleCode: "C11", severity: "WARN", message: "y", status: "OPEN" } });
  return { admin, month: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}` };
}

describe("coverage", () => {
  it("marks a day short of the minimum and lists it as unfilled", async () => {
    const { admin, month } = await world();
    const body = (await as(admin).get(`/api/facility/coverage?month=${month}`)).body;
    expect(body.days[0].cells[0]).toMatchObject({ staffed: 1, required: 2, state: "SHORT" });
    expect(body.unfilled.length).toBeGreaterThan(0);
    expect(body.strip).toHaveLength(7);
  });
});

describe("evidence report", () => {
  it("computes every figure from the roster", async () => {
    const { admin, month } = await world();
    const body = (await as(admin).get(`/api/facility/coverage/evidence?month=${month}`)).body;
    const m = body.months[body.months.length - 1];
    expect(m).toMatchObject({ prepSeconds: 4.2, conflictsDetected: 2, blockingFound: 1, overridden: 1, unfilledOpen: 1, amendments: 2 });
    expect(m.amendmentReasons).toContain("Cover for a sick colleague");
    expect(body.note).toMatch(/not published or shared without the facility's written consent/);
  });

  it("makes an identifiable file only when consent is confirmed", async () => {
    const { admin, month } = await world();
    expect((await as(admin).get(`/api/facility/coverage/evidence.csv?month=${month}&consent=no`)).status).toBe(400);
    const anon = await as(admin).get(`/api/facility/coverage/evidence.csv?month=${month}`);
    expect(anon.text).toContain("A health facility");
    expect(anon.text).not.toContain("Evidence Clinic");
    const named = await as(admin).get(`/api/facility/coverage/evidence.csv?month=${month}&consent=confirmed`);
    expect(named.text).toContain("Evidence Clinic");
  });
});
