import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

describe("bulk staff import", () => {
  async function admin() {
    const facility = await makeFacility("Import Clinic");
    const { user } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Ama Admin" } });
    await prisma.cadre.create({ data: { facilityId: facility.id, name: "Midwife" } });
    await prisma.department.create({ data: { facilityId: facility.id, name: "Maternity" } });
    return { facility, api: as(user) };
  }
  const CSV = [
    "Staff number,Full name,Cadre,Department,Employment type,Email,Date joined",
    "S1,Esi Boateng,Midwife,Maternity,Permanent,esi@example.com,2020-01-15",
    "S2,Kwame Asare,Surgeon,Maternity,Permanent,,",
    'S3,"Mensah, Yaw",Midwife,,Contract,not-an-email,',
    "S1,Duplicate Person,Midwife,,,,",
  ].join("\n");

  it("shows every failing row and why, and imports only the valid ones", async () => {
    const { api, facility } = await admin();
    const prev = (await api.post("/api/facility/staff-import/preview", { csv: CSV })).body;
    expect(prev.totals).toEqual({ create: 1, update: 0, error: 3 });
    const bad = prev.rows.filter((r: { action: string }) => r.action === "error");
    expect(bad.map((r: { row: number }) => r.row)).toEqual([3, 4, 5]);
    expect(bad[0].problems[0]).toMatch(/Surgeon/);
    const out = (await api.post("/api/facility/staff-import/commit", { csv: CSV })).body;
    expect(out).toMatchObject({ created: 1, updated: 0 });
    expect(out.skipped).toHaveLength(3);
    expect(await prisma.staff.count({ where: { facilityId: facility.id, staffNo: "S1" } })).toBe(1);
  });

  it("updates on a second import rather than duplicating", async () => {
    const { api, facility } = await admin();
    const one = "Staff number,Full name,Cadre\nS9,Old Name,Midwife";
    await api.post("/api/facility/staff-import/commit", { csv: one });
    const out = (await api.post("/api/facility/staff-import/commit", { csv: "Staff number,Full name,Cadre\nS9,New Name,Midwife" })).body;
    expect(out).toMatchObject({ created: 0, updated: 1 });
    expect(await prisma.staff.count({ where: { facilityId: facility.id, staffNo: "S9" } })).toBe(1);
    expect((await prisma.staff.findFirstOrThrow({ where: { facilityId: facility.id, staffNo: "S9" } })).fullName).toBe("New Name");
  });

  it("matches unfamiliar column names, and asks for the two it must have", async () => {
    const { api } = await admin();
    const ok = (await api.post("/api/facility/staff-import/preview", { csv: "Payroll No,Name\nP1,Someone" })).body;
    expect(ok.totals.create).toBe(1);
    const no = await api.post("/api/facility/staff-import/preview", { csv: "Foo,Bar\n1,2" });
    expect(no.status).toBe(400);
    expect(no.body.message).toMatch(/Staff number and full name/);
  });

  it("is for administrators only", async () => {
    const facility = await makeFacility();
    const { user } = await makeUser({ role: "ROSTER_MANAGER", facilityId: facility.id });
    expect((await as(user).get("/api/facility/staff-import/template.csv")).status).toBe(403);
  });
});

describe("new facility wizard", () => {
  it("seeds groups, copies shifts, and invites the administrator, and the invitation can be used", async () => {
    const { user } = await makeUser({ role: "PLATFORM_ADMIN" });
    const api = as(user);
    const source = await makeFacility("Source Clinic");
    await prisma.shift.create({ data: { facilityId: source.id, name: "Night", code: "N", startTime: "20:00", endTime: "08:00", durationHours: 12, isOvernight: true, minStaff: 2 } });
    const f = (await api.post("/api/platform/facilities", { name: "New Health Centre", facilityType: "HEALTH_CENTRE" })).body.facilityId;
    const out = await api.post(`/api/platform/facilities/${f}/setup`, { copyFromFacilityId: source.id, adminName: "Nana Owusu", adminEmail: "nana@example.test" });
    expect(out.status).toBe(201);
    expect(out.body.seeded.cadres).toBeGreaterThan(0);
    expect(out.body.copied.shifts).toBe(1);
    expect(out.body.url).toContain("/invite?token=");
    expect(out.body.starterNotice).toBe(true);
    expect(await prisma.shift.count({ where: { facilityId: f, code: "N" } })).toBe(1);
    // The link works.
    const request = (await import("supertest")).default;
    const { app } = await import("./helpers.js");
    const token = new URL(out.body.url).searchParams.get("token")!;
    const check = await request(app).get(`/api/invitations/check?token=${encodeURIComponent(token)}`);
    expect(check.status).toBe(200);
  });

  it("will not set up twice for the same address", async () => {
    const { user } = await makeUser({ role: "PLATFORM_ADMIN" });
    const api = as(user);
    const f = (await api.post("/api/platform/facilities", { name: "Twice Clinic", facilityType: "CLINIC" })).body.facilityId;
    await api.post(`/api/platform/facilities/${f}/setup`, { adminName: "A B", adminEmail: "ab@example.test" });
    const again = await api.post(`/api/platform/facilities/${f}/setup`, { adminName: "A B", adminEmail: "ab@example.test" });
    expect(again.status).toBe(409);
  });
});
