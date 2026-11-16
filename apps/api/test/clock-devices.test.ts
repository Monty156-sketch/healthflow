import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";
import { pairVisits, parsePunches, sameName } from "../src/lib/clockImport.js";

beforeEach(resetDatabase);

describe("reading a punches file", () => {
  it("reads tab, comma and spaced lines and skips what it cannot read", () => {
    const r = parsePunches("7\t2026-11-16 07:50:12\t0\t1\t0\t0\n007,2026-11-16 17:05:00\n8 2026-11-16 08:10:00\nheader line\n9\t2026-13-45 99:99:99");
    expect(r.punches).toHaveLength(3);
    expect(r.skipped).toBe(2);
    expect(r.punches[0].at.toISOString()).toBe("2026-11-16T07:50:12.000Z");
  });
});

describe("ZKBio Time transaction report", () => {
  const layout = [
    "Transaction",
    "Start Date 2026-01-01 End Date 2026-01-31",
    "      Employee ID                           First Name   Department       Date      Time    Punch State   Work Code   Data Sources",
    "      AMHK-M060                  BUKARI DUBIK RAFIATU    Maternity     2026-01-01   20:00    Check In        0          Device",
    "      AMHK-M060                  BUKARI DUBIK RAFIATU    Maternity     2026-01-02   08:02   Check Out        0          Device",
    "      AMHK-M060                  BUKARI DUBIK RAFIATU    Maternity     2026-01-19   20:10   Check Out        0          Device",
    "1/1                                                                                                                      2026-11-12",
  ].join("\n");

  it("reads the printed layout and the CSV export, with names and departments", () => {
    const r = parsePunches(layout);
    expect(r.punches).toHaveLength(3);
    expect(r.skipped).toBe(0);
    expect(r.punches[0]).toMatchObject({ pin: "AMHK-M060", name: "BUKARI DUBIK RAFIATU", dept: "Maternity", state: "IN" });
    const csv = "Employee ID,First Name,Department,Date,Time,Punch State,Work Code,Data Sources\nAMHK-N138,DORA ATARIBANAM,Maternity,2026-01-03,19:18,Check In,0,Device";
    expect(parsePunches(csv).punches[0]).toMatchObject({ pin: "AMHK-N138", name: "DORA ATARIBANAM", state: "IN" });
  });

  it("pairs a night shift across midnight, keeps a missing check-out, and flags a check-out with no check-in", () => {
    const at = (s: string) => new Date(`${s}:00Z`);
    const r = pairVisits([
      { at: at("2026-01-02T08:02"), state: "OUT" }, { at: at("2026-01-01T20:00"), state: "IN" },
      { at: at("2026-01-03T19:20"), state: "IN" }, { at: at("2026-01-04T19:31"), state: "IN" }, { at: at("2026-01-05T08:44"), state: "OUT" },
      { at: at("2026-01-19T20:10"), state: "OUT" },
    ]);
    expect(r.visits.map((v) => [v.arrived.toISOString().slice(0, 16), v.left?.toISOString().slice(0, 16) ?? null])).toEqual([
      ["2026-01-01T20:00", "2026-01-02T08:02"], ["2026-01-03T19:20", null], ["2026-01-04T19:31", "2026-01-05T08:44"],
    ]);
    expect(r.orphanOuts).toHaveLength(1);
  });

  it("matches names in any order, but not a single shared name", () => {
    expect(sameName("Dora Ataribanam", "ATARIBANAM DORA")).toBe(true);
    expect(sameName("Dora", "Dora Ataribanam")).toBe(false);
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

  it("imports a ZKBio Time report: night duty paired across midnight, names suggested for unknown IDs", async () => {
    const { facility, admin, staff } = await setup();
    const dev = (await admin.post("/api/facility/clock-devices", { name: "ZKBio Time" })).body;
    const night = (await admin.post("/api/facility/shifts", { name: "Night", code: "N", startTime: "19:00", endTime: "07:00", isOvernight: true, minStaff: 1, colour: "#25619f" })).body.shift;
    const morning = (await admin.post("/api/facility/shifts", { name: "Morning", code: "M", startTime: "07:00", endTime: "14:00", isOvernight: false, minStaff: 1, colour: "#25619f" })).body.shift;
    const day = new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000);
    const next = new Date(day.getTime() + 86_400_000);
    const roster = await prisma.roster.create({ data: { facilityId: facility.id, month: day.getUTCMonth() + 1, year: day.getUTCFullYear(), status: "PUBLISHED" } });
    await prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId: facility.id, staffId: staff.id, shiftId: night.id, dutyDate: day } });
    await prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId: facility.id, staffId: staff.id, shiftId: morning.id, dutyDate: next } });
    const d1 = day.toISOString().slice(0, 10);
    const d2 = next.toISOString().slice(0, 10);
    const csv = ["Employee ID,First Name,Department,Date,Time,Punch State,Work Code,Data Sources",
      `AMHK-N1,DERY AMA,Maternity,${d1},19:10,Check In,0,Device`,
      `AMHK-N1,DERY AMA,Maternity,${d2},07:02,Check Out,0,Device`,
      `AMHK-N1,DERY AMA,Maternity,${d2},07:20,Check In,0,Device`,
      `AMHK-X9,NOBODY KNOWN,Lab,${d1},08:00,Check In,0,Device`].join("\n");
    const first = await admin.post(`/api/facility/clock-devices/${dev.id}/import`, { text: csv, apply: false });
    expect(first.body.summary.notOnStaffList).toEqual(expect.arrayContaining([expect.objectContaining({ pin: "AMHK-N1", suggestion: expect.objectContaining({ staffId: staff.id }) }), expect.objectContaining({ pin: "AMHK-X9", suggestion: null })]));
    await admin.put("/api/facility/clock-devices/people", { numbers: [{ staffId: staff.id, clockNumber: "AMHK-N1" }] });
    const done = await admin.post(`/api/facility/clock-devices/${dev.id}/import`, { text: csv, apply: true });
    expect(done.body.summary).toMatchObject({ attendanceNew: 2, noCheckOut: 1, checkOutWithoutCheckIn: 0 });
    const rows = await prisma.attendance.findMany({ orderBy: { dutyDate: "asc" } });
    expect(rows[0]).toMatchObject({ status: "PRESENT", minutesLate: 10, source: "DEVICE" });
    expect(rows[1]).toMatchObject({ status: "LATE", minutesLate: 20 });
  });
});
