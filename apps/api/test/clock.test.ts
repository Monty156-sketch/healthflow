import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";
import { insideArea, metresBetween } from "../src/lib/geofence.js";

beforeEach(resetDatabase);

describe("distance", () => {
  it("measures metres between two points and allows a poor fix up to 100 metres", () => {
    // 0.001 degrees of latitude is about 111 metres.
    expect(Math.round(metresBetween(10.06, -2.5, 10.061, -2.5))).toBeGreaterThan(105);
    expect(Math.round(metresBetween(10.06, -2.5, 10.061, -2.5))).toBeLessThan(115);
    expect(insideArea(180, 150, 0)).toBe(false);
    expect(insideArea(180, 150, 50)).toBe(true);
    expect(insideArea(400, 150, 5000)).toBe(false);
  });
});

describe("clocking in and out", () => {
  async function setup() {
    const facility = await makeFacility("Sombo Health Centre");
    const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Administrator" } });
    const { user: nurse } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Ama Dery" } });
    return { facility, admin: as(admin), nurse: as(nurse) };
  }
  const here = { lat: 10.06, lng: -2.5, accuracy: 10 };

  it("is off until the administrator sets the area, and only the administrator can set it", async () => {
    const { admin, nurse } = await setup();
    expect((await nurse.get("/api/facility/me/clock")).body.enabled).toBe(false);
    expect((await nurse.post("/api/facility/me/clock", { kind: "IN", ...here })).status).toBe(409);
    expect((await nurse.put("/api/facility/geofence", { lat: 10.06, lng: -2.5, radiusM: 150 })).status).toBe(403);
    expect((await admin.put("/api/facility/geofence", { lat: 10.06, lng: -2.5, radiusM: 10 })).status).toBe(400);
    expect((await admin.put("/api/facility/geofence", { lat: 10.06, lng: -2.5, radiusM: 150 })).body).toMatchObject({ set: true, radiusM: 150 });
    expect((await nurse.get("/api/facility/me/clock")).body).toMatchObject({ enabled: true, state: "OUT" });
  });

  it("lets staff in inside the area, turns them away outside it, and keeps in and out in order without storing where they were", async () => {
    const { admin, nurse } = await setup();
    await admin.put("/api/facility/geofence", { lat: 10.06, lng: -2.5, radiusM: 150 });
    const away = await nurse.post("/api/facility/me/clock", { kind: "IN", lat: 10.07, lng: -2.5, accuracy: 10 });
    expect(away.status).toBe(403);
    expect((await nurse.post("/api/facility/me/clock", { kind: "OUT", ...here })).status).toBe(409);
    expect((await nurse.post("/api/facility/me/clock", { kind: "IN", ...here })).body.state).toBe("IN");
    expect((await nurse.post("/api/facility/me/clock", { kind: "IN", ...here })).status).toBe(409);
    expect((await nurse.post("/api/facility/me/clock", { kind: "OUT", ...here })).body.state).toBe("OUT");
    const events = await prisma.clockEvent.findMany({ orderBy: { at: "asc" } });
    expect(events.map((e) => e.kind)).toEqual(["IN", "OUT"]);
    expect(Object.keys(events[0]).sort()).toEqual(["at", "distanceM", "facilityId", "id", "kind", "staffId"]);
  });

  it("marks a person present on a published duty today", async () => {
    const { facility, admin, nurse } = await setup();
    await admin.put("/api/facility/geofence", { lat: 10.06, lng: -2.5, radiusM: 150 });
    const staff = await prisma.staff.findFirstOrThrow({ where: { facilityId: facility.id, fullName: "Ama Dery" } });
    const shift = await prisma.shift.create({ data: { facilityId: facility.id, name: "Day", code: "D", startTime: "00:00", endTime: "23:59", durationHours: 24, minStaff: 1 } });
    const now = new Date();
    const roster = await prisma.roster.create({ data: { facilityId: facility.id, month: now.getUTCMonth() + 1, year: now.getUTCFullYear(), status: "PUBLISHED" } });
    const today = new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000);
    await prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId: facility.id, staffId: staff.id, shiftId: shift.id, dutyDate: today } });
    expect((await nurse.post("/api/facility/me/clock", { kind: "IN", ...here })).status).toBe(201);
    const rec = await prisma.attendance.findFirstOrThrow({ where: { staffId: staff.id } });
    expect(["PRESENT", "LATE"]).toContain(rec.status);
  });
});
