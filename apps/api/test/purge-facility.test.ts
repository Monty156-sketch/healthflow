import { beforeEach, describe, expect, it } from "vitest";
import { makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";
import { purgeFacility } from "../src/lib/purgeFacility.js";

beforeEach(resetDatabase);

async function populate(name: string) {
  const f = await makeFacility(name);
  const admin = await makeUser({ role: "FACILITY_ADMIN", facilityId: f.id, withStaff: { fullName: `${name} admin` } });
  await makeUser({ role: "STAFF", facilityId: f.id, withStaff: { fullName: `${name} nurse` } });
  await prisma.auditLog.create({ data: { facilityId: f.id, actorEmail: admin.user.userEmail, action: "x", entityType: "Staff", summary: "x" } });
  await prisma.errorReport.create({ data: { facilityId: f.id, message: "boom" } as never }).catch(() => undefined);
  return { f, admin };
}

describe("purging a facility", () => {
  it("a dry run reports the rows and changes nothing", async () => {
    const { f } = await populate("Test Clinic");
    const r = await purgeFacility("Test Clinic", { dryRun: true });
    expect(r.rows.Facility).toBe(1);
    expect(r.rows.Staff).toBe(2);
    expect(r.rows.UserProfile).toBe(2);
    expect(await prisma.facility.count({ where: { id: f.id } })).toBe(1);
    expect(await prisma.staff.count({ where: { facilityId: f.id } })).toBe(2);
  });

  it("removes that facility, its people and its history, and nothing else", async () => {
    const a = await populate("Test Clinic");
    const b = await populate("Other Clinic");
    const platform = await makeUser({ role: "PLATFORM_ADMIN" });
    await purgeFacility("Test Clinic", { dryRun: false });
    expect(await prisma.facility.count({ where: { id: a.f.id } })).toBe(0);
    expect(await prisma.staff.count({ where: { facilityId: a.f.id } })).toBe(0);
    expect(await prisma.userProfile.count({ where: { facilityId: a.f.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { facilityId: a.f.id } })).toBe(0);
    expect(await prisma.facility.count({ where: { id: b.f.id } })).toBe(1);
    expect(await prisma.staff.count({ where: { facilityId: b.f.id } })).toBe(2);
    expect(await prisma.userProfile.count({ where: { facilityId: b.f.id } })).toBe(2);
    expect(await prisma.userProfile.count({ where: { id: platform.user.id } })).toBe(1);
  });

  it("refuses an unknown name", async () => {
    await expect(purgeFacility("Nowhere", { dryRun: true })).rejects.toThrow(/No facility/);
  });
});
