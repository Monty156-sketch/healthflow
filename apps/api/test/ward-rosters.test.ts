import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

async function hospital(type: "HOSPITAL" | "HEALTH_CENTRE" = "HOSPITAL") {
  const facility = await makeFacility("Wa Municipal Hospital");
  await prisma.facility.update({ where: { id: facility.id }, data: { facilityType: type } });
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
  const api = as(admin);
  const nurse = await prisma.cadre.create({ data: { facilityId: facility.id, name: "Nurse", sortOrder: 1 } });
  const maternity = await prisma.department.create({ data: { facilityId: facility.id, name: "Maternity" } });
  const surgery = await prisma.department.create({ data: { facilityId: facility.id, name: "Surgery" } });
  for (const [dept, tag] of [[maternity, "M"], [surgery, "S"]] as const) {
    for (let i = 1; i <= 10; i++) {
      await prisma.staff.create({ data: { facilityId: facility.id, staffNo: `${tag}${i}`, fullName: `${tag} nurse ${i}`, status: "ACTIVE", cadreId: nurse.id, departmentId: dept.id } });
    }
  }
  const mk = (code: string, name: string, startTime: string, endTime: string, isOvernight: boolean, minStaff: number) =>
    api.post("/api/facility/shifts", { name, code, startTime, endTime, isOvernight, minStaff, colour: "#25619f" });
  // Facility-wide minimums that one ward could never meet.
  const shifts = [(await mk("A", "Morning", "08:00", "14:00", false, 12)).body.shift, (await mk("M", "Afternoon", "14:00", "20:00", false, 12)).body.shift, (await mk("N", "Night", "20:00", "08:00", true, 12)).body.shift];
  return { facility, admin, api, maternity, surgery, shifts };
}

describe("ward rosters", () => {
  it("asks a hospital for a ward and keeps one roster per ward per month", async () => {
    const { api, maternity, surgery } = await hospital();
    expect((await api.post("/api/facility/rosters", { year: 2026, month: 11 })).status).toBe(400);
    const a = await api.post("/api/facility/rosters", { year: 2026, month: 11, departmentId: maternity.id });
    expect(a.status).toBe(201);
    expect(a.body.roster.department).toBe("Maternity");
    expect((await api.post("/api/facility/rosters", { year: 2026, month: 11, departmentId: maternity.id })).status).toBe(409);
    expect((await api.post("/api/facility/rosters", { year: 2026, month: 11, departmentId: surgery.id })).status).toBe(201);
    expect((await api.get("/api/facility/rosters")).body.rosters).toHaveLength(2);
  });

  it("keeps a health centre to one roster for the whole facility", async () => {
    const { api, maternity } = await hospital("HEALTH_CENTRE");
    expect((await api.post("/api/facility/rosters", { year: 2026, month: 11, departmentId: maternity.id })).status).toBe(400);
    expect((await api.post("/api/facility/rosters", { year: 2026, month: 11 })).status).toBe(201);
    expect((await api.post("/api/facility/rosters", { year: 2026, month: 11 })).status).toBe(409);
  });

  it("builds a ward roster from that ward's people and that ward's minimums", async () => {
    const { api, maternity, shifts } = await hospital();
    const id = (await api.post("/api/facility/rosters", { year: 2026, month: 11, departmentId: maternity.id })).body.roster.id;
    const before = await api.post(`/api/facility/rosters/${id}/generate`, {});
    expect(before.status).toBe(409);
    expect(before.body.message).toMatch(/how many people this ward needs/i);
    const put = await api.put(`/api/facility/ward-demand/${maternity.id}`, { shifts: [{ shiftId: shifts[0].id, minStaff: 2 }, { shiftId: shifts[1].id, minStaff: 1 }, { shiftId: shifts[2].id, minStaff: 1 }] });
    expect(put.status).toBe(200);
    const gen = await api.post(`/api/facility/rosters/${id}/generate`, {});
    expect(gen.status).toBe(200);
    const rows = await prisma.rosterAssignment.findMany({ where: { rosterId: id }, include: { staff: true } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.staff.departmentId === maternity.id)).toBe(true);
  });

  it("limits a ward manager to their own ward", async () => {
    const { facility, admin, api, maternity, surgery } = await hospital();
    const mat = (await api.post("/api/facility/rosters", { year: 2026, month: 11, departmentId: maternity.id })).body.roster.id;
    const sur = (await api.post("/api/facility/rosters", { year: 2026, month: 11, departmentId: surgery.id })).body.roster.id;
    const { user: manager, staff } = await makeUser({ role: "ROSTER_MANAGER", facilityId: facility.id, withStaff: { fullName: "Sister Ama" } });
    expect((await api.put(`/api/facility/staff/${staff!.id}/ward`, { departmentId: maternity.id })).status).toBe(200);
    const m = as(manager);
    expect((await m.get("/api/facility/rosters")).body.rosters.map((r: { id: string }) => r.id)).toEqual([mat]);
    expect((await m.get(`/api/facility/rosters/${mat}`)).status).toBe(200);
    expect((await m.get(`/api/facility/rosters/${sur}`)).status).toBe(404);
    expect((await m.post(`/api/facility/rosters/${sur}/generate`, {})).status).toBe(404);
    // Their own ward is forced, whatever they ask for.
    const created = await m.post("/api/facility/rosters", { year: 2026, month: 12, departmentId: surgery.id });
    expect(created.status).toBe(201);
    expect(created.body.roster.department).toBe("Maternity");
    expect(admin.id).toBeTruthy();
  });
});
