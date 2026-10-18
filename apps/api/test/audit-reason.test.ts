import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

describe("the reason in the audit log", () => {
  it("is required to change a person's status, and is kept apart from the sentence", async () => {
    const facility = await makeFacility("Reasoned Clinic");
    const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Ama Admin" } });
    const { staff } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Kofi Mensah" } });
    const api = as(admin);

    const missing = await api.patch(`/api/facility/staff/${staff!.id}/status`, { status: "TRANSFERRED" });
    expect(missing.status).toBe(400);
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: staff!.id } })).status).toBe("ACTIVE");

    const ok = await api.patch(`/api/facility/staff/${staff!.id}/status`, { status: "TRANSFERRED", reason: "Posted to Nadowli Hospital" });
    expect(ok.status).toBe(200);

    const entry = (await api.get("/api/facility/audit-log")).body.entries.find((e: { action: string }) => e.action === "staff_status_changed");
    expect(entry.reason).toBe("Posted to Nadowli Hospital");
    expect(entry.summary).toContain("Posted to Nadowli Hospital");
  });
});
