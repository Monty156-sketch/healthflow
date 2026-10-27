import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
  const midwife = await prisma.cadre.create({ data: { facilityId: facility.id, name: "Midwife", code: "MW", sortOrder: 1 } });
  const people = [];
  for (let i = 1; i <= 3; i++) {
    people.push(await prisma.staff.create({ data: { facilityId: facility.id, staffNo: `M${i}`, fullName: `Midwife ${i}`, status: "ACTIVE", cadreId: midwife.id } }));
  }
  const api = as(admin);
  const shift = (code: string, name: string, s: string, e: string, over: boolean) =>
    api.post("/api/facility/shifts", { name, code, startTime: s, endTime: e, isOvernight: over, minStaff: 1, minByCadre: { [midwife.id]: 1 }, colour: "#25619f" });
  await shift("A", "Morning", "08:00", "14:00", false);
  await shift("M", "Afternoon", "14:00", "20:00", false);
  await shift("N", "Night", "20:00", "08:00", true);
  const types = (await api.get("/api/facility/leave/types")).body.types as { id: string; code: string }[];
  const type = (code: string) => types.find((t) => t.code === code)!.id;
  return { facility, admin, api, midwife, people, type };
}

describe("leave", () => {
  it("seeds the nine leave types once", async () => {
    const { api } = await setup();
    const r = await api.get("/api/facility/leave/types");
    expect(r.body.types.map((t: { code: string }) => t.code)).toEqual(["L", "S", "SK", "MAT", "PAT", "COM", "OA", "U", "PERM", "PART"]);
    expect((await api.get("/api/facility/leave/types")).body.types).toHaveLength(10);
  });

  it("a staff member asks for their own leave and the days are counted by the type's basis", async () => {
    const { facility, people, type } = await setup();
    const { user } = await makeUser({ role: "STAFF", facilityId: facility.id });
    await prisma.userProfile.update({ where: { id: user.id }, data: { staffId: people[0].id } });
    const me = as(user);
    const res = await me.post("/api/facility/leave/requests", { leaveTypeId: type("L"), startDate: "2026-11-02", endDate: "2026-11-08", reason: "Family visit" });
    expect(res.status).toBe(201);
    expect(res.body.request).toMatchObject({ status: "SUBMITTED", days: 7, staffName: "Midwife 1" });
    // someone else's leave is off limits
    const other = await me.post("/api/facility/leave/requests", { staffId: people[1].id, leaveTypeId: type("L"), startDate: "2026-12-01", endDate: "2026-12-02" });
    expect(other.status).toBe(403);
    expect((await me.get("/api/facility/leave/requests")).body.requests).toHaveLength(1);
    expect((await me.get("/api/facility/leave/calendar?month=2026-11")).status).toBe(403);
  });

  it("refuses overlapping requests and bad dates", async () => {
    const { api, people, type } = await setup();
    const base = { staffId: people[0].id, leaveTypeId: type("L") };
    expect((await api.post("/api/facility/leave/requests", { ...base, startDate: "2026-11-02", endDate: "2026-11-05" })).status).toBe(201);
    const clash = await api.post("/api/facility/leave/requests", { ...base, startDate: "2026-11-04", endDate: "2026-11-09" });
    expect(clash.status).toBe(409);
    expect(clash.body.message).toMatch(/already has annual leave from/);
    const backwards = await api.post("/api/facility/leave/requests", { ...base, startDate: "2026-12-09", endDate: "2026-12-02" });
    expect(backwards.body.fields.endDate).toBe("The end date is before the start date.");
  });

  it("tells the approver what approving does to cover, and needs the review ticked when cover would be short", async () => {
    const { api, people, type } = await setup();
    // three midwives, three shifts needing one each: any one away leaves two
    const req = (await api.post("/api/facility/leave/requests", { staffId: people[0].id, leaveTypeId: type("L"), startDate: "2026-11-12", endDate: "2026-11-15" })).body.request;
    const detail = (await api.get(`/api/facility/leave/requests/${req.id}`)).body;
    expect(detail.impact.needsReview).toBe(true);
    expect(detail.impact.summary[0]).toMatch(/leaves 2 midwives available/);
    expect(detail.impact.riskDates).toHaveLength(4);

    const blocked = await api.post(`/api/facility/leave/requests/${req.id}/decide`, { decision: "approve" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("review_impact");
    const ok = await api.post(`/api/facility/leave/requests/${req.id}/decide`, { decision: "approve", reviewedImpact: true });
    expect(ok.status).toBe(200);
    expect(ok.body.request).toMatchObject({ status: "APPROVED", expectedReturnDate: "2026-11-16" });
    expect((await api.post(`/api/facility/leave/requests/${req.id}/decide`, { decision: "approve", reviewedImpact: true })).status).toBe(409);
  });

  it("rejecting needs a reason, and approved leave keeps the person off a generated roster", async () => {
    const { api, people, type, facility } = await setup();
    const a = (await api.post("/api/facility/leave/requests", { staffId: people[0].id, leaveTypeId: type("S"), startDate: "2026-11-03", endDate: "2026-11-03" })).body.request;
    const noWhy = await api.post(`/api/facility/leave/requests/${a.id}/decide`, { decision: "reject" });
    expect(noWhy.status).toBe(400);
    expect((await api.post(`/api/facility/leave/requests/${a.id}/decide`, { decision: "reject", note: "Exam is in December" })).body.request.status).toBe("REJECTED");

    const b = (await api.post("/api/facility/leave/requests", { staffId: people[2].id, leaveTypeId: type("PERM"), startDate: "2026-11-20", endDate: "2026-11-20" })).body.request;
    await api.post(`/api/facility/leave/requests/${b.id}/decide`, { decision: "approve", reviewedImpact: true });
    const log = await prisma.auditLog.findFirst({ where: { facilityId: facility.id, action: "leave_approved" } });
    expect(log?.summary).toMatch(/^Kofi Bawa approved Midwife 3's permission leave, 20 November/);
  });

  it("shows the month's leave on a calendar with pending marked, and cancelling removes it", async () => {
    const { api, people, type } = await setup();
    const r = (await api.post("/api/facility/leave/requests", { staffId: people[1].id, leaveTypeId: type("L"), startDate: "2026-11-25", endDate: "2026-12-03" })).body.request;
    const cal = (await api.get("/api/facility/leave/calendar?month=2026-11")).body;
    expect(cal.leave).toEqual([expect.objectContaining({ staffId: people[1].id, code: "L", pending: true })]);
    expect((await api.get("/api/facility/leave/calendar?month=2027-02")).body.leave).toHaveLength(0);
    expect((await api.post(`/api/facility/leave/requests/${r.id}/cancel`)).body.request.status).toBe("CANCELLED");
    expect((await api.get("/api/facility/leave/calendar?month=2026-11")).body.leave).toHaveLength(0);
  });

  it("keeps other facilities out", async () => {
    const { api, people, type } = await setup();
    const r = (await api.post("/api/facility/leave/requests", { staffId: people[0].id, leaveTypeId: type("L"), startDate: "2026-11-02", endDate: "2026-11-03" })).body.request;
    const other = await makeFacility("Another Clinic");
    const { user } = await makeUser({ role: "FACILITY_ADMIN", facilityId: other.id });
    expect((await as(user).get(`/api/facility/leave/requests/${r.id}`)).status).toBe(404);
    expect((await as(user).post(`/api/facility/leave/requests/${r.id}/decide`, { decision: "approve" })).status).toBe(404);
    expect((await as(user).get("/api/facility/leave/requests")).body.requests).toHaveLength(0);
  });
});
