import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

describe("dashboard by unit", () => {
  it("lists each ward with its own roster and today's cover against its own minimums, and nothing for a clinic", async () => {
    const facility = await makeFacility("Wa Hospital");
    await prisma.facility.update({ where: { id: facility.id }, data: { facilityType: "REGIONAL_HOSPITAL" } });
    const { user } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Administrator" } });
    const api = as(user);
    const maternity = await prisma.department.create({ data: { facilityId: facility.id, name: "Maternity" } });
    await prisma.department.create({ data: { facilityId: facility.id, name: "Surgery" } });
    const shift = await prisma.shift.create({ data: { facilityId: facility.id, name: "Morning", code: "A", startTime: "00:00", endTime: "23:59", durationHours: 24, minStaff: 0 } });
    await prisma.shiftDemand.create({ data: { facilityId: facility.id, departmentId: maternity.id, shiftId: shift.id, minStaff: 2 } });
    const now = new Date();
    const roster = await prisma.roster.create({ data: { facilityId: facility.id, departmentId: maternity.id, month: now.getUTCMonth() + 1, year: now.getUTCFullYear(), status: "GENERATED" } });
    const staff = await prisma.staff.findFirstOrThrow({ where: { facilityId: facility.id } });
    await prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId: facility.id, staffId: staff.id, shiftId: shift.id, dutyDate: new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000) } });

    const d = (await api.get("/api/facility/dashboard")).body;
    expect(d.units.map((u: { name: string }) => u.name)).toEqual(["Maternity", "Surgery"]);
    const mat = d.units[0];
    expect(mat).toMatchObject({ rosterId: roster.id, status: "GENERATED" });
    expect(mat.cover).toEqual([expect.objectContaining({ code: "A", needed: 2, scheduled: 1 })]);
    expect(d.units[1]).toMatchObject({ rosterId: null, status: null, cover: [] });

    await prisma.facility.update({ where: { id: facility.id }, data: { facilityType: "CLINIC" } });
    expect((await api.get("/api/facility/dashboard")).body.units).toBeNull();
  });
});
