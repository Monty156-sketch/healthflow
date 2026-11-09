import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";
import { dutyEnd, runAutoAbsent } from "../src/lib/autoAbsent.js";

beforeEach(resetDatabase);

const day = (offset: number) => new Date(Math.floor(Date.now() / 86_400_000 + offset) * 86_400_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function setup(offset: number, geo = true) {
  const facility = await makeFacility("Sombo Health Centre");
  if (geo) await prisma.facility.update({ where: { id: facility.id }, data: { geoLat: 10.05, geoLng: -2.5, geoRadiusM: 200 } });
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
  const api = as(admin);
  const shift = (await api.post("/api/facility/shifts", { name: "Morning", code: "A", startTime: "08:00", endTime: "14:00", isOvernight: false, minStaff: 1, colour: "#25619f" })).body.shift;
  const ama = await prisma.staff.create({ data: { facilityId: facility.id, staffNo: "1", fullName: "Ama Dery", status: "ACTIVE" } });
  const esi = await prisma.staff.create({ data: { facilityId: facility.id, staffNo: "2", fullName: "Esi Naa", status: "ACTIVE" } });
  const d = day(offset);
  const roster = await prisma.roster.create({ data: { facilityId: facility.id, month: d.getUTCMonth() + 1, year: d.getUTCFullYear(), status: "PUBLISHED" } });
  const a1 = await prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId: facility.id, staffId: ama.id, shiftId: shift.id, dutyDate: d } });
  const a2 = await prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId: facility.id, staffId: esi.id, shiftId: shift.id, dutyDate: d } });
  return { facility, api, ama, esi, a1, a2, d };
}

describe("attendance from the book", () => {
  it("works out minutes early and late from the arrival time, late only after 15 minutes", async () => {
    const { api, a1, a2, d } = await setup(-1);
    const r = await api.put("/api/facility/attendance/day", {
      date: iso(d),
      records: [{ assignmentId: a1.id, status: "PRESENT", arrivalTime: "07:50" }, { assignmentId: a2.id, status: "PRESENT", arrivalTime: "08:12" }],
    });
    expect(r.body.saved).toBe(2);
    expect(await prisma.attendance.findFirstOrThrow({ where: { rosterAssignmentId: a1.id } })).toMatchObject({ status: "PRESENT", minutesEarly: 10, minutesLate: null, source: "BOOK" });
    expect(await prisma.attendance.findFirstOrThrow({ where: { rosterAssignmentId: a2.id } })).toMatchObject({ status: "PRESENT", minutesLate: 12, minutesEarly: null });
    const late = await api.put("/api/facility/attendance/day", { date: iso(d), reason: "Book shows she came at 8:30", records: [{ assignmentId: a2.id, status: "LATE", arrivalTime: "08:30" }] });
    expect(late.status).toBe(200);
    expect(await prisma.attendance.findFirstOrThrow({ where: { rosterAssignmentId: a2.id } })).toMatchObject({ status: "LATE", minutesLate: 30 });
    const view = await api.get(`/api/facility/attendance/day?date=${iso(d)}`);
    expect(view.body.shifts[0].people[0].record).toMatchObject({ clockedAt: "07:50", minutesEarly: 10, source: "BOOK" });
  });
});

describe("automatic absence", () => {
  it("works out when a night duty ends", () => {
    const d = new Date("2026-11-08T00:00:00Z");
    expect(dutyEnd(d, "20:00", "08:00", true).toISOString()).toBe("2026-11-09T08:00:00.000Z");
    expect(dutyEnd(d, "08:00", "14:00", false).toISOString()).toBe("2026-11-08T14:00:00.000Z");
  });

  it("marks a finished duty with no clock-in absent, flagged for review, once", async () => {
    const { a1, a2, ama, d, facility } = await setup(-1);
    await prisma.attendance.create({ data: { facilityId: facility.id, staffId: ama.id, rosterId: a1.rosterId, rosterAssignmentId: a1.id, dutyDate: d, shiftId: a1.shiftId, status: "PRESENT", source: "CLOCK" } });
    expect(await runAutoAbsent()).toBe(1);
    expect(await prisma.attendance.findFirstOrThrow({ where: { rosterAssignmentId: a2.id } })).toMatchObject({ status: "ABSENT", source: "AUTO", needsReview: true });
    expect(await runAutoAbsent()).toBe(0);
    expect((await prisma.attendance.findFirstOrThrow({ where: { rosterAssignmentId: a1.id } })).status).toBe("PRESENT");
  });

  it("leaves alone people on approved leave, duties not yet ended, old duties, and facilities with no clock-in location", async () => {
    const s = await setup(-1);
    const type = await prisma.leaveType.create({ data: { facilityId: s.facility.id, code: "L", name: "Annual", sortOrder: 1 } });
    await prisma.leaveRequest.create({ data: { facilityId: s.facility.id, staffId: s.ama.id, leaveTypeId: type.id, startDate: s.d, endDate: s.d, daysDeducted: 1, status: "APPROVED" } });
    expect(await runAutoAbsent()).toBe(1);
    expect(await prisma.attendance.count({ where: { rosterAssignmentId: s.a1.id } })).toBe(0);
    await resetDatabase();
    const old = await setup(-5);
    expect(await runAutoAbsent()).toBe(0);
    expect(old.a1.id).toBeTruthy();
    await resetDatabase();
    const nogeo = await setup(-1, false);
    expect(await runAutoAbsent()).toBe(0);
    expect(nogeo.a1.id).toBeTruthy();
    await resetDatabase();
    await setup(1);
    expect(await runAutoAbsent()).toBe(0);
  });
});

describe("month check", () => {
  it("blocks approval while records need a look, then records the approval", async () => {
    const { api, d, a1, a2 } = await setup(-1);
    await runAutoAbsent();
    const month = iso(d).slice(0, 7);
    const check = await api.get(`/api/facility/attendance/month-check?month=${month}`);
    expect(check.body.counts.auto).toBe(2);
    expect(check.body.toCheck).toHaveLength(2);
    const blocked = await api.post("/api/facility/attendance/month-approve", { month });
    expect(blocked.status).toBe(409);
    await api.put("/api/facility/attendance/day", { date: iso(d), reason: "Both signed the book that morning", records: [{ assignmentId: a1.id, status: "PRESENT", arrivalTime: "08:05" }, { assignmentId: a2.id, status: "PRESENT", arrivalTime: "08:00" }] });
    for (const row of await prisma.attendance.findMany({ where: { needsReview: true } })) await api.post(`/api/facility/attendance/${row.id}/resolve`, {});
    const ok = await api.post("/api/facility/attendance/month-approve", { month });
    expect(ok.status).toBe(200);
    expect((await api.get(`/api/facility/attendance/month-check?month=${month}`)).body.approved).toMatchObject({ by: expect.any(String) });
  });
});
