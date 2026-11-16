import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

describe("office-hours staff on the daily attendance screen", () => {
  it("lists them on weekdays only, not on public holidays, and lets the in-charge mark them without a roster", async () => {
    const facility = await makeFacility("Ahmadiyya Hospital");
    const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Administrator" } });
    const api = as(admin);
    const dept = await prisma.department.create({ data: { facilityId: facility.id, name: "Finance" } });
    const kofi = await prisma.staff.create({ data: { facilityId: facility.id, staffNo: "F1", fullName: "Kofi Finance", status: "ACTIVE", officeHours: true, departmentId: dept.id } });
    await prisma.publicHoliday.create({ data: { facilityId: facility.id, date: new Date("2026-03-04T00:00:00Z"), name: "Test holiday", year: 2026 } });

    const tue = (await api.get("/api/facility/attendance/day?date=2026-03-03")).body;
    expect(tue.blocked).toBeNull();
    expect(tue.noRoster).toContain("office-hours");
    expect(tue.shifts[0]).toMatchObject({ id: "office", startTime: "08:00", endTime: "17:00" });
    expect(tue.shifts[0].people[0]).toMatchObject({ staffId: kofi.id, department: "Finance", record: null });
    expect((await api.get("/api/facility/attendance/day?date=2026-03-04")).body.shifts).toHaveLength(0);
    expect((await api.get("/api/facility/attendance/day?date=2026-03-07")).body.shifts).toHaveLength(0);

    const noReason = await api.put("/api/facility/attendance/day", { date: "2026-03-03", records: [{ assignmentId: `office:${kofi.id}`, status: "LATE", minutesLate: 20 }] });
    expect(noReason.status).toBe(400);
    const saved = await api.put("/api/facility/attendance/day", { date: "2026-03-03", reason: "Entered from the office book", records: [{ assignmentId: `office:${kofi.id}`, status: "LATE", minutesLate: 20 }] });
    expect(saved.body.saved).toBe(1);
    expect(await prisma.attendance.findFirstOrThrow({ where: { staffId: kofi.id } })).toMatchObject({ status: "LATE", minutesLate: 20, rosterAssignmentId: null, source: "MANUAL" });
    expect((await api.get("/api/facility/attendance/day?date=2026-03-03")).body.shifts[0].people[0].record).toMatchObject({ status: "LATE", minutesLate: 20 });
  });
});
