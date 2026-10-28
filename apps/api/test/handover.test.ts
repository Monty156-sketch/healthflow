import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

const today = () => new Date().toISOString().slice(0, 10);

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
  const female = await prisma.department.create({ data: { facilityId: facility.id, name: "Female Ward", kind: "WARD" } });
  const male = await prisma.department.create({ data: { facilityId: facility.id, name: "Male Ward", kind: "WARD" } });
  const night = await prisma.shift.create({ data: { facilityId: facility.id, name: "Night", code: "N", startTime: "20:00", endTime: "08:00", isOvernight: true } });
  const mk = async (name: string, departmentId: string) => {
    const { user, staff } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: name } });
    await prisma.staff.update({ where: { id: staff!.id }, data: { departmentId } });
    return user;
  };
  return { facility, api: as(admin), female, male, night, ama: await mk("Ama Nurse", female.id), kojo: await mk("Kojo Nurse", female.id), yaw: await mk("Yaw Nurse", male.id) };
}

describe("shift handover notes", () => {
  it("lets a nurse leave a note for her ward and her ward-mates read it, with a receipt", async () => {
    const { api, ama, kojo, yaw, night, female } = await setup();
    const made = await as(ama).post("/api/facility/handover", { shiftId: night.id, dutyDate: today(), summary: "Quiet night. Bed 4 on drip.", pending: "Bed 4 review at 06:00", urgent: false });
    expect(made.status).toBe(201);
    expect(made.body.note.departmentId).toBe(female.id);
    // Ward-mate sees it, unread. Someone from another ward sees nothing.
    expect((await as(kojo).get("/api/facility/handover/unread")).body.unread).toBe(1);
    expect((await as(yaw).get("/api/facility/handover")).body.notes).toHaveLength(0);
    expect((await as(yaw).post(`/api/facility/handover/${made.body.note.id}/read`)).status).toBe(404);
    const list = (await as(kojo).get("/api/facility/handover")).body.notes;
    expect(list).toHaveLength(1);
    expect(list[0].read).toBe(false);
    await as(kojo).post(`/api/facility/handover/${made.body.note.id}/read`);
    await as(kojo).post(`/api/facility/handover/${made.body.note.id}/read`);
    expect((await as(kojo).get("/api/facility/handover/unread")).body.unread).toBe(0);
    // The writer never counts as a reader; the administrator sees who read it.
    await as(ama).post(`/api/facility/handover/${made.body.note.id}/read`);
    const seen = (await api.get(`/api/facility/handover?ward=${female.id}`)).body.notes[0];
    expect(seen.readCount).toBe(1);
    expect(seen.readers[0].name).toBe("Kojo Nurse");
    // Staff do not get the reader list.
    expect((await as(kojo).get("/api/facility/handover")).body.notes[0].readers).toBeUndefined();
  });

  it("holds staff to their own ward and rejects dates outside the last three days or an unknown shift", async () => {
    const { ama, night, male, api } = await setup();
    const note = await as(ama).post("/api/facility/handover", { shiftId: night.id, dutyDate: today(), ward: male.id, summary: "Trying another ward." });
    expect(note.body.note.departmentId).not.toBe(male.id);
    const old = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
    expect((await as(ama).post("/api/facility/handover", { shiftId: night.id, dutyDate: old, summary: "Too long ago" })).status).toBe(400);
    const future = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect((await as(ama).post("/api/facility/handover", { shiftId: night.id, dutyDate: future, summary: "Tomorrow already" })).status).toBe(400);
    expect((await as(ama).post("/api/facility/handover", { shiftId: "nope", dutyDate: today(), summary: "No such shift" })).status).toBe(400);
    // The administrator must say which ward when the facility has wards.
    expect((await api.post("/api/facility/handover", { shiftId: night.id, dutyDate: today(), summary: "Which ward?" })).body.fields.ward).toBeTruthy();
  });

  it("marks an urgent note to the ward's managers and lets only the writer or administrator change it", async () => {
    const { api, ama, kojo, night, facility } = await setup();
    const made = (await as(ama).post("/api/facility/handover", { shiftId: night.id, dutyDate: today(), summary: "Needs a doctor early.", urgent: true })).body.note;
    expect(await prisma.notification.count({ where: { facilityId: facility.id, type: "handover_urgent" } })).toBeGreaterThan(0);
    expect((await as(kojo).put(`/api/facility/handover/${made.id}`, { summary: "Edited by someone else", urgent: false })).status).toBe(403);
    expect((await as(ama).put(`/api/facility/handover/${made.id}`, { summary: "Needs a doctor at 06:00.", urgent: true })).status).toBe(200);
    // Past twelve hours the writer can no longer change it; the administrator still can.
    await prisma.handoverNote.update({ where: { id: made.id }, data: { createdAt: new Date(Date.now() - 13 * 3_600_000) } });
    expect((await as(ama).delete(`/api/facility/handover/${made.id}`)).status).toBe(403);
    expect((await api.delete(`/api/facility/handover/${made.id}`)).status).toBe(200);
    expect((await as(kojo).get("/api/facility/handover")).body.notes).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { facilityId: facility.id, action: "handover_removed" } })).toBe(1);
  });
});
