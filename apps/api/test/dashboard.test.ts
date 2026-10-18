import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

describe("facility dashboard", () => {
  it("counts only what is on record, and an empty facility gets zeros", async () => {
    const facility = await makeFacility("Sombo Health Centre");
    const { user } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
    const api = as(user);
    const empty = await api.get("/api/facility/dashboard");
    expect(empty.status).toBe(200);
    expect(empty.body.today).toMatchObject({ scheduled: 0, recorded: 0, shifts: [] });
    expect(empty.body.roster).toBeNull();
    expect(empty.body.waiting).toEqual({ leave: 0, swaps: 0, returnsDue: 0, returnsOverdue: 0 });
    expect(empty.body.week).toHaveLength(7);

    await prisma.shift.create({ data: { facilityId: facility.id, name: "Morning", code: "M", minStaff: 2 } });
    const withShift = await api.get("/api/facility/dashboard");
    expect(withShift.body.today.shifts).toHaveLength(1);
    expect(withShift.body.today.shifts[0]).toMatchObject({ code: "M", minStaff: 2, scheduled: 0 });
  });

  it("is closed to staff and to other facilities' data", async () => {
    const facility = await makeFacility("Sombo Health Centre");
    const { user } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Ama Mensah" } });
    expect((await as(user).get("/api/facility/dashboard")).status).toBe(403);
  });
});
