import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase, freezeEarlyInMonth, unfreezeClock } from "./helpers.js";

beforeEach(async () => {
  await resetDatabase();
  freezeEarlyInMonth();
});
afterEach(unfreezeClock);

const DAY = 86_400_000;
const day = (offset: number) => new Date(Math.floor(Date.now() / DAY + offset) * DAY);
const iso = (offset: number) => day(offset).toISOString().slice(0, 10);

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id });
  const api = as(admin);
  const morning = (await api.post("/api/facility/shifts", { name: "Morning", code: "A", startTime: "08:00", endTime: "14:00", isOvernight: false, minStaff: 0, colour: "#25619f" })).body.shift;
  const people: { id: string }[] = [];
  for (const n of ["Ama Dery", "Esi Naa", "Yaw Boah"]) people.push(await prisma.staff.create({ data: { facilityId: facility.id, staffNo: n, fullName: n, status: "ACTIVE" } }));
  const types = (await api.get("/api/facility/leave/types")).body.types as { id: string; code: string }[];
  const type = (code: string) => types.find((t) => t.code === code)!.id;
  const first = day(3);
  const roster = await prisma.roster.create({ data: { facilityId: facility.id, month: first.getUTCMonth() + 1, year: first.getUTCFullYear(), status: "PUBLISHED" } });
  const mk = (staffId: string, offset: number) => prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId: facility.id, staffId, shiftId: morning.id, dutyDate: day(offset) } });
  const duty = await mk(people[0].id, 3);
  const theirs = await mk(people[1].id, 8);
  return { facility, api, people, type, duty, theirs };
}

describe("planned absence", () => {
  it("shows swaps first and cover after, with what each does to the ledger", async () => {
    const { api, people, type, duty, theirs } = await setup();
    const made = await api.post("/api/facility/leave/requests", { staffId: people[0].id, leaveTypeId: type("L"), startDate: iso(3), endDate: iso(4) });
    const plan = (await api.get(`/api/facility/leave/requests/${made.body.request.id}/cover-plan`)).body;
    expect(plan.duties).toHaveLength(1);
    const d = plan.duties[0];
    expect(d.assignmentId).toBe(duty.id);
    expect(d.swaps.map((s: { targetAssignmentId: string }) => s.targetAssignmentId)).toContain(theirs.id);
    expect(d.cover.length).toBeGreaterThan(0);
    expect(d.ledger).toContain("not worked back");
    // Planning moves nothing.
    expect((await prisma.rosterAssignment.findUniqueOrThrow({ where: { id: duty.id } })).staffId).toBe(people[0].id);
  });

  it("asks the colleague for a swap on the absent person's behalf, through the ordinary steps", async () => {
    const { api, people, type, duty, theirs } = await setup();
    const made = await api.post("/api/facility/leave/requests", { staffId: people[0].id, leaveTypeId: type("L"), startDate: iso(3), endDate: iso(4) });
    const out = await api.post(`/api/facility/leave/requests/${made.body.request.id}/swap-request`, { assignmentId: duty.id, targetAssignmentId: theirs.id });
    expect(out.status).toBe(201);
    const swap = await prisma.dutySwap.findUniqueOrThrow({ where: { id: out.body.swapId } });
    expect(swap).toMatchObject({ status: "REQUESTED", swapType: "EXCHANGE", requesterStaffId: people[0].id, targetStaffId: people[1].id });
    expect((await api.post(`/api/facility/leave/requests/${made.body.request.id}/swap-request`, { assignmentId: duty.id, targetAssignmentId: theirs.id })).status).toBe(409);
    const again = (await api.get(`/api/facility/leave/requests/${made.body.request.id}/cover-plan`)).body;
    expect(again.duties[0].openSwap).toBe(true);
  });

  it("takes the leaver off the published roster on approval and refills the duty with a colleague", async () => {
    const { api, people, type, duty } = await setup();
    await prisma.shift.updateMany({ data: { minStaff: 1 } });
    const made = await api.post("/api/facility/leave/requests", { staffId: people[0].id, leaveTypeId: type("PERM"), startDate: iso(3), endDate: iso(3) });
    const out = await api.post(`/api/facility/leave/requests/${made.body.request.id}/decide`, { decision: "approve", reviewedImpact: true });
    expect(out.status).toBe(200);
    expect(out.body.rosters).toHaveLength(1);
    expect(out.body.rosters[0].removed).toBe(1);
    expect(await prisma.rosterAssignment.findUnique({ where: { id: duty.id } })).toBeNull();
    const refilled = await prisma.rosterAssignment.findFirst({ where: { dutyDate: day(3), shift: { countsAsDuty: true } } });
    expect(refilled?.staffId).not.toBe(people[0].id);
    expect(refilled?.source).toBe("COVER");
    expect(await prisma.rosterVersionSnapshot.count()).toBe(1);
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: made.body.request.id } })).conflictsPublishedRoster).toBe(false);
  });

  it("covers a longer absence the same way, and leaves the leaver's other duties alone", async () => {
    const { api, people, type, duty, theirs } = await setup();
    const made = await api.post("/api/facility/leave/requests", { staffId: people[0].id, leaveTypeId: type("L"), startDate: iso(3), endDate: iso(5) });
    const out = await api.post(`/api/facility/leave/requests/${made.body.request.id}/decide`, { decision: "approve", reviewedImpact: true });
    expect(out.body.cover).toBeNull();
    expect(await prisma.rosterAssignment.findUnique({ where: { id: duty.id } })).toBeNull();
    expect((await prisma.rosterAssignment.findUniqueOrThrow({ where: { id: theirs.id } })).staffId).toBe(people[1].id);
  });

  it("offers a swap with a duty in the next month, and moves one duty in each roster when approved", async () => {
    freezeEarlyInMonth(24);
    const { api, people, type, facility, duty, theirs } = await setup();
    // Esi's duty is moved into the following month's published roster.
    const later = day(10);
    const next = await prisma.roster.create({ data: { facilityId: facility.id, month: later.getUTCMonth() + 1, year: later.getUTCFullYear(), status: "PUBLISHED" } });
    await prisma.rosterAssignment.update({ where: { id: theirs.id }, data: { rosterId: next.id, dutyDate: later } });
    const made = await api.post("/api/facility/leave/requests", { staffId: people[0].id, leaveTypeId: type("L"), startDate: iso(3), endDate: iso(4) });
    const plan = (await api.get(`/api/facility/leave/requests/${made.body.request.id}/cover-plan`)).body;
    expect(plan.duties[0].swaps.map((s: { targetAssignmentId: string }) => s.targetAssignmentId)).toContain(theirs.id);
    const asked = await api.post(`/api/facility/leave/requests/${made.body.request.id}/swap-request`, { assignmentId: duty.id, targetAssignmentId: theirs.id });
    expect(asked.status).toBe(201);
    const { user } = await makeUser({ role: "STAFF", facilityId: facility.id });
    await prisma.userProfile.update({ where: { id: user.id }, data: { staffId: people[1].id } });
    expect((await as(user).post(`/api/facility/swaps/${asked.body.swapId}/respond`, { accept: true })).status).toBe(200);
    const decided = await api.post(`/api/facility/swaps/${asked.body.swapId}/decide`, { decision: "approve", confirmWarnings: true });
    expect(decided.status).toBe(200);
    expect((await prisma.rosterAssignment.findUniqueOrThrow({ where: { id: duty.id } })).staffId).toBe(people[1].id);
    expect((await prisma.rosterAssignment.findUniqueOrThrow({ where: { id: theirs.id } })).staffId).toBe(people[0].id);
    expect(await prisma.rosterVersionSnapshot.count()).toBe(2);
    expect(await prisma.dutyLedgerEntry.count()).toBe(0);
  });
});
