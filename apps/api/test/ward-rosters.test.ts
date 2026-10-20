import { beforeEach, describe, expect, it } from "vitest";
import { noticeTemplate } from "../src/routes/facility/privacy.js";
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
    const put = await api.put(`/api/facility/ward-demand/${maternity.id}`, { shifts: [{ shiftId: shifts[0].id, minStaff: 2, weekendMinStaff: 1 }, { shiftId: shifts[1].id, minStaff: 1 }, { shiftId: shifts[2].id, minStaff: 1, holidayMinStaff: 1 }] });
    expect(put.status).toBe(200);
    const read = (await api.get(`/api/facility/ward-demand/${maternity.id}`)).body.shifts;
    expect(read[0]).toMatchObject({ minStaff: 2, weekendMinStaff: 1, holidayMinStaff: null, custom: true });
    const check = (await api.get(`/api/facility/rosters/${id}/staffing`)).body;
    expect(["OK", "TIGHT", "SHORT"]).toContain(check.verdict);
    expect(check.duties.needed).toBeGreaterThan(0);
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

  it("reports across every ward, or one ward when asked, and a ward manager sees only theirs", async () => {
    const { facility, api, maternity, surgery, shifts } = await hospital();
    const mins = [{ shiftId: shifts[0].id, minStaff: 2 }, { shiftId: shifts[1].id, minStaff: 1 }, { shiftId: shifts[2].id, minStaff: 1 }];
    for (const w of [maternity, surgery]) {
      await api.put(`/api/facility/ward-demand/${w.id}`, { shifts: mins });
      const id = (await api.post("/api/facility/rosters", { year: 2026, month: 11, departmentId: w.id })).body.roster.id;
      expect((await api.post(`/api/facility/rosters/${id}/generate`, {})).status).toBe(200);
    }
    const all = await api.get("/api/facility/reports/compliance?month=2026-11");
    expect(all.body.wards).toHaveLength(2);
    expect(new Set(all.body.rows.map((r: { ward: string }) => r.ward))).toEqual(new Set(["Maternity", "Surgery"]));
    const one = await api.get(`/api/facility/reports/compliance?month=2026-11&ward=${surgery.id}`);
    expect(new Set(one.body.rows.map((r: { ward: string }) => r.ward))).toEqual(new Set(["Surgery"]));
    const { user: manager, staff } = await makeUser({ role: "ROSTER_MANAGER", facilityId: facility.id, withStaff: { fullName: "Sister Ama" } });
    await api.put(`/api/facility/staff/${staff!.id}/ward`, { departmentId: maternity.id });
    const mine = await as(manager).get(`/api/facility/reports/compliance?month=2026-11&ward=${surgery.id}`);
    expect(new Set(mine.body.rows.map((r: { ward: string }) => r.ward))).toEqual(new Set(["Maternity"]));
  });

  it("limits an invited roster manager to a ward from the start", async () => {
    const { facility, api, maternity } = await hospital();
    await api.post("/api/facility/privacy/notices", { body: noticeTemplate("Wa Municipal Hospital").replace("[name and email of the facility's contact]", "Kofi Bawa, kofi@wa.test") });
    const person = await prisma.staff.create({ data: { facilityId: facility.id, staffNo: "R1", fullName: "Sister Ama", email: "ama@wa.test", status: "ACTIVE" } });
    const sent = await api.post(`/api/facility/staff/${person.id}/invite`, { role: "ROSTER_MANAGER", wardDepartmentId: maternity.id });
    expect(sent.status).toBe(201);
    const inv = await prisma.staffInvitation.findFirstOrThrow({ where: { staffId: person.id } });
    expect(inv.wardDepartmentId).toBe(maternity.id);
    const plain = await api.post(`/api/facility/staff/${person.id}/invite`, { role: "STAFF", wardDepartmentId: maternity.id });
    expect(plain.status).toBe(201);
    expect((await prisma.staffInvitation.findFirstOrThrow({ where: { staffId: person.id, status: "PENDING" } })).wardDepartmentId).toBeNull();
  });
});
