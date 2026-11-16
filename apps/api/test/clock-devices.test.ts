import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";
import { parsePunches } from "../src/lib/clockImport.js";

beforeEach(resetDatabase);

describe("reading a punches file", () => {
  it("reads tab, comma and spaced lines and skips what it cannot read", () => {
    const r = parsePunches("7\t2026-11-16 07:50:12\t0\t1\t0\t0\n007,2026-11-16 17:05:00\n8 2026-11-16 08:10:00\nheader line\n9\t2026-13-45 99:99:99");
    expect(r.punches).toHaveLength(3);
    expect(r.skipped).toBe(2);
    expect(r.punches[0].at.toISOString()).toBe("2026-11-16T07:50:12.000Z");
  });
});

describe("clock devices", () => {
  async function setup() {
    const facility = await makeFacility("Ahmadiyya Hospital");
    const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Administrator" } });
    const { user: nurse } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Ama Dery" } });
    const staff = await prisma.staff.findFirstOrThrow({ where: { facilityId: facility.id, fullName: "Ama Dery" } });
    return { facility, admin: as(admin), nurse: as(nurse), staff };
  }

  it("is for the administrator only, and numbers cannot be shared", async () => {
    const { admin, nurse, staff } = await setup();
    expect((await nurse.get("/api/facility/clock-devices")).status).toBe(403);
    const made = await admin.post("/api/facility/clock-devices", { name: "Main gate", brand: "ZKTeco" });
    expect(made.status).toBe(201);
    expect((await admin.put("/api/facility/clock-devices/people", { numbers: [{ staffId: staff.id, clockNumber: "7" }] })).status).toBe(200);
    const other = await prisma.staff.findFirstOrThrow({ where: { fullName: "Administrator" } });
    expect((await admin.put("/api/facility/clock-devices/people", { numbers: [{ staffId: other.id, clockNumber: "007" }] })).status).toBe(409);
  });

  it("turns punches into attendance once, with early and late minutes", async () => {
    const { facility, admin, staff } = await setup();
    const dev = (await admin.post("/api/facility/clock-devices", { name: "Main gate" })).body;
    await admin.put("/api/facility/clock-devices/people", { numbers: [{ staffId: staff.id, clockNumber: "7" }] });
    const shift = (await admin.post("/api/facility/shifts", { name: "Morning", code: "A", startTime: "08:00", endTime: "14:00", isOvernight: false, minStaff: 1, colour: "#25619f" })).body.shift;
    const day = new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000);
    const roster = await prisma.roster.create({ data: { facilityId: facility.id, month: day.getUTCMonth() + 1, year: day.getUTCFullYear(), status: "PUBLISHED" } });
    await prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId: facility.id, staffId: staff.id, shiftId: shift.id, dutyDate: day } });
    const d = day.toISOString().slice(0, 10);
    const file = `7\t${d} 07:50:00\t0\t1\n7\t${d} 14:05:00\t1\t1\n99\t${d} 08:00:00\t0\t1`;
    const preview = await admin.post(`/api/facility/clock-devices/${dev.id}/import`, { text: file, apply: false });
    expect(preview.body.summary).toMatchObject({ attendanceNew: 1, notOnStaffList: [{ pin: "99", count: 1 }] });
    expect(await prisma.attendance.count()).toBe(0);
    const done = await admin.post(`/api/facility/clock-devices/${dev.id}/import`, { text: file, apply: true });
    expect(done.body.applied).toBe(true);
    const a = await prisma.attendance.findFirstOrThrow();
    expect(a).toMatchObject({ status: "PRESENT", minutesEarly: 10, source: "DEVICE" });
    const again = await admin.post(`/api/facility/clock-devices/${dev.id}/import`, { text: file, apply: true });
    expect(again.body.summary).toMatchObject({ attendanceNew: 0, alreadyRecorded: 1 });
    expect(await prisma.attendance.count()).toBe(1);
    expect(await prisma.devicePunch.count()).toBe(2);
  });
});
