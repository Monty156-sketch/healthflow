import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

const day = (offset: number) => new Date(Math.floor(Date.now() / 86_400_000 + offset) * 86_400_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
  const api = as(admin);
  const shift = (await api.post("/api/facility/shifts", { name: "Morning", code: "A", startTime: "08:00", endTime: "14:00", isOvernight: false, minStaff: 1, colour: "#25619f" })).body.shift;
  const night = (await api.post("/api/facility/shifts", { name: "Afternoon", code: "M", startTime: "14:00", endTime: "20:00", isOvernight: false, minStaff: 1, colour: "#b56b12" })).body.shift;
  const people = [];
  for (const n of ["Ama Dery", "Esi Naa", "Yaw Boah"]) people.push(await prisma.staff.create({ data: { facilityId: facility.id, staffNo: n, fullName: n, status: "ACTIVE" } }));
  const d = day(5);
  const d2 = day(6);
  const roster = await prisma.roster.create({ data: { facilityId: facility.id, month: d.getUTCMonth() + 1, year: d.getUTCFullYear(), status: "PUBLISHED" } });
  const mk = (staffId: string, shiftId: string, dt: Date) => prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId: facility.id, staffId, shiftId, dutyDate: dt } });
  const a = await mk(people[0].id, shift.id, d);
  const b = await mk(people[1].id, night.id, d2);
  const login = async (staffId: string) => {
    const { user } = await makeUser({ role: "STAFF", facilityId: facility.id });
    await prisma.userProfile.update({ where: { id: user.id }, data: { staffId } });
    return as(user);
  };
  return { facility, api, people, roster, a, b, d, d2, login, shift, night };
}

describe("duty swaps", () => {
  it("a handover: asked, accepted by the other person, approved, and the duty moves", async () => {
    const { api, people, a, login, roster } = await setup();
    const ama = await login(people[0].id);
    const yaw = await login(people[2].id);
    const c = await ama.get(`/api/facility/swaps/candidates?assignmentId=${a.id}`);
    expect(c.body.handover.map((x: { name: string }) => x.name)).toContain("Yaw Boah");
    const asked = await ama.post("/api/facility/swaps", { assignmentId: a.id, targetStaffId: people[2].id, reason: "Family event" });
    expect(asked.status).toBe(201);
    expect(asked.body.swap.type).toBe("HANDOVER");
    const id = asked.body.swap.id;
    expect((await api.post(`/api/facility/swaps/${id}/decide`, { decision: "approve" })).status).toBe(409); // not accepted yet
    expect((await ama.post(`/api/facility/swaps/${id}/respond`, { accept: true })).status).toBe(404); // only the target
    expect((await yaw.post(`/api/facility/swaps/${id}/respond`, { accept: true })).status).toBe(200);
    const ok = await api.post(`/api/facility/swaps/${id}/decide`, { decision: "approve" });
    expect(ok.status).toBe(200);
    const moved = await prisma.rosterAssignment.findUniqueOrThrow({ where: { id: a.id } });
    expect(moved).toMatchObject({ staffId: people[2].id, source: "SWAP" });
    expect((await prisma.roster.findUniqueOrThrow({ where: { id: roster.id } })).version).toBe(2);
    expect((await yaw.get("/api/facility/notifications")).body.notifications.some((n: { type: string }) => n.type === "swap_decided")).toBe(true);
  });

  it("checks again at approval: leave approved in between refuses it and names why", async () => {
    const { api, facility, people, a, d, login } = await setup();
    const ama = await login(people[0].id);
    const yaw = await login(people[2].id);
    const id = (await ama.post("/api/facility/swaps", { assignmentId: a.id, targetStaffId: people[2].id })).body.swap.id;
    await yaw.post(`/api/facility/swaps/${id}/respond`, { accept: true });
    const type = await prisma.leaveType.create({ data: { facilityId: facility.id, code: "L", name: "Annual", sortOrder: 1 } });
    await prisma.leaveRequest.create({ data: { facilityId: facility.id, staffId: people[2].id, leaveTypeId: type.id, startDate: d, endDate: d, daysDeducted: 1, status: "APPROVED" } });
    const r = await api.post(`/api/facility/swaps/${id}/decide`, { decision: "approve" });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/approved leave/);
    expect((await prisma.dutySwap.findUniqueOrThrow({ where: { id } })).status).toBe("ACCEPTED");
    expect((await prisma.rosterAssignment.findUniqueOrThrow({ where: { id: a.id } })).staffId).toBe(people[0].id);
  });

  it("an exchange trades two duties, and a refusal needs a reason", async () => {
    const { api, people, a, b, login } = await setup();
    const ama = await login(people[0].id);
    const esi = await login(people[1].id);
    const asked = await ama.post("/api/facility/swaps", { assignmentId: a.id, targetStaffId: people[1].id, targetAssignmentId: b.id });
    expect(asked.status).toBe(201);
    expect(asked.body.swap.type).toBe("EXCHANGE");
    await esi.post(`/api/facility/swaps/${asked.body.swap.id}/respond`, { accept: true });
    expect((await api.post(`/api/facility/swaps/${asked.body.swap.id}/decide`, { decision: "reject" })).status).toBe(400);
    await api.post(`/api/facility/swaps/${asked.body.swap.id}/decide`, { decision: "approve" });
    expect((await prisma.rosterAssignment.findUniqueOrThrow({ where: { id: a.id } })).staffId).toBe(people[1].id);
    expect((await prisma.rosterAssignment.findUniqueOrThrow({ where: { id: b.id } })).staffId).toBe(people[0].id);
  });

  it("refuses a swap inside the cut-off, on an unpublished roster, or for someone else's duty", async () => {
    const { api, people, a, b, roster, login } = await setup();
    const ama = await login(people[0].id);
    expect((await ama.post("/api/facility/swaps", { assignmentId: b.id, targetStaffId: people[2].id })).status).toBe(404); // not hers
    await prisma.rosterAssignment.update({ where: { id: a.id }, data: { dutyDate: new Date(Date.now() + 3_600_000) } });
    expect((await ama.post("/api/facility/swaps", { assignmentId: a.id, targetStaffId: people[2].id })).status).toBe(409);
    await prisma.roster.update({ where: { id: roster.id }, data: { status: "APPROVED" } });
    expect((await ama.post("/api/facility/swaps", { assignmentId: a.id, targetStaffId: people[2].id })).status).toBe(409);
    expect(api).toBeTruthy();
  });
});
