import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { as, freezeEarlyInMonth, makeFacility, makeUser, prisma, resetDatabase, unfreezeClock } from "./helpers.js";
import { loadEngineData } from "../src/routes/facility/rosters.js";

beforeEach(async () => {
  await resetDatabase();
  freezeEarlyInMonth();
});
afterEach(unfreezeClock);

const DAY = 86_400_000;
const iso = (offset: number) => new Date((Math.floor(Date.now() / DAY) + offset) * DAY).toISOString().slice(0, 10);

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Sister Ama" } });
  const { user: nurse, staff } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Esi Naa" } });
  return { facility, api: as(admin), me: as(nurse), staff: staff! };
}

describe("days off asked for before the roster", () => {
  it("a person asks, the in-charge decides, and the person is told", async () => {
    const { api, me, staff } = await setup();
    const asked = await me.post("/api/facility/days-off", { date: iso(10), reason: "Family wedding" });
    expect(asked.status).toBe(201);
    expect(asked.body.request.status).toBe("REQUESTED");
    expect((await me.post("/api/facility/days-off", { date: iso(10) })).status).toBe(409);
    expect((await me.post("/api/facility/days-off", { date: iso(0) })).status).toBe(400);
    const list = (await api.get("/api/facility/days-off")).body;
    expect(list.decider).toBe(true);
    expect(list.requests.map((r: { name: string }) => r.name)).toContain("Esi Naa");
    expect((await me.post(`/api/facility/days-off/${asked.body.request.id}/decide`, { decision: "approve" })).status).toBe(403);
    const ok = await api.post(`/api/facility/days-off/${asked.body.request.id}/decide`, { decision: "approve" });
    expect(ok.body.request.status).toBe("APPROVED");
    expect(await prisma.notification.count({ where: { recipientStaffId: staff.id, type: "day_off_decided" } })).toBe(1);
  });

  it("allows only a few days a month, and a person sees only their own", async () => {
    const { facility, me } = await setup();
    const d0 = new Date(Date.now());
    const month = (d: number) => new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, d)).toISOString().slice(0, 10);
    for (const d of [3, 4, 5, 6]) expect((await me.post("/api/facility/days-off", { date: month(d) })).status).toBe(201);
    expect((await me.post("/api/facility/days-off", { date: month(7) })).status).toBe(409);
    const { user: other } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Yaw Boah" } });
    expect((await as(other).get("/api/facility/days-off")).body.requests).toEqual([]);
  });

  it("the engine is given approved and waiting days, and no-nights periods", async () => {
    const { facility, api, me, staff } = await setup();
    const asked = await me.post("/api/facility/days-off", { date: iso(5) });
    await api.post(`/api/facility/days-off/${asked.body.request.id}/decide`, { decision: "approve" });
    await me.post("/api/facility/days-off", { date: iso(6) });
    const rest = await api.post(`/api/facility/staff/${staff.id}/restrictions`, { startDate: iso(1), endDate: iso(20), note: "Breastfeeding" });
    expect(rest.status).toBe(201);
    expect((await me.post(`/api/facility/staff/${staff.id}/restrictions`, { startDate: iso(1), endDate: iso(2) })).status).toBe(403);
    const d = new Date(`${iso(5)}T00:00:00Z`);
    const roster = await prisma.roster.create({ data: { facilityId: facility.id, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, status: "DRAFT" } });
    const data = await loadEngineData(facility.id, roster.id, roster.year, roster.month);
    const day = (s: string) => Math.floor(new Date(`${s}T00:00:00Z`).getTime() / DAY);
    expect(data.daysOff).toEqual(expect.arrayContaining([{ staffId: staff.id, day: day(iso(5)), approved: true }, { staffId: staff.id, day: day(iso(6)), approved: false }]));
    expect(data.staff.find((s) => s.id === staff.id)!.noNights).toEqual([{ startDay: day(iso(1)), endDay: day(iso(20)) }]);
  });
});

describe("cadres on office hours, leads and personal limits", () => {
  it("puts an office-hours cadre on weekday mornings only, and carries leads and limits to the engine", async () => {
    const { facility, api, staff } = await setup();
    const pharm = await api.post("/api/facility/cadres", { name: "Pharmacist", weekdaysOnly: true });
    expect(pharm.body.cadre.weekdaysOnly).toBe(true);
    await api.post("/api/facility/shifts/starter", {});
    const p = await prisma.staff.create({ data: { facilityId: facility.id, staffNo: "P1", fullName: "Patience", status: "ACTIVE", cadreId: pharm.body.cadre.id } });
    const cur = (await api.get(`/api/facility/staff/${staff.id}`)).body.staff;
    const patch = await api.patch(`/api/facility/staff/${staff.id}`, {
      staffNo: cur.staffNo, fullName: cur.fullName, employmentStatus: cur.employmentStatus, eligibleShiftIds: [], excludedFromNights: false, maxDutiesPerWeek: 0,
      canLead: true, maxNightsPerMonth: 8, maxHoursPerMonth: 160,
    });
    expect(patch.status).toBe(200);
    expect(patch.body.staff).toMatchObject({ canLead: true, maxNightsPerMonth: 8, maxHoursPerMonth: 160 });
    const roster = await prisma.roster.create({ data: { facilityId: facility.id, year: 2026, month: 12, status: "DRAFT" } });
    const data = await loadEngineData(facility.id, roster.id, 2026, 12);
    expect(data.staff.find((s) => s.id === p.id)).toMatchObject({ morningOnly: true, excludedFromNights: true });
    expect(data.staff.find((s) => s.id === staff.id)).toMatchObject({ canLead: true, maxNightsPerMonth: 8, maxHoursPerMonth: 160 });
  });
});
