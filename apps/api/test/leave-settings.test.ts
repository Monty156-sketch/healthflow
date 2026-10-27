import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
  const api = as(admin);
  const people = [];
  for (const n of ["Ama Dery", "Esi Naa"]) people.push(await prisma.staff.create({ data: { facilityId: facility.id, staffNo: n, fullName: n, status: "ACTIVE" } }));
  return { facility, api, people };
}

describe("leave types", () => {
  it("lists the seeded types, edits one with a sentence in the audit log, and refuses a repeated code", async () => {
    const { api } = await setup();
    const list = (await api.get("/api/facility/leave-types")).body.types as { id: string; code: string; name: string }[];
    expect(list.map((t) => t.code)).toContain("PERM");
    const annual = list.find((t) => t.code === "L")! as Record<string, unknown> & { id: string };
    const r = await api.patch(`/api/facility/leave-types/${annual.id}`, { ...annual, deductionBasis: "WORKING_DAYS_MON_FRI", maxConsecutiveDays: 30 });
    expect(r.status).toBe(200);
    const log = await prisma.auditLog.findFirst({ where: { action: "leave_type_updated" } });
    expect(log?.summary).toMatch(/how days are counted from calendar days to working days, Monday to Friday/);
    const dup = await api.post("/api/facility/leave-types", { ...annual, name: "Another", code: "S", id: undefined });
    expect(dup.body.fields.code).toMatch(/already uses/);
  });
});

describe("public holidays", () => {
  it("seeds the fixed holidays once, and lets the in-charge add, change and remove one", async () => {
    const { api } = await setup();
    const y = await api.get("/api/facility/holidays?year=2026");
    expect(y.body.holidays.map((h: { name: string }) => h.name)).toContain("Independence Day");
    expect((await api.get("/api/facility/holidays?year=2026")).body.holidays).toHaveLength(y.body.holidays.length);
    const added = await api.post("/api/facility/holidays", { date: "2026-03-20", name: "Eid-ul-Fitr (announced)" });
    expect(added.status).toBe(201);
    expect((await api.post("/api/facility/holidays", { date: "2026-03-20", name: "Again" })).status).toBe(400);
    const id = added.body.holiday.id;
    expect((await api.patch(`/api/facility/holidays/${id}`, { date: "2026-03-21", name: "Eid-ul-Fitr" })).body.holiday.date).toBe("2026-03-21");
    expect((await api.delete(`/api/facility/holidays/${id}`)).status).toBe(200);
  });

  it("working-day leave skips weekends and public holidays", async () => {
    const { api, facility, people } = await setup();
    const annual = (await api.get("/api/facility/leave-types")).body.types.find((t: { code: string }) => t.code === "L");
    await api.patch(`/api/facility/leave-types/${annual.id}`, { ...annual, deductionBasis: "WORKING_DAYS_MON_FRI" });
    const { user } = await makeUser({ role: "STAFF", facilityId: facility.id });
    await prisma.userProfile.update({ where: { id: user.id }, data: { staffId: people[0].id } });
    // Thu 24 Dec 2026 to Mon 28 Dec: Fri 25 and Mon 28 are holidays, Sat and Sun are the weekend.
    const r = await as(user).get(`/api/facility/leave/preview?leaveTypeId=${annual.id}&startDate=2026-12-24&endDate=2026-12-28`);
    expect(r.body).toMatchObject({ days: 1, skippedHolidays: 2 });
  });
});

describe("entitlements", () => {
  it("starts unset, can be set for everyone without touching those already set, and shows computed columns", async () => {
    const { api, people } = await setup();
    const first = await api.get("/api/facility/entitlements?year=2026");
    expect(first.body.rows.every((r: { configured: boolean }) => !r.configured)).toBe(true);
    const typeId = first.body.leaveTypeId;
    await api.put("/api/facility/entitlements", { year: 2026, leaveTypeId: typeId, entries: [{ staffId: people[0].id, daysEntitled: 30, daysCarriedOver: 2 }] });
    const all = await api.post("/api/facility/entitlements/set-all", { year: 2026, leaveTypeId: typeId, daysEntitled: 21 });
    expect(all.body.saved).toBe(2); // Kofi Bawa and Esi Naa; Ama keeps her own figure
    const rows = (await api.get(`/api/facility/entitlements?year=2026&leaveTypeId=${typeId}`)).body.rows as { name: string; daysEntitled: number; remaining: number }[];
    expect(rows.find((r) => r.name === "Ama Dery")).toMatchObject({ daysEntitled: 30, remaining: 32 });
    expect(rows.find((r) => r.name === "Esi Naa")).toMatchObject({ daysEntitled: 21, remaining: 21 });
  });

  it("takes Partial leave out of the annual days, with no entitlement of its own", async () => {
    const { facility, api, people } = await setup();
    await prisma.staff.update({ where: { id: people[0].id }, data: { leaveGrade: "SENIOR" } });
    const first = (await api.get("/api/facility/entitlements?year=2026")).body;
    expect(first.types.map((t: { code: string }) => t.code)).not.toContain("PART");
    const part = await prisma.leaveType.findFirstOrThrow({ where: { facilityId: facility.id, code: "PART" } });
    const day = (d: string) => new Date(`${d}T00:00:00Z`);
    await prisma.leaveRequest.create({ data: { facilityId: facility.id, staffId: people[0].id, leaveTypeId: part.id, startDate: day("2026-03-02"), endDate: day("2026-03-03"), daysDeducted: 2, status: "APPROVED" } });
    const rows = (await api.get(`/api/facility/entitlements?year=2026&leaveTypeId=${first.leaveTypeId}`)).body.rows as { name: string; taken: number; remaining: number | null }[];
    expect(rows.find((r) => r.name === "Ama Dery")).toMatchObject({ taken: 2, remaining: 34 });
  });

  it("gives senior staff 36 working days and junior staff 28 until a figure is set by hand", async () => {
    const { api, people } = await setup();
    await prisma.staff.update({ where: { id: people[0].id }, data: { leaveGrade: "SENIOR" } });
    await prisma.staff.update({ where: { id: people[1].id }, data: { leaveGrade: "JUNIOR" } });
    const typeId = (await api.get("/api/facility/entitlements?year=2026")).body.leaveTypeId;
    const rows = (await api.get(`/api/facility/entitlements?year=2026&leaveTypeId=${typeId}`)).body.rows as { name: string; defaultDays: number | null; remaining: number | null; configured: boolean }[];
    expect(rows.find((r) => r.name === "Ama Dery")).toMatchObject({ defaultDays: 36, remaining: 36, configured: false });
    expect(rows.find((r) => r.name === "Esi Naa")).toMatchObject({ defaultDays: 28, remaining: 28 });
    // A figure set by hand wins.
    await api.put("/api/facility/entitlements", { year: 2026, leaveTypeId: typeId, entries: [{ staffId: people[0].id, daysEntitled: 30, daysCarriedOver: 0 }] });
    const after = (await api.get(`/api/facility/entitlements?year=2026&leaveTypeId=${typeId}`)).body.rows as { name: string; remaining: number }[];
    expect(after.find((r) => r.name === "Ama Dery")?.remaining).toBe(30);
  });
});
