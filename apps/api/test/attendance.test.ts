import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

const day = (offset: number) => new Date(Math.floor(Date.now() / 86_400_000 + offset) * 86_400_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function setup(offset = 0, published = true) {
  const facility = await makeFacility("Sombo Health Centre");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
  const api = as(admin);
  const shift = (await api.post("/api/facility/shifts", { name: "Morning", code: "A", startTime: "08:00", endTime: "14:00", isOvernight: false, minStaff: 1, colour: "#25619f" })).body.shift;
  const people = [];
  for (const n of ["Ama Dery", "Esi Naa", "Yaw Boah"]) people.push(await prisma.staff.create({ data: { facilityId: facility.id, staffNo: n, fullName: n, status: "ACTIVE" } }));
  const d = day(offset);
  const roster = await prisma.roster.create({ data: { facilityId: facility.id, month: d.getUTCMonth() + 1, year: d.getUTCFullYear(), status: published ? "PUBLISHED" : "APPROVED" } });
  const a1 = await prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId: facility.id, staffId: people[0].id, shiftId: shift.id, dutyDate: d } });
  const a2 = await prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId: facility.id, staffId: people[1].id, shiftId: shift.id, dutyDate: d } });
  return { facility, api, people, roster, a1, a2, d };
}

describe("attendance", () => {
  it("lists the scheduled people by shift, with leave and off duty kept apart", async () => {
    const { api, people, d } = await setup();
    const r = await api.get(`/api/facility/attendance/day?date=${iso(d)}`);
    expect(r.status).toBe(200);
    expect(r.body.canRecord).toBe(true);
    expect(r.body.shifts).toHaveLength(1);
    expect(r.body.shifts[0].people.map((p: { name: string }) => p.name)).toEqual(["Ama Dery", "Esi Naa"]);
    expect(r.body.offDuty.map((p: { name: string }) => p.name)).toContain("Yaw Boah");
    expect(people).toHaveLength(3);
  });

  it("records a day, needing minutes for Late, and updates completeness", async () => {
    const { api, a1, a2, d, roster } = await setup();
    const bad = await api.put("/api/facility/attendance/day", { date: iso(d), records: [{ assignmentId: a1.id, status: "LATE" }] });
    expect(bad.status).toBe(400);
    const ok = await api.put("/api/facility/attendance/day", {
      date: iso(d),
      records: [{ assignmentId: a1.id, status: "LATE", minutesLate: 20 }, { assignmentId: a2.id, status: "PRESENT" }],
    });
    expect(ok.body.saved).toBe(2);
    expect((await prisma.roster.findUniqueOrThrow({ where: { id: roster.id } })).attendanceCompleteness).toBe(1);
    const month = await api.get(`/api/facility/attendance/month?month=${iso(d).slice(0, 7)}`);
    expect(month.body.cells.find((c: { date: string; code: string }) => c.date === iso(d) && c.code === "LT")).toBeTruthy();
  });

  it("keeps the first status when a record is corrected, and wants a reason", async () => {
    const { api, a1, d } = await setup();
    await api.put("/api/facility/attendance/day", { date: iso(d), records: [{ assignmentId: a1.id, status: "PRESENT" }] });
    const noReason = await api.put("/api/facility/attendance/day", { date: iso(d), records: [{ assignmentId: a1.id, status: "ABSENT" }] });
    expect(noReason.body.error).toBe("reason_required");
    await api.put("/api/facility/attendance/day", { date: iso(d), reason: "Gate book showed she never came in", records: [{ assignmentId: a1.id, status: "ABSENT" }] });
    const row = await prisma.attendance.findFirstOrThrow({ where: { rosterAssignmentId: a1.id } });
    expect(row).toMatchObject({ status: "ABSENT", originalStatus: "PRESENT" });
  });

  it("refuses future dates, unpublished rosters and people on leave", async () => {
    const future = await setup(2);
    expect((await future.api.put("/api/facility/attendance/day", { date: iso(future.d), records: [{ assignmentId: future.a1.id, status: "PRESENT" }] })).status).toBe(409);
    await resetDatabase();
    const draft = await setup(0, false);
    expect((await draft.api.get(`/api/facility/attendance/day?date=${iso(draft.d)}`)).body.canRecord).toBe(false);
    await resetDatabase();
    const s = await setup();
    const type = await prisma.leaveType.create({ data: { facilityId: s.facility.id, code: "L", name: "Annual", sortOrder: 1 } });
    await prisma.leaveRequest.create({ data: { facilityId: s.facility.id, staffId: s.people[0].id, leaveTypeId: type.id, startDate: s.d, endDate: s.d, daysDeducted: 1, status: "APPROVED" } });
    const r = await s.api.put("/api/facility/attendance/day", { date: iso(s.d), records: [{ assignmentId: s.a1.id, status: "PRESENT" }] });
    expect(r.body.error).toBe("on_leave");
  });

  it("asks for a reason beyond the correction window", async () => {
    const { api, a1, d } = await setup(-20);
    const r = await api.put("/api/facility/attendance/day", { date: iso(d), records: [{ assignmentId: a1.id, status: "PRESENT" }] });
    expect(r.body.error).toBe("reason_required");
    const ok = await api.put("/api/facility/attendance/day", { date: iso(d), reason: "Register found after the audit", records: [{ assignmentId: a1.id, status: "PRESENT" }] });
    expect(ok.body.saved).toBe(1);
  });
});
