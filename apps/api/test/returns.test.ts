import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

const iso = (offset: number) => new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000 + offset * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
  const api = as(admin);
  const person = await prisma.staff.create({ data: { facilityId: facility.id, staffNo: "S1", fullName: "Ama Dery", status: "ACTIVE" } });
  const { user } = await makeUser({ role: "STAFF", facilityId: facility.id });
  await prisma.userProfile.update({ where: { id: user.id }, data: { staffId: person.id } });
  const types = (await api.get("/api/facility/leave/types")).body.types as { id: string; code: string }[];
  const type = (code: string) => types.find((t) => t.code === code)!.id;
  return { facility, api, me: as(user), person, type };
}

async function approved(api: ReturnType<typeof as>, staffId: string, leaveTypeId: string, startDate: string, endDate: string, extra: Record<string, unknown> = {}) {
  const made = await api.post("/api/facility/leave/requests", { staffId, leaveTypeId, startDate, endDate, ...extra });
  expect(made.status).toBe(201);
  const decided = await api.post(`/api/facility/leave/requests/${made.body.request.id}/decide`, { decision: "approve", reviewedImpact: true });
  expect(decided.status).toBe(200);
  return decided.body.request as { id: string };
}

describe("resumption date", () => {
  it("shows its arithmetic, skipping public holidays and, for working days, weekends", async () => {
    const { api, type } = await setup();
    const cal = await api.get(`/api/facility/leave/resumption?leaveTypeId=${type("L")}&startDate=2026-12-21&days=5`);
    expect(cal.body.resumptionDate).toBe("2026-12-27");
    expect(cal.body.sentence).toBe("5 days from 21 December, excluding 1 public holiday. Resumption of duty: 27 December.");
    const annual = (await api.get("/api/facility/leave-types")).body.types.find((t: { code: string }) => t.code === "L");
    expect((await api.patch(`/api/facility/leave-types/${annual.id}`, { ...annual, deductionBasis: "WORKING_DAYS_MON_FRI" })).status).toBe(200);
    const work = await api.get(`/api/facility/leave/resumption?leaveTypeId=${annual.id}&startDate=2026-12-21&days=5`);
    expect(work.body.resumptionDate).toBe("2026-12-30");
    expect(work.body.skippedHolidays).toBe(2);
  });

  it("lets the in-charge set the day duty resumes when approving, and recounts the days", async () => {
    const { api, person, type } = await setup();
    const made = await api.post("/api/facility/leave/requests", { staffId: person.id, leaveTypeId: type("L"), startDate: "2027-02-01", endDate: "2027-02-05" });
    const out = await api.post(`/api/facility/leave/requests/${made.body.request.id}/decide`, { decision: "approve", reviewedImpact: true, expectedReturnDate: "2027-02-09" });
    expect(out.body.request).toMatchObject({ endDate: "2027-02-08", expectedReturnDate: "2027-02-09", days: 8 });
    const bad = await api.post("/api/facility/leave/requests", { staffId: person.id, leaveTypeId: type("S"), startDate: iso(40), endDate: iso(42) });
    const early = await api.post(`/api/facility/leave/requests/${bad.body.request.id}/decide`, { decision: "approve", expectedReturnDate: iso(40) });
    expect(early.status).toBe(400);
  });
});

describe("open-ended leave and reporting back", () => {
  it("allows open-ended only where the person confirms the return, and keeps them away until it is confirmed", async () => {
    const { api, me, person, type } = await setup();
    const refused = await api.post("/api/facility/leave/requests", { staffId: person.id, leaveTypeId: type("L"), startDate: iso(-5), endDate: iso(-5), openEnded: true });
    expect(refused.status).toBe(400);
    const sick = await approved(api, person.id, type("SK"), iso(-5), iso(-5), { openEnded: true });
    const list = await api.get("/api/facility/leave/returns");
    expect(list.body.open.map((r: { id: string }) => r.id)).toContain(sick.id);
    const early = await me.post(`/api/facility/leave/requests/${sick.id}/report-back`, { date: iso(1) });
    expect(early.status).toBe(400);
    const back = await me.post(`/api/facility/leave/requests/${sick.id}/report-back`, { date: iso(-1) });
    expect(back.status).toBe(200);
    expect(back.body.request).toMatchObject({ actualReturnDate: iso(-1), returnStatus: "CONFIRMED" });
    expect((await api.get("/api/facility/leave/returns")).body.open).toHaveLength(0);
    expect((await me.post(`/api/facility/leave/requests/${sick.id}/report-back`, { date: iso(-1) })).status).toBe(409);
    const note = await prisma.notification.findFirst({ where: { type: "return_confirmed" } });
    expect(note?.title).toMatch(/is back on duty/);
  });

  it("flags a return that went unconfirmed as overdue, tells the in-charge once, and clears it when confirmed", async () => {
    const { api, person, type } = await setup();
    const leave = await approved(api, person.id, type("L"), iso(-20), iso(-10));
    const list = await api.get("/api/facility/leave/returns");
    expect(list.body.overdue[0]).toMatchObject({ id: leave.id, returnStatus: "OVERDUE", daysLate: 9 });
    await api.get("/api/facility/leave/returns");
    expect(await prisma.notification.count({ where: { type: "return_overdue" } })).toBe(1);
    const back = await api.post(`/api/facility/leave/requests/${leave.id}/report-back`, { date: iso(-9) });
    expect(back.body.request.returnStatus).toBe("CONFIRMED");
    expect((await api.get("/api/facility/leave/returns")).body.overdue).toHaveLength(0);
  });

  it("records an early return and gives the unused days back", async () => {
    const { api, person, type } = await setup();
    const leave = await approved(api, person.id, type("L"), iso(-3), iso(7));
    const back = await api.post(`/api/facility/leave/requests/${leave.id}/report-back`, { date: iso(0) });
    expect(back.body.request).toMatchObject({ returnStatus: "RETURNED_EARLY", days: 3 });
  });
});

describe("extensions", () => {
  it("asks for more time from the next day, and the original is marked extended once the extension is approved", async () => {
    const { api, me, person, type } = await setup();
    const leave = await approved(api, person.id, type("L"), iso(-4), iso(1));
    const ext = await me.post(`/api/facility/leave/requests/${leave.id}/extend`, { endDate: iso(5), reason: "Still unwell" });
    expect(ext.status).toBe(201);
    expect(ext.body.request).toMatchObject({ startDate: iso(2), endDate: iso(5), extensionOfId: leave.id, status: "SUBMITTED" });
    expect((await me.post(`/api/facility/leave/requests/${leave.id}/extend`, { endDate: iso(9) })).status).toBe(409);
    await api.post(`/api/facility/leave/requests/${ext.body.request.id}/decide`, { decision: "approve", reviewedImpact: true });
    const original = await prisma.leaveRequest.findUnique({ where: { id: leave.id } });
    expect(original?.returnStatus).toBe("EXTENDED");
    const list = (await api.get("/api/facility/leave/returns")).body;
    expect([...list.soon, ...list.overdue].map((r: { id: string }) => r.id)).toEqual([ext.body.request.id]);
  });

  it("refuses to extend from before the leave ends", async () => {
    const { api, me, person, type } = await setup();
    const leave = await approved(api, person.id, type("L"), iso(-4), iso(3));
    expect((await me.post(`/api/facility/leave/requests/${leave.id}/extend`, { endDate: iso(3) })).status).toBe(400);
  });
});
