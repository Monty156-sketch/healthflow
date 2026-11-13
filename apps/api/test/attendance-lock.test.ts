import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

const day = (offset: number) => new Date(Math.floor(Date.now() / 86_400_000 + offset) * 86_400_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function setup(offset: number) {
  const facility = await makeFacility("Sombo Health Centre");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
  const api = as(admin);
  const shift = (await api.post("/api/facility/shifts", { name: "Morning", code: "A", startTime: "08:00", endTime: "14:00", isOvernight: false, minStaff: 1, colour: "#25619f" })).body.shift;
  const ama = await prisma.staff.create({ data: { facilityId: facility.id, staffNo: "1", fullName: "Ama Dery", status: "ACTIVE" } });
  const d = day(offset);
  const roster = await prisma.roster.create({ data: { facilityId: facility.id, month: d.getUTCMonth() + 1, year: d.getUTCFullYear(), status: "PUBLISHED" } });
  const a1 = await prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId: facility.id, staffId: ama.id, shiftId: shift.id, dutyDate: d } });
  return { facility, api, a1, d, month: iso(d).slice(0, 7) };
}

describe("attendance month approval", () => {
  it("lists someone who did not clock in as not recorded, and lets the in-charge mark them", async () => {
    const { api, a1, d } = await setup(0);
    const view = await api.get(`/api/facility/attendance/day?date=${iso(d)}`);
    expect(view.body.shifts[0].people[0].record).toBeNull();
    expect((await api.put("/api/facility/attendance/day", { date: iso(d), records: [{ assignmentId: a1.id, status: "PRESENT" }] })).body.saved).toBe(1);
    expect(await prisma.attendance.findFirstOrThrow({ where: { rosterAssignmentId: a1.id } })).toMatchObject({ status: "PRESENT", source: "MANUAL" });
  });

  it("locks an approved month, and the administrator can reopen it with a reason", async () => {
    const { api, a1, d, month } = await setup(-40);
    await api.put("/api/facility/attendance/day", { date: iso(d), reason: "Entered from the facility book", records: [{ assignmentId: a1.id, status: "PRESENT" }] });
    expect((await api.post("/api/facility/attendance/month-approve", { month })).status).toBe(200);
    expect((await api.get(`/api/facility/attendance/day?date=${iso(d)}`)).body).toMatchObject({ locked: true, canRecord: false });
    const blocked = await api.put("/api/facility/attendance/day", { date: iso(d), reason: "Trying to change it", records: [{ assignmentId: a1.id, status: "ABSENT" }] });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("month_approved");
    expect((await api.post("/api/facility/attendance/month-reopen", { month, reason: "short" })).status).toBe(400);
    expect((await api.post("/api/facility/attendance/month-reopen", { month, reason: "A name was marked wrongly" })).status).toBe(200);
    expect((await api.put("/api/facility/attendance/day", { date: iso(d), reason: "Corrected after reopening", records: [{ assignmentId: a1.id, status: "ABSENT" }] })).status).toBe(200);
  });

  it("cannot approve a month that has not finished, or while something needs a look", async () => {
    const now = await setup(0);
    expect((await now.api.post("/api/facility/attendance/month-approve", { month: now.month })).body.error).toBe("not_finished");
    await resetDatabase();
    const past = await setup(-40);
    await prisma.attendance.create({ data: { facilityId: past.facility.id, staffId: past.a1.staffId, rosterId: past.a1.rosterId, rosterAssignmentId: past.a1.id, dutyDate: past.d, shiftId: past.a1.shiftId, status: "PRESENT", needsReview: true } });
    expect((await past.api.post("/api/facility/attendance/month-approve", { month: past.month })).body.error).toBe("needs_review");
  });

  it("marks the duty days sheet final only once attendance is approved", async () => {
    const { api, facility, month } = await setup(-40);
    expect((await api.get(`/api/facility/reports/allowances?month=${month}`)).body.sheet.final).toBe(false);
    await prisma.roster.updateMany({ where: { facilityId: facility.id }, data: { status: "PUBLISHED" } });
    await api.post("/api/facility/attendance/month-approve", { month });
    const sheet = (await api.get(`/api/facility/reports/allowances?month=${month}`)).body.sheet;
    expect(sheet).toMatchObject({ attendanceApproved: true, final: true });
  });
});
