import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

describe("departments that work Monday to Friday", () => {
  it("rosters nobody on a Saturday or Sunday, and still staffs the weekdays to the minimum", async () => {
    const facility = await makeFacility("Wa Hospital");
    await prisma.facility.update({ where: { id: facility.id }, data: { facilityType: "REGIONAL_HOSPITAL" } });
    const { user } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Administrator" } });
    const api = as(user);
    const ph = await prisma.department.create({ data: { facilityId: facility.id, name: "Public Health", weekdaysOnly: true } });
    const ward = await prisma.department.create({ data: { facilityId: facility.id, name: "Surgery" } });
    const nurse = await prisma.cadre.create({ data: { facilityId: facility.id, name: "Nurse", code: "RN", sortOrder: 1 } });
    for (let i = 1; i <= 6; i++) {
      await prisma.staff.create({ data: { facilityId: facility.id, staffNo: `P${i}`, fullName: `Public Health ${i}`, status: "ACTIVE", cadreId: nurse.id, departmentId: ph.id } });
      await prisma.staff.create({ data: { facilityId: facility.id, staffNo: `W${i}`, fullName: `Surgery ${i}`, status: "ACTIVE", cadreId: nurse.id, departmentId: ward.id } });
    }
    const mk = (code: string, name: string, startTime: string, endTime: string, isOvernight: boolean) =>
      api.post("/api/facility/shifts", { name, code, startTime, endTime, isOvernight, minStaff: 2, colour: "#25619f" });
    await mk("A", "Morning", "08:00", "14:00", false);
    await mk("M", "Afternoon", "14:00", "20:00", false);
    await mk("N", "Night", "20:00", "08:00", true);
    // A ward roster uses the ward's own numbers.
    for (const sh of await prisma.shift.findMany({ where: { facilityId: facility.id } })) {
      // Both units are given 2 on every shift; the weekday rule alone keeps public health to weekday mornings.
      await prisma.shiftDemand.create({ data: { facilityId: facility.id, departmentId: ph.id, shiftId: sh.id, minStaff: 2 } });
      await prisma.shiftDemand.create({ data: { facilityId: facility.id, departmentId: ward.id, shiftId: sh.id, minStaff: 2 } });
    }

    const now = new Date();
    const body = (departmentId: string) => ({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, departmentId });
    const phRoster = (await api.post("/api/facility/rosters", body(ph.id))).body.roster as { id: string };
    const wardRoster = (await api.post("/api/facility/rosters", body(ward.id))).body.roster as { id: string };
    const phGen = await api.post(`/api/facility/rosters/${phRoster.id}/generate`);
    expect(phGen.status, JSON.stringify(phGen.body).slice(0, 400)).toBeLessThan(300);
    const wardGen = await api.post(`/api/facility/rosters/${wardRoster.id}/generate`);
    expect(wardGen.status, JSON.stringify(wardGen.body).slice(0, 400)).toBeLessThan(300);

    const days = (rows: { dutyDate: Date }[]) => rows.map((r) => r.dutyDate.getUTCDay());
    const phRows = await prisma.rosterAssignment.findMany({ where: { rosterId: phRoster.id } });
    const wardRows = await prisma.rosterAssignment.findMany({ where: { rosterId: wardRoster.id } });
    expect(phRows.length).toBeGreaterThan(0);
    expect(days(phRows).filter((d) => d === 0 || d === 6)).toHaveLength(0);
    const morning = await prisma.shift.findFirstOrThrow({ where: { facilityId: facility.id, code: "A" } });
    expect(phRows.every((r) => r.shiftId === morning.id)).toBe(true);
    // The same rule is not applied to an ordinary ward.
    expect(days(wardRows).some((d) => d === 0 || d === 6)).toBe(true);
  });

  it("is set by default for public health and can be changed by the administrator", async () => {
    const facility = await makeFacility("Sombo Health Centre");
    const { user } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Administrator" } });
    const api = as(user);
    const made = await api.post("/api/facility/departments", { name: "Disease Control" });
    expect(made.status).toBe(201);
    const list = async () => (await api.get("/api/facility/departments")).body.departments as { id: string; name: string; weekdaysOnly: boolean }[];
    const dc = (await list()).find((d) => d.name === "Disease Control")!;
    expect(dc.weekdaysOnly).toBe(true);
    const other = await api.post("/api/facility/departments", { name: "Dispensary" });
    expect((await list()).find((d) => d.name === "Dispensary")!.weekdaysOnly).toBe(false);
    expect(other.status).toBe(201);
    expect((await api.patch(`/api/facility/departments/${dc.id}`, { name: "Disease Control", weekdaysOnly: false })).status).toBe(200);
    expect((await list()).find((d) => d.id === dc.id)!.weekdaysOnly).toBe(false);
  });
});
