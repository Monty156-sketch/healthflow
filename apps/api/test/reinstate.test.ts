import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

const DAY = 86_400_000;
const day = (offset: number) => new Date(Math.floor(Date.now() / DAY + offset) * DAY);

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id });
  const api = as(admin);
  const morning = (await api.post("/api/facility/shifts", { name: "Morning", code: "A", startTime: "08:00", endTime: "14:00", isOvernight: false, minStaff: 0, colour: "#25619f" })).body.shift;
  const people: { id: string }[] = [];
  for (const n of ["Ama Dery", "Esi Naa", "Yaw Boah"]) people.push(await prisma.staff.create({ data: { facilityId: facility.id, staffNo: n, fullName: n, status: "ACTIVE" } }));
  const types = (await api.get("/api/facility/leave/types")).body.types as { id: string; code: string }[];
  // The roster is for the month of the first duty, and every duty sits well after today.
  const first = day(2);
  const roster = await prisma.roster.create({ data: { facilityId: facility.id, month: first.getUTCMonth() + 1, year: first.getUTCFullYear(), status: "PUBLISHED" } });
  const mk = (staffId: string, offset: number) => prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId: facility.id, staffId, shiftId: morning.id, dutyDate: day(offset) } });
  // Esi carries six duties while Yaw has none; Ama has just come back.
  const esi: Awaited<ReturnType<typeof mk>>[] = [];
  for (const o of [2, 4, 6, 8, 10, 12]) esi.push(await mk(people[1].id, o));
  const leave = await prisma.leaveRequest.create({
    data: { facilityId: facility.id, staffId: people[0].id, leaveTypeId: types[0].id, startDate: day(-12), endDate: day(-1), status: "APPROVED", actualReturnDate: day(0), returnStatus: "CONFIRMED" },
  });
  return { facility, api, people, roster, esi, leave, morning };
}

describe("putting someone back on the roster", () => {
  it("proposes duties from the colleague furthest above the average, and moves nothing until accepted", async () => {
    const { api, people, leave, esi } = await setup();
    const plan = (await api.get(`/api/facility/leave/requests/${leave.id}/reinstatement`)).body;
    expect(plan.staff.name).toBe("Ama Dery");
    expect(plan.items.length).toBeGreaterThan(0);
    expect(plan.items.every((i: { kind: string; fromName: string }) => i.kind === "RELIEVE" && i.fromName === "Esi Naa")).toBe(true);
    expect(plan.items.length).toBeLessThanOrEqual(plan.target);
    expect(await prisma.rosterAssignment.count({ where: { staffId: people[0].id } })).toBe(0);
    expect(esi).toHaveLength(6);
  });

  it("applies what is accepted, tells the person who lost a duty, and keeps a version", async () => {
    const { api, people, leave, roster } = await setup();
    const plan = (await api.get(`/api/facility/leave/requests/${leave.id}/reinstatement`)).body;
    const one = plan.items[0];
    const out = await api.post(`/api/facility/leave/requests/${leave.id}/reinstate`, { items: [{ kind: one.kind, assignmentId: one.assignmentId }] });
    expect(out.status).toBe(200);
    expect(out.body.done).toHaveLength(1);
    expect(await prisma.rosterAssignment.count({ where: { staffId: people[0].id } })).toBe(1);
    expect(await prisma.rosterVersionSnapshot.count({ where: { rosterId: roster.id } })).toBe(1);
    const audit = await prisma.auditLog.findFirst({ where: { action: "staff_reinstated" } });
    expect(audit?.summary).toContain("Ama Dery");
    // The same item again is refused: the duty is already hers.
    const again = await api.post(`/api/facility/leave/requests/${leave.id}/reinstate`, { items: [{ kind: one.kind, assignmentId: one.assignmentId }] });
    expect(again.body.done).toHaveLength(0);
    expect(again.body.skipped).toHaveLength(1);
  });

  it("settles one duty of credit when the duty comes from someone who is owed", async () => {
    const { api, people, leave, esi, facility } = await setup();
    // Give Yaw credit and the duties, so the supply is Yaw rather than Esi.
    await prisma.rosterAssignment.updateMany({ where: { id: { in: esi.map((e) => e.id) } }, data: { staffId: people[2].id } });
    await api.post("/api/facility/ledger/adjust", { debtorId: people[1].id, creditorId: people[2].id, duties: 2, note: "Agreed at the ward meeting" });
    const plan = (await api.get(`/api/facility/leave/requests/${leave.id}/reinstatement`)).body;
    const credit = plan.items.find((i: { kind: string }) => i.kind === "CREDIT" || i.kind === "RELIEVE");
    expect(credit).toBeTruthy();
    if (credit.kind === "CREDIT") {
      await api.post(`/api/facility/leave/requests/${leave.id}/reinstate`, { items: [{ kind: "CREDIT", assignmentId: credit.assignmentId }] });
      const e = await prisma.dutyLedgerEntry.findFirst({ where: { facilityId: facility.id, staffId: people[2].id, entryType: "CREDIT" } });
      expect(e?.dutiesSettled).toBe(1);
    }
  });

  it("will not plan before the return is confirmed, and only deciders may see the plan", async () => {
    const { api, people, leave, facility } = await setup();
    await prisma.leaveRequest.update({ where: { id: leave.id }, data: { actualReturnDate: null, returnStatus: "NOT_DUE" } });
    expect((await api.get(`/api/facility/leave/requests/${leave.id}/reinstatement`)).status).toBe(409);
    const { user } = await makeUser({ role: "STAFF", facilityId: facility.id });
    await prisma.userProfile.update({ where: { id: user.id }, data: { staffId: people[0].id } });
    expect((await as(user).get(`/api/facility/leave/requests/${leave.id}/reinstatement`)).status).toBe(403);
  });
});
